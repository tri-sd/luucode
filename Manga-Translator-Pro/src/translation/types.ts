import type { DetectionMethod, NormalizedBox, RegionBinding, RegionMetadata, TextRegion } from '../core/types';

export const SOURCE_LANGUAGES = ['auto', 'en', 'ja', 'zh', 'ko'] as const;
export type SourceLanguage = typeof SOURCE_LANGUAGES[number];
export type DetectedLanguage = Exclude<SourceLanguage, 'auto'> | 'mixed' | 'unknown';

export interface TranslationSettings {
  readonly model: string;
  readonly sourceLanguage: SourceLanguage;
  readonly timeoutSeconds: number;
  readonly rememberKey: boolean;
}

export interface PublicSettings extends TranslationSettings { readonly hasKey: boolean }

export interface ImageSelection extends RegionBinding {
  readonly method?: DetectionMethod;
  readonly requiresCapture?: boolean;
  readonly captureTicket?: string;
  readonly documentToken: string;
  readonly source: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

export interface TranslatedRegion extends TextRegion {
  readonly sourceText: string;
  readonly sourceLanguage: DetectedLanguage;
}

export interface TranslationOutput {
  readonly sourceLanguage: DetectedLanguage;
  readonly regions: readonly TranslatedRegion[];
}

export interface ImageTile {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export interface VisionRegion extends RegionMetadata {
  readonly id: string;
  readonly sourceText: string;
  readonly translatedText: string;
  readonly box: NormalizedBox;
}

export interface VisionOutput {
  readonly sourceLanguage: DetectedLanguage;
  readonly regions: readonly VisionRegion[];
}

export interface ModelOption { readonly id: string; readonly name: string }

export type JobPhase = 'preparing' | 'translating' | 'applying' | 'done' | 'error' | 'cancelled';
export interface PublicJob {
  readonly id: string;
  readonly tabId: number;
  readonly phase: JobPhase;
  readonly tile: number;
  readonly tiles: number;
  readonly message: string;
  readonly createdAt: number;
  readonly output?: TranslationOutput;
  readonly errorCode?: string;
}

/** Private transport: extension background -> offscreen document only. */
export interface PrivateJob {
  readonly capture?: import('./capture').CapturedImage;
  readonly id: string;
  readonly tabId: number;
  readonly selection: ImageSelection;
  readonly settings: TranslationSettings;
  readonly apiKey: string;
}
