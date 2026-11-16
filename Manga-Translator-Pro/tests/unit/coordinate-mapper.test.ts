import { describe, expect, it } from 'vitest';
import { fittedImageRect, intersectRects, parseObjectPosition } from '../../src/core/geometry';
import { mapRegionToRenderedImage } from '../../src/tracking/coordinate-mapper';

describe('source-to-rendered coordinate mapper', () => {
  const region = { x: 0.12, y: 0.15, width: 0.34, height: 0.11 };
  it('does not accumulate error after 100 scroll updates', () => {
    for (let index = 0; index < 100; index++) {
      const y = index % 2 === 0 ? -index * 17.25 : index * 3.75;
      const mapped = mapRegionToRenderedImage(region, { x: 13.25, y, width: 500.5, height: 800.8 });
      expect(mapped.x).toBeCloseTo(73.31, 8);
      expect(mapped.y).toBeCloseTo(y + 120.12, 8);
      expect(mapped.width).toBeCloseTo(170.17, 8);
    }
  });
  it('maps contain letterboxing and non-centered object position', () => {
    const painted = fittedImageRect({ x: 12, y: 30, width: 600, height: 600 }, 1000, 1600, 'contain', parseObjectPosition('25% 75%')!);
    expect(mapRegionToRenderedImage(region, painted)).toEqual({ x: 113.25, y: 120, width: 127.50000000000001, height: 66 });
  });
  it('keeps source coordinates after cover cropping instead of rescaling into clip', () => {
    const painted = fittedImageRect({ x: 0, y: 0, width: 600, height: 600 }, 1000, 1600, 'cover', parseObjectPosition('25% 75%')!);
    const mapped = mapRegionToRenderedImage({ x: 0.1, y: 0.5, width: 0.2, height: 0.2 }, painted);
    expect(mapped).toEqual({ x: 60, y: 210, width: 120, height: 192 });
    expect(intersectRects(mapped, { x: 0, y: 0, width: 600, height: 600 })).toEqual(mapped);
  });
  it.each([0.8, 1, 1.25, 1.5])('uses measured CSS pixels at zoom %s without multiplying DPR again', (scale) => {
    const mapped = mapRegionToRenderedImage({ x: .2, y: .25, width: .3, height: .1 }, { x: 50, y: -200, width: 1000 * scale, height: 1600 * scale });
    expect(mapped.x).toBe(50 + 200 * scale);
    expect(mapped.y).toBe(-200 + 400 * scale);
    expect(mapped.width).toBe(300 * scale);
  });
  it('rejects missing dimensions and invalid OCR boxes', () => {
    expect(() => mapRegionToRenderedImage(region, { x: 0, y: 0, width: 0, height: 100 })).toThrow(RangeError);
    expect(() => mapRegionToRenderedImage(region, { x: NaN, y: 0, width: 100, height: 100 })).toThrow(RangeError);
    expect(() => mapRegionToRenderedImage({ ...region, x: .9 }, { x: 0, y: 0, width: 100, height: 100 })).toThrow(RangeError);
  });
});
