import { contentFingerprint, translationCacheKey } from './identity';
import { withChapterLock } from './indexeddb-cache';
import { TranslationQueue, type QueueRunContext, type QueueRunResult } from './translation-queue';
import type { ChapterExecutorRequest } from './chapter-service';
import type { ChapterImage, ChapterStore, TranslationProfile } from './types';
import { GeminiClient, type Fetcher } from '../translation/gemini-client';
import { downloadImage, translateRasterImage } from '../translation/image-pipeline';
import { throwIfAborted, TranslationError } from '../translation/errors';
import { planTiles } from '../translation/tiles';
import type { TranslationOutput, TranslationSettings } from '../translation/types';

interface ExecutorOptions {
  readonly store: ChapterStore;
  readonly changed?: (chapterId: string) => void | Promise<void>;
  readonly client?: Pick<GeminiClient, 'translateImage'>;
  readonly fetcher?: Fetcher;
  readonly retryBaseMs?: number;
}
interface FlightConsumer { readonly signal: AbortSignal; readonly onState: QueueRunContext['onState'] }
interface Flight { readonly controller: AbortController; readonly consumers: Set<FlightConsumer>; readonly promise: Promise<TranslationOutput> }
interface RunningQueue { readonly queue: TranslationQueue; readonly chapterId: string; readonly profileKey: string; config: { settings: TranslationSettings; apiKey: string } }

/** A single offscreen executor owns chapter dispatch; it lives independently of popup/service worker. */
export class ChapterExecutor {
  private current: RunningQueue | undefined;
  private readonly flights = new Map<string, Flight>();
  private commands: Promise<unknown> = Promise.resolve();
  private readonly client: Pick<GeminiClient, 'translateImage'>;
  constructor(private readonly options: ExecutorOptions) { this.client = options.client ?? new GeminiClient(); }
  async isBusy(): Promise<boolean> {
    if (!this.current) return false;
    const session = await this.options.store.getChapter(this.current.chapterId);
    const images = await this.options.store.listImages(this.current.chapterId);
    return session?.status === 'running' || images.some((image) => ['FETCHING', 'OCR_PROCESSING', 'TRANSLATING'].includes(image.state));
  }

  command(request: ChapterExecutorRequest): Promise<void> {
    const operation = this.commands.catch(() => undefined).then(() => this.apply(request));
    this.commands = operation.catch(() => undefined);
    return operation;
  }
  async waitForIdle(): Promise<void> { await this.commands; await this.current?.queue.waitForIdle(); }
  dispose(): void {
    this.current?.queue.dispose(); this.current = undefined;
    for (const flight of this.flights.values()) flight.controller.abort();
    this.flights.clear();
  }

  private async apply(request: ChapterExecutorRequest): Promise<void> {
    const session = await this.options.store.getChapter(request.chapterId);
    if (!session) throw new TranslationError('STALE_IMAGE');
    if (this.current && this.current.chapterId !== request.chapterId) {
      if (request.command === 'pause' || request.command === 'cancel') return; // Never control a different chapter by accident.
      const previous = await this.options.store.getChapter(this.current.chapterId);
      if (previous?.status === 'running') await this.current.queue.pause();
      const images = await this.options.store.listImages(this.current.chapterId);
      if (images.some((image) => ['FETCHING', 'OCR_PROCESSING', 'TRANSLATING'].includes(image.state))) throw new TranslationError('BUSY');
      this.current.queue.dispose(); this.current = undefined;
    }
    if (request.command === 'pause' || request.command === 'cancel') {
      if (this.current?.chapterId === request.chapterId) {
        await this.current.queue[request.command]();
        if (request.command === 'cancel') { this.current.queue.dispose(); this.current = undefined; }
      } else {
        // A recreated executor checkpoints interrupted work before controlling it.
        const queue = new TranslationQueue({ store: this.options.store, chapterId: request.chapterId, run: async () => { throw new TranslationError('CONFIG'); } });
        try { await queue.recover(); await queue[request.command](); } finally { queue.dispose(); }
      }
      await this.options.changed?.(request.chapterId);
      return;
    }
    if (!request.settings || !request.apiKey || !session.profile) throw new TranslationError('CONFIG');
    if (this.current && (this.current.profileKey !== session.profile.key || this.current.chapterId !== request.chapterId)) {
      this.current.queue.dispose(); this.current = undefined;
    }
    if (!this.current) {
      const profile = session.profile;
      const running: RunningQueue = {
        chapterId: session.id, profileKey: profile.key, config: { settings: request.settings, apiKey: request.apiKey },
        queue: new TranslationQueue({ store: this.options.store, chapterId: session.id,
          run: (image, context) => this.runImage(image, context, profile, running.config),
          onChanged: () => this.options.changed?.(session.id),
          ...(this.options.retryBaseMs === undefined ? {} : { retryBaseMs: this.options.retryBaseMs }),
        }),
      };
      await running.queue.recover();
      this.current = running;
    } else this.current.config = { settings: request.settings, apiKey: request.apiKey };
    if (request.command === 'retry') await this.current.queue.retryFailed();
    else await this.current.queue.start();
  }

