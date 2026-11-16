/** Coordinates refer to the complete source image, never to the viewport. */
export interface NormalizedBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NormalizedPoint { readonly x: number; readonly y: number }
export type OverlayBackground = 'mask' | 'original' | 'dark' | 'adaptive';
export interface RegionMetadata {
  readonly polygon?: readonly NormalizedPoint[];
  readonly kind?: 'dialogue' | 'narration' | 'sfx' | 'other';
  readonly direction?: 'horizontal' | 'vertical' | 'rotated';
  /** Model self-report; unknown=null. These scores are not calibrated probabilities. */
  readonly ocrConfidence?: number | null;
  readonly positionConfidence?: number | null;
  readonly reviewRequired?: boolean;
  readonly backgroundColor?: string;
  readonly backgroundVariance?: number;
  readonly edited?: boolean;
}

export interface TextRegion extends RegionMetadata {
  readonly id: string;
  readonly box: NormalizedBox;
  readonly text: string;
}

/** Guard against applying an asynchronous result to a recycled image element. */
export interface RegionBinding {
  readonly instanceId: string;
  readonly generation: number;
  readonly sourceKey: string;
}

export interface RegionResult extends RegionBinding {
  readonly regions: readonly TextRegion[];
}

export interface ImageCandidate {
  readonly discoveryId: number;
  readonly element: HTMLElement;
  readonly method: DetectionMethod;
  readonly source: string;
  readonly sourceKey: string;
  readonly requestKey: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

export type DetectionMethod = 'img' | 'picture' | 'background' | 'canvas';

export interface DetectionEntry {
  readonly nodeId: number;
  readonly element: string;
  readonly method: DetectionMethod;
  readonly source: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly renderedWidth: number;
  readonly renderedHeight: number;
  readonly valid: boolean;
  readonly reason: string;
}

export interface DetectionReport {
  readonly domImages: number;
  readonly canvases: number;
  readonly backgrounds: number;
  readonly valid: number;
  readonly visible: number;
  readonly entries: readonly DetectionEntry[];
}
