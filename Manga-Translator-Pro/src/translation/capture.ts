import { intersectRects, isNormalizedBox } from '../core/geometry';
import type { NormalizedBox, NormalizedPoint, Rect } from '../core/types';
import { TranslationError } from './errors';

export interface CaptureGeometry {
  readonly clip: Rect;
  readonly painted: Rect;
  readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number; readonly scale: number; readonly offsetLeft: number; readonly offsetTop: number };
}
export interface CapturedImage { readonly dataUrl: string; readonly geometry: CaptureGeometry }
export interface CropPlan { readonly pixels: Rect; readonly sourceBox: NormalizedBox }

function validRect(rect: Rect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

export function validateCaptureGeometry(input: unknown): CaptureGeometry {
  const value = input as CaptureGeometry | undefined;
  if (!value?.clip || !value.painted || !value.viewport || !validRect(value.clip) || !validRect(value.painted)
    || ![value.viewport.width, value.viewport.height, value.viewport.dpr, value.viewport.scale, value.viewport.offsetLeft, value.viewport.offsetTop].every(Number.isFinite)
    || value.viewport.width <= 0 || value.viewport.height <= 0 || value.viewport.dpr <= 0) throw new TranslationError('UNSUPPORTED_IMAGE');
  // Desktop browser zoom is supported. Pinch zoom needs a separate visual-viewport mapping.
  if (Math.abs(value.viewport.scale - 1) > 0.001 || Math.abs(value.viewport.offsetLeft) > 0.01 || Math.abs(value.viewport.offsetTop) > 0.01) throw new TranslationError('UNSUPPORTED_IMAGE');
  const inside = intersectRects(value.clip, { x: 0, y: 0, width: value.viewport.width, height: value.viewport.height });
  const painted = intersectRects(value.clip, value.painted);
  if (!inside || !painted || Math.abs(inside.width - value.clip.width) > 0.01 || Math.abs(inside.height - value.clip.height) > 0.01
    || Math.abs(painted.width - value.clip.width) > 0.01 || Math.abs(painted.height - value.clip.height) > 0.01) throw new TranslationError('UNSUPPORTED_IMAGE');
  return value;
}

/** Actual screenshot dimensions are authoritative; DPR is diagnostic, not a second multiplier. */
export function planCaptureCrop(input: CaptureGeometry, bitmapWidth: number, bitmapHeight: number): CropPlan {
  const geometry = validateCaptureGeometry(input);
  if (![bitmapWidth, bitmapHeight].every((n) => Number.isInteger(n) && n > 0) || bitmapWidth * bitmapHeight > 40_000_000) throw new TranslationError('IMAGE_TOO_LARGE');
  const sx = bitmapWidth / geometry.viewport.width, sy = bitmapHeight / geometry.viewport.height;
  if (Math.abs(sx / sy - 1) > 0.02) throw new TranslationError('STALE_IMAGE');
  const left = Math.max(0, Math.ceil(geometry.clip.x * sx));
  const top = Math.max(0, Math.ceil(geometry.clip.y * sy));
  const right = Math.min(bitmapWidth, Math.floor((geometry.clip.x + geometry.clip.width) * sx));
  const bottom = Math.min(bitmapHeight, Math.floor((geometry.clip.y + geometry.clip.height) * sy));
  if (right <= left || bottom <= top) throw new TranslationError('UNSUPPORTED_IMAGE');
  const sourceBox: NormalizedBox = {
    x: Math.max(0, (left / sx - geometry.painted.x) / geometry.painted.width),
    y: Math.max(0, (top / sy - geometry.painted.y) / geometry.painted.height),
    width: (right - left) / sx / geometry.painted.width,
    height: (bottom - top) / sy / geometry.painted.height,
  };
  if (!isNormalizedBox(sourceBox)) throw new TranslationError('INVALID_COORDINATES');
  return { pixels: { x: left, y: top, width: right - left, height: bottom - top }, sourceBox };
}

export function mapCaptureBox(box: NormalizedBox, crop: NormalizedBox): NormalizedBox {
  if (!isNormalizedBox(box) || !isNormalizedBox(crop)) throw new TranslationError('INVALID_COORDINATES');
  return { x: crop.x + box.x * crop.width, y: crop.y + box.y * crop.height, width: box.width * crop.width, height: box.height * crop.height };
}

export function sameCaptureGeometry(a: CaptureGeometry, b: CaptureGeometry): boolean {
  const values = (geometry: CaptureGeometry): readonly number[] => [
    geometry.clip.x, geometry.clip.y, geometry.clip.width, geometry.clip.height,
    geometry.painted.x, geometry.painted.y, geometry.painted.width, geometry.painted.height,
    geometry.viewport.width, geometry.viewport.height, geometry.viewport.dpr,
    geometry.viewport.scale, geometry.viewport.offsetLeft, geometry.viewport.offsetTop,
  ];
  const second = values(b);
  return values(a).every((value, index) => Math.abs(value - second[index]!) < 0.1);
}

export function mapCapturePoint(point: NormalizedPoint, crop: NormalizedBox): NormalizedPoint {
  return { x: crop.x + point.x * crop.width, y: crop.y + point.y * crop.height };
}
