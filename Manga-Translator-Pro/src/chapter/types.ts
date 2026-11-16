import type { DetectionMethod, OverlayBackground, RegionBinding } from '../core/types';
import type { SourceLanguage, TranslationOutput } from '../translation/types';

export const IMAGE_STATES = ['DISCOVERED', 'QUEUED', 'FETCHING', 'OCR_PROCESSING', 'TRANSLATING', 'RENDER_READY', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type ChapterImageState = typeof IMAGE_STATES[number];
export type ChapterStatus = 'idle' | 'collecting' | 'ready' | 'running' | 'paused' | 'cancelled' | 'completed';
export interface ChapterOptions {
  readonly concurrency: 1 | 2;
  readonly maxAttempts: 1 | 2 | 3;
  readonly glossary: string;
  readonly overlayVisible: boolean;
  readonly overlayBackground: OverlayBackground;
  readonly qualityMode?: 'standard' | 'review';
}
export const DEFAULT_CHAPTER_OPTIONS: ChapterOptions = { concurrency: 2, maxAttempts: 3, glossary: '', overlayVisible: true, overlayBackground: 'dark' };
export interface TranslationProfile {
  readonly qualityMode?: 'standard' | 'review';
  readonly key: string;
  readonly model: string;
  readonly sourceLanguage: SourceLanguage;
  readonly targetLanguage: 'vi';
  readonly ocrVersion: string;
  readonly promptVersion: string;
  readonly glossaryVersion: string;
  readonly glossary: string;
}
export interface ChapterSession {
  readonly incarnation?: string;
  /** Owner token for rejecting results from an obsolete queue executor. */
  readonly queueOwner?: string;
  readonly id: string;
  readonly url: string;
  readonly documentIds: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly revision: number;
  readonly status: ChapterStatus;
  readonly endObserved: boolean;
  readonly completeConfirmed: boolean;
  readonly collectionNote: string;
  readonly options: ChapterOptions;
  readonly profile?: TranslationProfile;
}
export interface ImageObservation {
  readonly source: string;
  readonly sourceKey: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly method: DetectionMethod;
  readonly binding: RegionBinding;
  readonly documentToken: string;
  readonly pageOrdinal?: number;
  readonly fingerprint?: string;
}
export interface ChapterImage {
  readonly resultRevision?: string;
  readonly id: string;
  readonly chapterId: string;
  readonly order: number;
  readonly canonicalUrl: string;
  readonly source: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly method: DetectionMethod;
  readonly access: 'url' | 'live-only';
  readonly fingerprint?: string;
  readonly contentHash?: string;
  readonly state: ChapterImageState;
  readonly attempts: number;
  readonly priority: number;
  readonly updatedAt: number;
  readonly cacheKey?: string;
  readonly profileKey?: string;
  readonly nextAttemptAt?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly startedAt?: number;
  readonly completedAt?: number;
}
export interface RegionOverride {
  readonly text?: string;
  readonly box?: import('../core/types').NormalizedBox;
  readonly polygon?: readonly import('../core/types').NormalizedPoint[] | null;
  readonly hidden?: boolean;
}
export interface UserRegionEdits {
  readonly revision: string;
  readonly updatedAt: number;
  readonly overrides: Readonly<Record<string, RegionOverride>>;
  readonly added: readonly import('../translation/types').TranslatedRegion[];
}
export interface CachedTranslation {
  readonly userEdits?: UserRegionEdits;
  readonly key: string;
  readonly imageId: string;
  readonly chapterId: string;
  readonly contentHash: string;
  readonly profile: TranslationProfile;
  readonly output: TranslationOutput;
  readonly createdAt: number;
}
export interface ChapterProgress {
  readonly total: number;
  readonly discovered: number;
  readonly queued: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly settled: number;
  readonly percent: number;
}
export interface ChapterView {
  readonly session: ChapterSession;
  readonly images: readonly ChapterImage[];
  readonly progress: ChapterProgress;
}
export interface ChapterStore {
  getChapter(id: string): Promise<ChapterSession | undefined>;
  putChapter(session: ChapterSession): Promise<void>;
  listImages(chapterId: string): Promise<ChapterImage[]>;
  putImage(image: ChapterImage): Promise<void>;
  getTranslation(key: string): Promise<CachedTranslation | undefined>;
  putTranslation(entry: CachedTranslation): Promise<void>;
  deleteChapter(chapterId: string): Promise<void>;
}
