import { resolveChapterProfile, chapterIdentity, imageIdentity } from './identity';
import { withChapterLock } from './indexeddb-cache';
import { ImageRegistry } from './image-registry';
import { ChapterSessionManager } from './session-manager';
import { applyRegionEdits, validateRegionEdits } from './region-edits';
import { RestoreVerifier } from './restore-verifier';
import { DEFAULT_CHAPTER_OPTIONS, type CachedTranslation, type ChapterImage, type ChapterOptions, type ChapterSession, type ChapterStore, type ChapterView, type ImageObservation, type UserRegionEdits } from './types';
import { TranslationError } from '../translation/errors';
import { imageOrigin } from '../translation/image-pipeline';
import { objectValue } from '../translation/schema';
import type { TranslationOutput, TranslationSettings } from '../translation/types';

export type ExecutorCommand = 'translate' | 'resume' | 'retry' | 'pause' | 'cancel';
export interface ChapterExecutorRequest {
  readonly command: ExecutorCommand;
  readonly chapterId: string;
  readonly settings?: TranslationSettings;
  readonly apiKey?: string;
}
export interface ChapterServiceDependencies {
  readonly store: ChapterStore;
  readonly privateConfig: () => Promise<{ settings: TranslationSettings; apiKey: string }>;
  readonly permitted: (origins: readonly string[]) => Promise<boolean>;
  readonly execute: (request: ChapterExecutorRequest) => Promise<void>;
  readonly changed?: (chapterId: string) => void;
  readonly settings?: () => Promise<void>;
  readonly permissionHint?: () => Promise<void>;
  readonly alive?: () => Promise<boolean>;
  readonly verifyHash?: (observation: ImageObservation) => Promise<string>;
}
export interface EditableRegionSnapshot {
  readonly imageId: string;
  readonly cacheKey: string;
  readonly sourceKey: string;
  readonly contentHash: string;
  readonly revision: string;
  readonly output: TranslationOutput;
  readonly original: TranslationOutput;
  readonly edits: UserRegionEdits;
}
interface EditableState { readonly session: ChapterSession; readonly image: ChapterImage; readonly entry: CachedTranslation }

export interface RestoredImage { readonly imageId: string; readonly sourceKey: string; readonly output: TranslationOutput }

export function chapterOrigins(view: ChapterView): string[] {
  return [...new Set(view.images.filter((image) => image.access === 'url').map((image) => imageOrigin(image.source)))].sort();
}
function options(input: unknown, previous: ChapterOptions): ChapterOptions {
  const value = objectValue(input);
  if (!value) throw new TranslationError('CONFIG');
  const next = { ...previous, ...value };
  if (![1, 2].includes(Number(next.concurrency)) || ![1, 2, 3].includes(Number(next.maxAttempts))
    || typeof next.glossary !== 'string' || next.glossary.length > 4000 || typeof next.overlayVisible !== 'boolean'
    || !['mask', 'original', 'dark', 'adaptive'].includes(next.overlayBackground)
    || (next.qualityMode !== undefined && !['standard','review'].includes(next.qualityMode))) throw new TranslationError('CONFIG');
  return { concurrency: next.concurrency, maxAttempts: next.maxAttempts, glossary: next.glossary,
    overlayVisible: next.overlayVisible, overlayBackground: next.overlayBackground, ...(next.qualityMode ? {qualityMode:next.qualityMode} : {}) };
}

/** Trusted extension service. Public replies contain no credentials, bitmaps or provider error bodies. */
export class ChapterService {
  readonly sessions: ChapterSessionManager;
  readonly registry: ImageRegistry;
  private readonly verifier = new RestoreVerifier();
  constructor(private readonly dependencies: ChapterServiceDependencies) {
    this.sessions = new ChapterSessionManager(dependencies.store);
    this.registry = new ImageRegistry(dependencies.store);
  }

  async attach(url: string, documentToken: string): Promise<ChapterView> {
    const identity = chapterIdentity(url);
    const known = await this.dependencies.store.getChapter(identity.id);
    if (!known || !known.documentIds.includes(documentToken)) await this.sessions.attach(url, documentToken);
    if (known?.status === 'running' && this.dependencies.alive && !await this.dependencies.alive()) {
      await this.dependencies.execute({ chapterId: known.id, command: 'pause' });
    }
    return this.sessions.view(identity.id);
  }

