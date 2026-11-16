import { validateRegions } from '../core/regions';
import { publicError, TranslationError } from '../translation/errors';
import type { TranslationOutput } from '../translation/types';
import { withChapterLock } from './indexeddb-cache';
import type { ChapterImage, ChapterImageState, ChapterSession, ChapterStore, TranslationProfile } from './types';

export interface QueueRunContext {
  readonly signal: AbortSignal;
  /** OCR and translation share one Gemini request; stages describe actual pipeline work. */
  readonly onState: (state: 'FETCHING' | 'OCR_PROCESSING' | 'TRANSLATING') => Promise<void>;
  /** Bounded reference text from preceding successful pages; never dialogue to merge. */
  readonly context: string;
}
export interface QueueRunResult {
  readonly output: TranslationOutput;
  readonly contentHash: string;
  readonly cacheKey: string;
}
export type QueueRunner = (image: ChapterImage, context: QueueRunContext) => Promise<QueueRunResult>;
export interface TranslationQueueOptions {
  readonly store: ChapterStore;
  readonly chapterId: string;
  readonly run: QueueRunner;
  readonly onChanged?: () => void | Promise<void>;
  readonly now?: () => number;
  readonly retryBaseMs?: number;
  readonly random?: () => number;
}

interface Task {
  readonly image: ChapterImage;
  readonly controller: AbortController;
  readonly epoch: number;
  readonly profile: TranslationProfile;
  readonly context: string;
}
const busyStates: readonly ChapterImageState[] = ['FETCHING', 'OCR_PROCESSING', 'TRANSLATING', 'RENDER_READY'];
const activeStates: readonly ChapterImageState[] = ['FETCHING', 'OCR_PROCESSING', 'TRANSLATING'];
const owners = new WeakMap<ChapterStore, Map<string, TranslationQueue>>();
const retryable = new Set(['NETWORK', 'TIMEOUT', 'QUOTA']);

function cleanError(image: ChapterImage): ChapterImage {
  const next = { ...image };
  for (const key of ['nextAttemptAt', 'errorCode', 'errorMessage'] as const) Reflect.deleteProperty(next, key);
  return next;
}

