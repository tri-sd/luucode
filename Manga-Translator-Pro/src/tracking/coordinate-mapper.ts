import { projectBox } from '../core/geometry';
import type { NormalizedBox, NormalizedPoint, Rect } from '../core/types';

/**
 * Project an immutable source-relative OCR box onto the current painted image.
 * The caller measures painted from object-fit/position and transforms each frame.
 * Scroll, DPR and browser zoom are already reflected in that CSS-pixel rectangle;
 * multiplying by DPR here would apply the scale twice.
 */
export function mapRegionToRenderedImage(region: NormalizedBox, painted: Rect): Rect {
  if (![painted.x, painted.y, painted.width, painted.height].every(Number.isFinite)
    || painted.width <= 0 || painted.height <= 0) throw new RangeError('Invalid painted image rectangle');
  return projectBox(region, painted);
}

/** CSS pointer coordinates map back to the source once; never multiply by DPR. */
export function mapRenderedPointToImage(point: NormalizedPoint, painted: Rect, clamp = false): NormalizedPoint {
  if (![point.x, point.y, painted.x, painted.y, painted.width, painted.height].every(Number.isFinite)
    || painted.width <= 0 || painted.height <= 0) throw new RangeError('Invalid rendered image point');
  const normalized = { x: (point.x - painted.x) / painted.width, y: (point.y - painted.y) / painted.height };
  if (clamp) return { x: Math.min(1, Math.max(0, normalized.x)), y: Math.min(1, Math.max(0, normalized.y)) };
  if (normalized.x < 0 || normalized.y < 0 || normalized.x > 1 || normalized.y > 1) throw new RangeError('Point outside painted image');
  return normalized;
}
