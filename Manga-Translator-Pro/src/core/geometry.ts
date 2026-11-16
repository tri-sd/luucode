import type { NormalizedBox, Rect } from './types';

export type ObjectFit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';

export interface ObjectPosition {
  readonly x: { readonly value: number; readonly unit: '%' | 'px' };
  readonly y: { readonly value: number; readonly unit: '%' | 'px' };
}

export function isNormalizedBox(box: NormalizedBox): boolean {
  return [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
    && box.x + box.width <= 1 + 1e-9 && box.y + box.height <= 1 + 1e-9;
}

export function projectBox(box: NormalizedBox, image: Rect): Rect {
  if (!isNormalizedBox(box)) throw new RangeError('Invalid normalized region');
  return {
    x: image.x + box.x * image.width,
    y: image.y + box.y * image.height,
    width: box.width * image.width,
    height: box.height * image.height,
  };
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** Deliberately reject calc(), edge offsets and ambiguous syntax in Phase 1. */
export function parseObjectPosition(input: string): ObjectPosition | null {
  const tokens = input.trim().toLowerCase().split(/\s+/);
  if (tokens.length === 1) {
    const first = tokens[0];
    if (first === 'top' || first === 'bottom') tokens.unshift('center');
    else tokens.push('center');
  }
  if (tokens.length !== 2) return null;
  if (tokens[0] === 'top' || tokens[0] === 'bottom') tokens.reverse();
  const axis = (token: string | undefined, horizontal: boolean): ObjectPosition['x'] | null => {
    if (token === 'center') return { value: 0.5, unit: '%' };
    if (token === (horizontal ? 'left' : 'top')) return { value: 0, unit: '%' };
    if (token === (horizontal ? 'right' : 'bottom')) return { value: 1, unit: '%' };
    const match = token?.match(/^(-?\d+(?:\.\d+)?)(%|px)$/);
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return null;
    return match[2] === '%' ? { value: value / 100, unit: '%' } : { value, unit: 'px' };
  };
  const x = axis(tokens[0], true);
  const y = axis(tokens[1], false);
  return x && y ? { x, y } : null;
}

/** Return the painted source-image rectangle, including letterboxing/cropping. */
export function fittedImageRect(
  content: Rect,
  naturalWidth: number,
  naturalHeight: number,
  fit: ObjectFit,
  position: ObjectPosition,
  scaleX = 1,
  scaleY = 1,
): Rect {
  if (![naturalWidth, naturalHeight, content.x, content.y, content.width, content.height, scaleX, scaleY].every(Number.isFinite)
    || !(naturalWidth > 0 && naturalHeight > 0 && content.width > 0 && content.height > 0 && scaleX > 0 && scaleY > 0)) {
    throw new RangeError('Image dimensions must be positive');
  }
  const intrinsicWidth = naturalWidth * scaleX;
  const intrinsicHeight = naturalHeight * scaleY;
  const contain = Math.min(content.width / intrinsicWidth, content.height / intrinsicHeight);
  const cover = Math.max(content.width / intrinsicWidth, content.height / intrinsicHeight);
  const factor = fit === 'contain' ? contain : fit === 'cover' ? cover
    : fit === 'scale-down' ? Math.min(1, contain) : 1;
  const width = fit === 'fill' ? content.width : intrinsicWidth * factor;
  const height = fit === 'fill' ? content.height : intrinsicHeight * factor;
  const offset = (space: number, axis: ObjectPosition['x'], scale: number): number =>
    axis.unit === '%' ? space * axis.value : axis.value * scale;
  return {
    x: content.x + offset(content.width - width, position.x, scaleX),
    y: content.y + offset(content.height - height, position.y, scaleY),
    width,
    height,
  };
}

/** Positive axis-aligned scale/translation only; a bounding rectangle cannot undo rotation. */
export function isSupportedTransform(transform: string): boolean {
  if (transform === 'none' || transform === '') return true;
  const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/)?.[1]?.split(',').map(Number);
  if (matrix3d) return matrix3d.length === 16 && matrix3d.every(Number.isFinite)
    && matrix3d[0]! > 0 && matrix3d[5]! > 0 && matrix3d[10]! > 0 && matrix3d[15] === 1
    && [1, 2, 3, 4, 6, 7, 8, 9, 11].every((index) => Math.abs(matrix3d[index]!) < 1e-8);
  const match = transform.match(/^matrix\(([^)]+)\)$/);
  const values = match?.[1]?.split(',').map(Number);
  if (!values || values.length !== 6 || !values.every(Number.isFinite)) return false;
  const [a, b, c, d] = values;
  return a !== undefined && d !== undefined && a > 0 && d > 0
    && Math.abs(b ?? 1) < 1e-8 && Math.abs(c ?? 1) < 1e-8;
}

export function isSupportedScale(input: string): boolean {
  if (input === '' || input === 'none') return true;
  const values = input.split(/\s+/).map(Number);
  return values.length <= 2 && values.every((value) => Number.isFinite(value) && value > 0);
}