  async observe(url: string, documentToken: string, observations: readonly ImageObservation[], endObserved = false): Promise<ChapterView> {
    const view = await this.attach(url, documentToken);
    const existing = new Set(view.images.map((image) => image.id));
    const allowed = view.session.status === 'collecting' ? observations : observations.filter((image) => existing.has(imageIdentity(view.session.id, image)));
    await this.registry.observe(view.session, allowed, documentToken);
    if (endObserved && view.session.status === 'collecting') await this.sessions.update(view.session.id, { endObserved: true });
    this.dependencies.changed?.(view.session.id);
    return this.sessions.view(view.session.id);
  }

  async command(url: string, documentToken: string, command: string, value?: unknown): Promise<ChapterView> {
    let view = await this.attach(url, documentToken);
    const chapterId = view.session.id;
    switch (command) {
      case 'collect':
        if (view.session.status === 'running') await this.dependencies.execute({ chapterId, command: 'pause' });
        await this.sessions.startCollection(chapterId); break;
      case 'finish': await this.sessions.finishCollection(chapterId, view.session.endObserved); break;
      case 'translate': case 'resume': case 'retry': {
        if (view.session.status === 'collecting' || view.images.length === 0) throw new TranslationError('COLLECTION_REQUIRED');
        const config = await this.dependencies.privateConfig();
        if (!config.apiKey || !config.settings.model) throw new TranslationError('CONFIG');
        if (!await this.dependencies.permitted(chapterOrigins(view))) {
          await this.dependencies.permissionHint?.().catch(() => undefined);
          throw new TranslationError('CHAPTER_ACCESS');
        }
        const profile = resolveChapterProfile(config.settings, view.session.options.glossary, view.session.options.qualityMode ?? 'standard', view.session.profile);
        if (profile.key !== view.session.profile?.key) {
          if (view.session.status === 'running') throw new TranslationError('BUSY');
          await withChapterLock(this.dependencies.store, chapterId, async () => {
            const current = await this.dependencies.store.getChapter(chapterId);
            if (!current) throw new TranslationError('STALE_IMAGE');
            for (const image of await this.dependencies.store.listImages(chapterId)) {
              const { cacheKey: _cacheKey, profileKey: _profileKey, errorCode: _errorCode, errorMessage: _errorMessage,
                nextAttemptAt: _nextAttemptAt, ...rest } = image;
              void _cacheKey; void _profileKey; void _errorCode; void _errorMessage; void _nextAttemptAt;
              await this.dependencies.store.putImage({ ...rest, state: 'DISCOVERED', attempts: 0, updatedAt: Date.now() });
            }
            await this.dependencies.store.putChapter({ ...current, profile, revision: current.revision + 1, updatedAt: Date.now() });
          });
        }
        await this.dependencies.execute({ chapterId, command, ...config });
        break;
      }
      case 'pause': case 'cancel': await this.dependencies.execute({ chapterId, command }); break;
      case 'visibility':
        await this.sessions.update(chapterId, { options: { ...view.session.options, overlayVisible: value !== false } }); break;
      case 'background':
        if (!['mask', 'original', 'dark', 'adaptive'].includes(String(value))) throw new TranslationError('CONFIG');
        await this.sessions.update(chapterId, { options: { ...view.session.options, overlayBackground: value as ChapterOptions['overlayBackground'] } }); break;
      case 'options':
        if (view.session.status === 'running') throw new TranslationError('BUSY');
        await this.sessions.update(chapterId, { options: options(value, view.session.options) }); break;
      case 'settings': await this.dependencies.settings?.(); break;
      case 'clear':
        await this.dependencies.execute({ chapterId, command: 'cancel' });
        await withChapterLock(this.dependencies.store, chapterId, () => this.dependencies.store.deleteChapter(chapterId));
        this.verifier.clear();
        await this.sessions.attach(url, documentToken); break;
      default: throw new TranslationError('CONFIG');
    }
    view = await this.sessions.view(chapterId);
    this.dependencies.changed?.(chapterId);
    return view;
  }

  /** A source-verified snapshot; raw OCR is preserved independently from user edits. */
  async regionSnapshot(url: string, documentToken: string, observation: ImageObservation): Promise<EditableRegionSnapshot> {
    const state = await this.editableState(url, documentToken, observation);
    return this.editableSnapshot(state, observation.sourceKey);
  }

