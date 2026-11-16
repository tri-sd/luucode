import { describe, expect, it } from 'vitest';
import { fittedImageRect, intersectRects, isNormalizedBox, isSupportedScale, isSupportedTransform, parseObjectPosition, projectBox } from '../../src/core/geometry';

describe('normalized regions', () => {
  it('projects subpixel image coordinates without rounding drift', () => {
    expect(projectBox({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, { x: 17.5, y: -123.25, width: 625, height: 1250 }))
      .toEqual({ x: 80, y: 126.75, width: 187.5, height: 500 });
  });

  it.each([
    { x: -0.1, y: 0, width: 0.1, height: 0.1 },
    { x: 0, y: 0.9, width: 0.1, height: 0.2 },
    { x: 0.95, y: 0, width: 0.1, height: 0.1 },
    { x: 0, y: 0, width: 0, height: 0.1 },
    { x: 0, y: NaN, width: 0.1, height: 0.1 },
    { x: 0, y: 0, width: Infinity, height: 0.1 },
  ])('rejects an invalid region: %j', (box) => {
    expect(isNormalizedBox(box)).toBe(false);
    expect(() => projectBox(box, { x: 0, y: 0, width: 100, height: 100 })).toThrow(RangeError);
  });

  it('preserves the same image-relative position after scrolling and scaling', () => {
    const box = { x: 0.2, y: 0.25, width: 0.5, height: 0.25 };
    expect(projectBox(box, { x: 0, y: -600, width: 400, height: 800 }))
      .toEqual({ x: 80, y: -400, width: 200, height: 200 });
    expect(projectBox(box, { x: 50, y: 0, width: 800, height: 1600 }))
      .toEqual({ x: 210, y: 400, width: 400, height: 400 });
  });
});

describe('painted image geometry', () => {
  const center = parseObjectPosition('50% 50%')!;
  const square = { x: 10, y: 20, width: 400, height: 400 };

  it('accounts for contain letterboxing', () => {
    const result = fittedImageRect(square, 800, 1200, 'contain', center);
    expect(result.x).toBeCloseTo(10 + 200 / 3, 10);
    expect(result.width).toBeCloseTo(800 / 3, 10);
    expect(result.y).toBe(20);
    expect(result.height).toBe(400);
  });
  it('accounts for cover cropping and bottom alignment', () => {
    expect(fittedImageRect(square, 800, 1200, 'cover', parseObjectPosition('right bottom')!))
      .toEqual({ x: 10, y: -180, width: 400, height: 600 });
  });
  it('supports fill without assuming an intrinsic aspect ratio', () => {
    expect(fittedImageRect(square, 800, 1200, 'fill', center)).toEqual(square);
  });
  it('keeps intrinsic size for none', () => {
    expect(fittedImageRect(square, 800, 1200, 'none', center))
      .toEqual({ x: -190, y: -380, width: 800, height: 1200 });
  });
  it('does not upscale scale-down', () => {
    expect(fittedImageRect(square, 100, 200, 'scale-down', center))
      .toEqual({ x: 160, y: 120, width: 100, height: 200 });
  });
  it('scales pixel offsets along with ancestor scale', () => {
    expect(fittedImageRect(square, 100, 200, 'none', parseObjectPosition('10px 20px')!, 2, 1.5))
      .toEqual({ x: 30, y: 50, width: 200, height: 300 });
  });
  it('rejects unloaded image dimensions', () => {
    expect(() => fittedImageRect(square, 0, 1200, 'contain', center)).toThrow(RangeError);
  });
  it.each(['calc(50% + 10px) 50%', 'left 20px top 10px', 'bad value'])('rejects unsupported object-position %s', (input) => {
    expect(parseObjectPosition(input)).toBeNull();
  });
  it.each([
    ['left top', 0, 0], ['center', 0.5, 0.5], ['bottom', 0.5, 1], ['25% 75%', 0.25, 0.75],
  ] as const)('parses %s', (input, x, y) => {
    expect(parseObjectPosition(input)).toEqual({ x: { value: x, unit: '%' }, y: { value: y, unit: '%' } });
  });
});

describe('clipping and transform support', () => {
  it('clips an image within a nested reader viewport', () => {
    expect(intersectRects({ x: 10, y: -50, width: 300, height: 500 }, { x: 0, y: 0, width: 200, height: 300 }))
      .toEqual({ x: 10, y: 0, width: 190, height: 300 });
  });
  it('rejects fully invisible and zero-area intersections', () => {
    expect(intersectRects({ x: 0, y: 0, width: 100, height: 100 }, { x: 100, y: 0, width: 100, height: 100 })).toBeNull();
  });
  it.each(['none', 'matrix(1.25, 0, 0, 0.75, 10, -20)', 'matrix3d(.5,0,0,0, 0,.5,0,0, 0,0,1,0, 13,-42,0,1)'])('supports %s', (value) => {
    expect(isSupportedTransform(value)).toBe(true);
  });
  it.each(['matrix(0, 1, -1, 0, 0, 0)', 'matrix(-1, 0, 0, 1, 0, 0)', 'matrix(1, 0.1, 0, 1, 0, 0)', 'matrix3d(1, 0, 0, 0)', 'matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,.2, 0,0,0,1)'])('skips %s', (value) => {
    expect(isSupportedTransform(value)).toBe(false);
  });
  it.each(['none', '1.25', '1.25 0.8'])('accepts independent scale %s', (value) => {
    expect(isSupportedScale(value)).toBe(true);
  });
  it.each(['-1 1', '0', '1 1 2', 'invalid'])('rejects independent scale %s', (value) => {
    expect(isSupportedScale(value)).toBe(false);
  });
});