/** Persistent metadata scheduler. Credentials and image bitmaps belong to the injected trusted runner. */
export class TranslationQueue {
  private readonly owner = Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, '0')).join('');
  private readonly store: ChapterStore;
  private readonly now: () => number;
  private readonly active = new Map<string, Task>();
  private readonly waiters = new Set<() => void>();
  private enabled = false;
  private disposed = false;
  private epoch = 0;
  private profileKey: string | undefined;
  private createdAt: number | undefined;
  private pumpOperation: Promise<void> | undefined;
  private pumpAgain = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private throttled = false;

  constructor(private readonly options: TranslationQueueOptions) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
  }

  /** Only after an executor was actually recreated. A live worker restart must reuse its offscreen queue. */
  async recover(): Promise<void> {
    this.assertUsable();
    if (this.enabled || this.active.size) throw new TranslationError('BUSY');
    await this.lock(async () => {
      this.claimLocalOwner();
      const session = await this.requireSession();
      this.createdAt = session.createdAt;
      this.profileKey = session.profile?.key;
      const images = await this.store.listImages(session.id);
      for (const image of images) {
        if (!busyStates.includes(image.state)) continue;
        const cached = image.cacheKey ? await this.store.getTranslation(image.cacheKey) : undefined;
        if (cached && cached.profile.key === session.profile?.key) {
          await this.store.putImage({ ...cleanError(image), state: 'COMPLETED', completedAt: this.now(), updatedAt: this.now() });
        } else {
          const exhausted = image.attempts >= session.options.maxAttempts;
          await this.store.putImage({ ...image, state: exhausted ? 'FAILED' : 'QUEUED', updatedAt: this.now(),
            errorCode: 'TIMEOUT', errorMessage: exhausted
              ? 'Tiến trình trước bị gián đoạn và đã hết số lần thử; có thể thử lại thủ công.'
              : 'Tiến trình trước bị gián đoạn; tiếp tục từ checkpoint, không coi request cũ còn chạy.',
          });
        }
      }
      this.assertUsable();
      await this.store.putChapter({ ...session, queueOwner: this.owner,
        status: session.status === 'running' ? 'paused' : session.status,
        updatedAt: this.now(), revision: session.revision + 1,
      });
    });
    await this.emit();
  }

  async start(): Promise<void> {
    this.assertUsable();
    await this.lock(async () => {
      this.claimLocalOwner();
      const session = await this.requireSession();
      if (!session.profile?.model) throw new TranslationError('CONFIG');
      if (session.queueOwner && session.queueOwner !== this.owner && session.status === 'running') throw new TranslationError('BUSY');
      this.createdAt = session.createdAt;
      this.profileKey = session.profile.key;
      const images = await this.store.listImages(session.id);
      for (const image of images) {
        let next = image;
        if (image.state === 'COMPLETED' || image.state === 'RENDER_READY') {
          const cached = image.cacheKey ? await this.store.getTranslation(image.cacheKey) : undefined;
          if (image.profileKey === session.profile.key && cached?.profile.key === session.profile.key) {
            if (image.state === 'RENDER_READY') next = { ...image, state: 'COMPLETED', completedAt: this.now() };
          } else next = { ...cleanError(image), state: 'QUEUED', attempts: 0 };
        } else if (image.state === 'DISCOVERED' || image.state === 'CANCELLED') {
          next = { ...cleanError(image), state: 'QUEUED', attempts: image.state === 'CANCELLED' ? 0 : image.attempts };
        }
        if (next !== image) await this.store.putImage({ ...next, updatedAt: this.now() });
      }
      this.assertUsable();
      await this.store.putChapter({ ...session, queueOwner: this.owner, status: 'running', updatedAt: this.now(), revision: session.revision + 1 });
    });
    this.assertUsable();
    this.enabled = true;
    await this.emit();
    await this.pump();
  }

  resume(): Promise<void> { return this.start(); }

  /** Pause dispatch; already running requests may finish and checkpoint their results. */
  async pause(): Promise<void> {
    this.enabled = false;
    this.clearTimer();
    await this.updateSessionStatus('paused');
    await this.emit();
    this.settleWaiters();
  }

  async cancel(): Promise<void> {
    this.enabled = false;
    this.epoch++;
    this.clearTimer();
    for (const task of this.active.values()) task.controller.abort();
    await this.lock(async () => {
      const session = await this.ownedSession();
      if (!session) return;
      for (const image of await this.store.listImages(session.id)) {
        if (image.state === 'COMPLETED' || image.state === 'FAILED') continue;
        await this.store.putImage({ ...image, state: 'CANCELLED', errorCode: 'CANCELLED',
          errorMessage: new TranslationError('CANCELLED').message, updatedAt: this.now() });
      }
      await this.store.putChapter({ ...session, status: 'cancelled', updatedAt: this.now(), revision: session.revision + 1 });
    });
    await this.emit();
    this.settleWaiters();
  }

  async retryFailed(): Promise<void> {
    this.assertUsable();
    await this.lock(async () => {
      const session = await this.requireSession();
      for (const image of await this.store.listImages(session.id)) if (image.state === 'FAILED') {
        await this.store.putImage({ ...cleanError(image), state: 'QUEUED', attempts: 0, updatedAt: this.now() });
      }
    });
    await this.start();
  }

  async prioritize(imageIds: readonly string[]): Promise<void> {
    const priorities = new Map(imageIds.slice(0, 100).map((id, index) => [id, 100 - index]));
    await this.lock(async () => {
      const session = await this.ownedSession();
      if (!session) return;
      for (const image of await this.store.listImages(session.id)) {
        const priority = priorities.get(image.id) ?? 0;
        if (priority !== image.priority) await this.store.putImage({ ...image, priority });
      }
    });
    await this.pump();
  }

  /** Resolves when paused/cancelled work drains, all work settles, or this executor is disposed. */
  waitForIdle(): Promise<void> {
    if (this.idle()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.add(resolve));
  }

  /** Teardown leaves checkpoints intact; an obsolete runner can never commit afterward. */
  dispose(): void {
    this.disposed = true; this.enabled = false; this.epoch++;
    this.clearTimer();
    for (const task of this.active.values()) task.controller.abort();
    this.active.clear();
    const local = owners.get(this.store);
    if (local?.get(this.options.chapterId) === this) local.delete(this.options.chapterId);
    this.settleWaiters();
  }

  private lock<T>(operation: () => Promise<T>): Promise<T> { return withChapterLock(this.store, this.options.chapterId, operation); }
  private assertUsable(): void { if (this.disposed) throw new TranslationError('CANCELLED'); }
  private claimLocalOwner(): void {
    let local = owners.get(this.store);
    if (!local) { local = new Map(); owners.set(this.store, local); }
    const owner = local.get(this.options.chapterId);
    if (owner && owner !== this) throw new TranslationError('BUSY');
    local.set(this.options.chapterId, this);
  }
  private async requireSession(): Promise<ChapterSession> {
    const session = await this.store.getChapter(this.options.chapterId);
    if (!session) throw new TranslationError('STALE_IMAGE');
    return session;
  }
  private async ownedSession(): Promise<ChapterSession | undefined> {
    if (this.disposed) return undefined;
    const session = await this.store.getChapter(this.options.chapterId);
    return session && session.queueOwner === this.owner && session.createdAt === this.createdAt
      && (!this.profileKey || session.profile?.key === this.profileKey) ? session : undefined;
  }
  private async updateSessionStatus(status: ChapterSession['status']): Promise<void> {
    await this.lock(async () => {
      const session = await this.ownedSession();
      if (session) await this.store.putChapter({ ...session, status, updatedAt: this.now(), revision: session.revision + 1 });
    });
  }
  private async emit(): Promise<void> {
    // A closed popup or failed status subscriber must never lose a translation result.
    try { await this.options.onChanged?.(); } catch { /* The next status read loads persisted state. */ }
  }
  private clearTimer(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
  private idle(): boolean { return this.disposed || (!this.pumpOperation && this.active.size === 0 && (!this.enabled || this.timer === undefined)); }
  private settleWaiters(): void {
    if (!this.idle()) return;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }
  private wakeAt(timestamp: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => { this.timer = undefined; void this.pump(); }, Math.max(1, timestamp - this.now()));
  }

  private pump(): Promise<void> {
    if (this.pumpOperation) { this.pumpAgain = true; return this.pumpOperation; }
    const operation = this.dispatch();
    this.pumpOperation = operation;
    void operation.catch(() => {
      // An unavailable/deleted store is not a provider error and must not spin or leak task data.
      this.enabled = false; this.clearTimer();
    }).finally(() => {
      this.pumpOperation = undefined;
      if (this.pumpAgain && this.enabled && !this.disposed) { this.pumpAgain = false; void this.pump(); }
      this.settleWaiters();
    });
    return operation;
  }

  private async dispatch(): Promise<void> {
    this.clearTimer();
    while (this.enabled && !this.disposed) {
      const claimed = await this.lock(async (): Promise<Task | null> => {
        const session = await this.ownedSession();
        if (!session || session.status !== 'running' || !session.profile) { this.enabled = false; return null; }
        const images = await this.store.listImages(session.id);
        const quotaRetries = images.filter((image) => image.state === 'QUEUED' && image.errorCode === 'QUOTA' && image.nextAttemptAt);
        const cooldown = Math.max(0, ...quotaRetries.map((image) => image.nextAttemptAt!));
        if (cooldown > this.now()) { this.wakeAt(cooldown); return null; }
        const concurrency = this.throttled ? 1 : Math.max(1, Math.min(2, session.options.concurrency));
        if (this.active.size >= concurrency) return null;
        const pending = images.filter((image) => image.state === 'QUEUED' && !this.active.has(image.id));
        const ready = pending.filter((image) => !image.nextAttemptAt || image.nextAttemptAt <= this.now())
          .sort((a, b) => b.priority - a.priority || a.order - b.order || a.id.localeCompare(b.id));
        const image = ready[0];
        if (!image) {
          if (pending.length) this.wakeAt(Math.min(...pending.map((item) => item.nextAttemptAt ?? this.now())));
          else if (!this.active.size) {
            this.enabled = false;
            await this.store.putChapter({ ...session, status: 'completed', updatedAt: this.now(), revision: session.revision + 1 });
          }
          return null;
        }
        if (image.attempts >= session.options.maxAttempts) {
          await this.store.putImage({ ...image, state: 'FAILED', errorCode: image.errorCode ?? 'TIMEOUT',
            errorMessage: image.errorMessage ?? 'Đã hết số lần thử tự động.', updatedAt: this.now() });
          this.pumpAgain = true;
          return null;
        }
        const claimed: ChapterImage = { ...cleanError(image), state: 'FETCHING', attempts: image.attempts + 1,
          profileKey: session.profile.key, startedAt: this.now(), updatedAt: this.now() };
        await this.store.putImage(claimed);
        return { image: claimed, controller: new AbortController(), epoch: this.epoch, profile: session.profile,
          context: await this.contextFor(image, images, session.profile.key) };
      });
      await this.emit();
      if (!claimed) return;
      this.active.set(claimed.image.id, claimed);
      void this.execute(claimed).catch(() => {
        this.enabled = false; this.clearTimer();
      }).finally(() => {
        if (this.active.get(claimed.image.id) === claimed) this.active.delete(claimed.image.id);
        if (this.enabled && !this.disposed) void this.pump();
        this.settleWaiters();
      });
    }
  }

  private async contextFor(image: ChapterImage, images: readonly ChapterImage[], profileKey: string): Promise<string> {
    const preceding = images.filter((item) => item.order < image.order && (item.state === 'COMPLETED' || item.state === 'RENDER_READY') && item.profileKey === profileKey && item.cacheKey)
      .sort((a, b) => b.order - a.order).slice(0, 4).reverse();
    const context: { page: number; dialogue: { source: string; vietnamese: string }[] }[] = [];
    for (const item of preceding) {
      const cached = await this.store.getTranslation(item.cacheKey!);
      if (cached?.profile.key === profileKey) context.push({ page: item.order, dialogue: cached.output.regions.slice(0, 8)
        .map((region) => ({ source: region.sourceText.slice(0, 350), vietnamese: region.text.slice(0, 350) })) });
    }
    while (context.length > 1 && JSON.stringify(context).length > 8000) context.shift();
    return JSON.stringify(context);
  }

  private async taskImage(task: Task): Promise<ChapterImage | undefined> {
    if (this.disposed || task.epoch !== this.epoch || task.controller.signal.aborted || this.active.get(task.image.id) !== task) return undefined;
    const session = await this.ownedSession();
    if (!session || session.status === 'cancelled' || session.profile?.key !== task.profile.key) return undefined;
    const current = (await this.store.listImages(session.id)).find((image) => image.id === task.image.id);
    return current && activeStates.includes(current.state) && current.profileKey === task.profile.key ? current : undefined;
  }

  private async stage(task: Task, state: 'FETCHING' | 'OCR_PROCESSING' | 'TRANSLATING'): Promise<void> {
    const updated = await this.lock(async () => {
      const image = await this.taskImage(task);
      if (!image) return false;
      await this.store.putImage({ ...image, state, updatedAt: this.now() });
      return true;
    });
    if (!updated) throw new TranslationError('CANCELLED');
    await this.emit();
  }

  private async execute(task: Task): Promise<void> {
    try {
      if (this.disposed || task.epoch !== this.epoch || task.controller.signal.aborted) return;
      const result = await this.options.run(task.image, { signal: task.controller.signal,
        onState: (state) => this.stage(task, state), context: task.context });
      if (!result.contentHash || !result.cacheKey || !result.output || !Array.isArray(result.output.regions)
        || result.output.regions.length > 500 || !validateRegions(result.output.regions)
        || JSON.stringify(result.output).length > 1_000_000) throw new TranslationError('INVALID_JSON');
      const saved = await this.lock(async () => {
        const image = await this.taskImage(task);
        if (!image) return false;
        try {
          await this.store.putTranslation({ key: result.cacheKey, imageId: image.id, chapterId: image.chapterId,
            contentHash: result.contentHash, profile: task.profile, output: result.output, createdAt: this.now() });
        } catch { throw new TranslationError('CACHE_STORAGE'); }
        await this.store.putImage({ ...cleanError(image), contentHash: result.contentHash, cacheKey: result.cacheKey,
          state: 'RENDER_READY', profileKey: task.profile.key, updatedAt: this.now() });
        return true;
      });
      if (!saved) return;
      await this.emit();
      await this.lock(async () => {
        const session = await this.ownedSession();
        if (!session || task.epoch !== this.epoch || session.status === 'cancelled') return;
        const current = (await this.store.listImages(session.id)).find((image) => image.id === task.image.id);
        if (current?.state === 'RENDER_READY' && current.cacheKey === result.cacheKey && current.profileKey === task.profile.key) {
          await this.store.putImage({ ...current, state: 'COMPLETED', completedAt: this.now(), updatedAt: this.now() });
        }
      });
      await this.emit();
    } catch (error) {
      await this.lock(async () => {
        const image = await this.taskImage(task);
        const session = await this.ownedSession();
        if (!image || !session) return;
        const safe = publicError(error);
        if (safe.code === 'CACHE_STORAGE') {
          this.enabled = false; this.clearTimer();
          await this.store.putChapter({ ...session, status: 'paused', updatedAt: this.now(), revision: session.revision + 1 });
        }
        const retry = retryable.has(safe.code) && image.attempts < session.options.maxAttempts;
        if (safe.code === 'QUOTA') this.throttled = true;
        const extra = error instanceof Error && 'retryAfterMs' in error && typeof error.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs)
          ? Math.max(0, Math.min(86_400_000, error.retryAfterMs)) : 0;
        const base = Math.max(1, this.options.retryBaseMs ?? 1000);
        const backoff = Math.min(60_000, base * 2 ** (image.attempts - 1));
        const jitter = Math.floor(backoff * 0.25 * (this.options.random ?? Math.random)());
        await this.store.putImage({ ...image, state: retry ? 'QUEUED' : safe.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
          errorCode: safe.code, errorMessage: safe.message, updatedAt: this.now(),
          ...(retry ? { nextAttemptAt: this.now() + Math.max(extra, backoff + jitter) } : {}),
        });
      });
      await this.emit();
    }
  }
}