  async saveRegionEdits(url: string, documentToken: string, observation: ImageObservation, cacheKey: string, expectedRevision: string, input: unknown): Promise<EditableRegionSnapshot> {
    if (typeof cacheKey !== 'string' || cacheKey.length > 300 || typeof expectedRevision !== 'string'
      || (expectedRevision !== '' && !/^[a-f0-9]{32}$/.test(expectedRevision))) throw new TranslationError('STALE_IMAGE');
    const state = await this.editableState(url, documentToken, observation);
    if (state.entry.key !== cacheKey || (state.entry.userEdits?.revision ?? '') !== expectedRevision) throw new TranslationError('STALE_IMAGE');
    const validated = validateRegionEdits(input, state.entry.output);
    const revision = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const saved = await withChapterLock(this.dependencies.store, state.session.id, async (): Promise<EditableState> => {
      const latest = await this.dependencies.store.getChapter(state.session.id);
      const image = (await this.dependencies.store.listImages(state.session.id)).find((item) => item.id === state.image.id);
      const entry = await this.dependencies.store.getTranslation(cacheKey);
      if (!latest || latest.incarnation !== state.session.incarnation || latest.createdAt !== state.session.createdAt
        || latest.profile?.key !== state.session.profile?.key || image?.state !== 'COMPLETED' || image.cacheKey !== cacheKey
        || image.profileKey !== state.image.profileKey || image.contentHash !== state.image.contentHash || image.source !== observation.source
        || !entry || entry.chapterId !== latest.id || entry.profile.key !== latest.profile?.key || entry.contentHash !== image.contentHash
        || (entry.userEdits?.revision ?? '') !== expectedRevision) throw new TranslationError('STALE_IMAGE');
      // Validate again against the entry present in this transaction-era checkpoint.
      const edits: UserRegionEdits = { revision, updatedAt: Date.now(), ...validateRegionEdits(validated, entry.output) };
      const updated = { ...entry, userEdits: edits };
      await this.dependencies.store.putTranslation(updated);
      await this.dependencies.store.putImage({...image,resultRevision:revision,updatedAt:Date.now()});
      const session = { ...latest, updatedAt: Date.now(), revision: latest.revision + 1 };
      await this.dependencies.store.putChapter(session);
      return { session, image, entry: updated };
    });
    this.dependencies.changed?.(state.session.id);
    return this.editableSnapshot(saved, observation.sourceKey);
  }

  resetRegionEdits(url: string, documentToken: string, observation: ImageObservation, cacheKey: string, expectedRevision: string): Promise<EditableRegionSnapshot> {
    return this.saveRegionEdits(url, documentToken, observation, cacheKey, expectedRevision, { overrides: {}, added: [] });
  }

  private editableSnapshot(state: EditableState, sourceKey: string): EditableRegionSnapshot {
    const edits = state.entry.userEdits ?? { revision: '', updatedAt: 0, overrides: {}, added: [] };
    return { imageId: state.image.id, cacheKey: state.entry.key, sourceKey, contentHash: state.entry.contentHash,
      revision: edits.revision, output: applyRegionEdits(state.entry.output, state.entry.userEdits), original: state.entry.output, edits };
  }

  private async editableState(url: string, documentToken: string, observation: ImageObservation): Promise<EditableState> {
    if (observation.documentToken !== documentToken || observation.sourceKey !== observation.binding.sourceKey) throw new TranslationError('STALE_IMAGE');
    const verified = await this.restore(url, documentToken, [observation]);
    if (!verified.some((item) => item.sourceKey === observation.sourceKey)) throw new TranslationError('STALE_IMAGE');
    const chapterId = chapterIdentity(url).id, imageId = imageIdentity(chapterId, observation);
    return withChapterLock(this.dependencies.store, chapterId, async () => {
      const session = await this.dependencies.store.getChapter(chapterId);
      const image = (await this.dependencies.store.listImages(chapterId)).find((item) => item.id === imageId);
      const entry = image?.cacheKey ? await this.dependencies.store.getTranslation(image.cacheKey) : undefined;
      if (!session?.documentIds.includes(documentToken) || !session.profile || image?.state !== 'COMPLETED' || image.profileKey !== session.profile.key
        || image.source !== observation.source || !entry || entry.chapterId !== chapterId || entry.profile.key !== session.profile.key
        || entry.contentHash !== image.contentHash) throw new TranslationError('STALE_IMAGE');
      return { session, image, entry };
    });
  }