  private async runImage(image: ChapterImage, context: QueueRunContext, profile: TranslationProfile, config: { settings: TranslationSettings; apiKey: string }): Promise<QueueRunResult> {
    if (image.access !== 'url') throw new TranslationError('LIVE_ONLY');
    throwIfAborted(context.signal);
    planTiles(image.naturalWidth, image.naturalHeight);
    const checkpoint = await this.options.store.getChapter(image.chapterId);
    if (!checkpoint || checkpoint.profile?.key !== profile.key) throw new TranslationError('STALE_IMAGE');
    const blob = await downloadImage(image.source, context.signal, this.options.fetcher ?? fetch);
    const contentHash = await contentFingerprint(blob);
    // Chapter context is semantic input; never let another chapter overwrite this cache entry.
    const cacheKey = translationCacheKey(`${image.chapterId}:${contentHash}`, profile);
    throwIfAborted(context.signal);
    const saved = await this.options.store.getTranslation(cacheKey);
    if (saved?.chapterId === image.chapterId && saved.profile.key === profile.key && saved.contentHash === contentHash) return { output: saved.output, contentHash, cacheKey };
    let flight = this.flights.get(cacheKey);
    if (flight?.controller.signal.aborted) { this.flights.delete(cacheKey); flight = undefined; }
    if (!flight) {
      const controller = new AbortController(), consumers = new Set<FlightConsumer>();
      const promise = (async (): Promise<TranslationOutput> => {
        // Let consumers join before PNG encoding/provider work begins.
        await Promise.resolve();
        let expired = false;
        const timer = setTimeout(() => { expired = true; controller.abort(); }, 5 * 60_000);
        try {
          const output = await translateRasterImage(blob, {
            selection: { instanceId: 'image-1', generation: 1, sourceKey: image.id, documentToken: 'trusted-chapter-executor',
              source: image.source, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight },
            settings: config.settings, apiKey: config.apiKey, signal: controller.signal, allowEmpty: true,
            visionMode: profile.ocrVersion === 'gemini-vision-v1' ? 'legacy' : 'detailed', qualityMode: profile.qualityMode ?? 'standard',
            contextText: JSON.stringify({ glossary: profile.glossary, previousPages: context.context }), onProgress: () => undefined,
            onState: async (state) => {
              const live = [...consumers].filter((consumer) => !consumer.signal.aborted);
              if (!live.length) throw new TranslationError('CANCELLED');
              const outcomes = await Promise.allSettled(live.map((consumer) => consumer.onState(state)));
              if (outcomes.every((result) => result.status === 'rejected')) throw new TranslationError('CACHE_STORAGE');
            },
          }, this.client);
          throwIfAborted(controller.signal);
          // Persist before releasing the content flight; aliases cannot race into a second paid request.
          try { await withChapterLock(this.options.store, image.chapterId, async () => {
            const latest = await this.options.store.getChapter(image.chapterId);
            if (!latest || (latest.createdAt !== checkpoint.createdAt || latest.incarnation !== checkpoint.incarnation) || latest.queueOwner !== checkpoint.queueOwner
              || latest.profile?.key !== profile.key || latest.status === 'cancelled') throw new TranslationError('STALE_IMAGE');
            throwIfAborted(controller.signal);
            await this.options.store.putTranslation({ key: cacheKey, imageId: image.id, chapterId: image.chapterId,
              contentHash, profile, output, createdAt: Date.now() });
          }); } catch (error) { if (error instanceof TranslationError) throw error; throw new TranslationError('CACHE_STORAGE'); }
          return output;
        } catch (error) { if (expired) throw new TranslationError('TIMEOUT'); throw error; }
        finally { clearTimeout(timer); }
      })();
      flight = { controller, consumers, promise };
      this.flights.set(cacheKey, flight);
      const created = flight;
      void promise.finally(() => { if (this.flights.get(cacheKey) === created) this.flights.delete(cacheKey); }).catch(() => undefined);
    }
    const consumer: FlightConsumer = { signal: context.signal, onState: context.onState };
    flight.consumers.add(consumer);
    const shared = flight;
    const cancel = (): void => { if ([...shared.consumers].every((item) => item.signal.aborted)) shared.controller.abort(); };
    context.signal.addEventListener('abort', cancel, { once: true });
    try {
      const output = await shared.promise;
      throwIfAborted(context.signal);
      return { output, contentHash, cacheKey };
    } finally { context.signal.removeEventListener('abort', cancel); shared.consumers.delete(consumer); }
  }
}