  async restore(url: string, documentToken: string, observations: readonly ImageObservation[]): Promise<RestoredImage[]> {
    const view = await this.attach(url, documentToken);
    const config = await this.dependencies.privateConfig();
    const profile = resolveChapterProfile(config.settings, view.session.options.glossary, view.session.options.qualityMode ?? 'standard', view.session.profile);
    if (profile.key !== view.session.profile?.key) return [];
    const knownIds = new Set(view.images.map((image) => image.id));
    await this.registry.observe(view.session, observations.filter((image) => knownIds.has(imageIdentity(view.session.id, image))), documentToken);
    const records = new Map((await this.dependencies.store.listImages(view.session.id)).map((image) => [image.id, image]));
    const groups = new Map<string, { observation: ImageObservation; sourceKeys: Set<string> }>();
    for (const observation of observations) {
      if (observation.documentToken !== documentToken) continue;
      const id = imageIdentity(view.session.id, observation), image = records.get(id);
      if (!image || image.state !== 'COMPLETED' || image.profileKey !== profile.key || !image.cacheKey || image.access !== 'url') continue;
      const key = `${id}:${observation.source}`;
      const group = groups.get(key);
      if (group) group.sourceKeys.add(observation.sourceKey);
      else groups.set(key, { observation, sourceKeys: new Set([observation.sourceKey]) });
    }
    const restored = await Promise.all([...groups.values()].map(async ({ observation, sourceKeys }): Promise<RestoredImage[]> => {
      const imageId = imageIdentity(view.session.id, observation), image = records.get(imageId)!;
      const entry = await this.dependencies.store.getTranslation(image.cacheKey!);
      if (!entry || entry.chapterId !== view.session.id || entry.profile.key !== profile.key || entry.contentHash !== image.contentHash) return [];
      if (!await this.dependencies.permitted([imageOrigin(observation.source)])) return [];
      try {
        const hash = await (this.dependencies.verifyHash?.(observation) ?? this.verifier.hash(observation));
        if (hash !== entry.contentHash) {
          const invalidated = await withChapterLock(this.dependencies.store, view.session.id, async (): Promise<boolean> => {
            const currentSession = await this.dependencies.store.getChapter(view.session.id);
            if (!currentSession || currentSession.createdAt !== view.session.createdAt || currentSession.incarnation !== view.session.incarnation || currentSession.profile?.key !== profile.key) return false;
            const currentImage = (await this.dependencies.store.listImages(view.session.id)).find((candidate) => candidate.id === imageId);
            if (!currentImage || currentImage.state !== 'COMPLETED' || currentImage.cacheKey !== image.cacheKey
              || currentImage.profileKey !== profile.key || currentImage.contentHash !== entry.contentHash
              || currentImage.source !== observation.source) return false;
            const { cacheKey: _cacheKey, profileKey: _profileKey, contentHash: _contentHash,
              startedAt: _startedAt, completedAt: _completedAt, nextAttemptAt: _nextAttemptAt,
              errorCode: _errorCode, errorMessage: _errorMessage, ...metadata } = currentImage;
            void _cacheKey; void _profileKey; void _contentHash; void _startedAt; void _completedAt;
            void _nextAttemptAt; void _errorCode; void _errorMessage;
            await this.dependencies.store.putImage({ ...metadata, state: 'DISCOVERED', attempts: 0, updatedAt: Date.now() });
            await this.dependencies.store.putChapter({ ...currentSession,
              status: currentSession.status === 'completed' ? 'ready' : currentSession.status,
              updatedAt: Date.now(), revision: currentSession.revision + 1,
              collectionNote: 'Nội dung ảnh nguồn đã thay đổi. Bấm Dịch toàn bộ để xử lý ảnh mới; bản dịch cũ vẫn được giữ trong cache.',
            });
            return true;
          });
          if (invalidated) this.dependencies.changed?.(view.session.id);
          return [];
        }
        // Results must not resurrect a deleted chapter or overwritten profile while validation was in flight.
        return withChapterLock(this.dependencies.store, view.session.id, async () => {
          const latest = await this.dependencies.store.getChapter(view.session.id);
          const current = (await this.dependencies.store.listImages(view.session.id)).find((candidate) => candidate.id === imageId);
          const cached = await this.dependencies.store.getTranslation(entry.key);
          if (!latest || latest.createdAt !== view.session.createdAt || latest.incarnation !== view.session.incarnation
            || latest.profile?.key !== profile.key || current?.state !== 'COMPLETED' || current.cacheKey !== entry.key
            || current.contentHash !== entry.contentHash || current.profileKey !== profile.key || !cached) return [];
          return [...sourceKeys].map((sourceKey) => ({ imageId, sourceKey, output: applyRegionEdits(cached.output, cached.userEdits) }));
        });
      } catch { return []; } // An inaccessible source is never silently assumed to match cached bytes.
    }));
    return restored.flat();
  }
}

export { DEFAULT_CHAPTER_OPTIONS };
