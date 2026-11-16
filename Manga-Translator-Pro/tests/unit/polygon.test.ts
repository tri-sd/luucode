import { describe, expect, it } from 'vitest';
import { isRegionPositionTrusted, isValidPolygon, isValidRegionMetadata, polygonClipPath, regionRenderKey } from '../../src/core/region-metadata';
import { validateRegions } from '../../src/core/regions';
import type { TextRegion } from '../../src/core/types';
import { mapRegionToRenderedImage, mapRenderedPointToImage } from '../../src/tracking/coordinate-mapper';

const box = { x: .1, y: .2, width: .5, height: .4 };
const polygon = [{ x: .1, y: .2 }, { x: .6, y: .2 }, { x: .6, y: .6 }, { x: .1, y: .6 }];
const region: TextRegion = { id: 'bubble-1', text: 'Chúng ta bắt đầu thôi!', box, polygon, ocrConfidence: .8, positionConfidence: .95 };

describe('source-normalized polygons and confidence metadata', () => {
  it('accepts both winding directions and a conventional repeated closing vertex', () => {
    expect(isValidPolygon(polygon, box)).toBe(true);
    expect(isValidPolygon([...polygon].reverse(), box)).toBe(true);
    expect(isValidPolygon([...polygon, polygon[0]!], box)).toBe(true);
  });
  it.each([
    [{ x: .1, y: .2 }, { x: .6, y: .6 }, { x: .6, y: .2 }, { x: .1, y: .6 }],
    [{ x: .1, y: .2 }, { x: .2, y: .3 }, { x: .3, y: .4 }],
    [{ x: .1, y: .2 }, { x: .1, y: .2 }, { x: .6, y: .6 }],
    [{ x: NaN, y: .2 }, { x: .6, y: .2 }, { x: .6, y: .6 }],
    [{ x: -.1, y: .2 }, { x: .6, y: .2 }, { x: .6, y: .6 }],
    [{ x: .1, y: .2 }, { x: 1.1, y: .2 }, { x: .6, y: .6 }],
  ].map((vertices) => ({ vertices })))('rejects crossing, degenerate, repeated, non-finite and out-of-image vertices %#', ({ vertices }) => {
    expect(isValidPolygon(vertices)).toBe(false);
  });
  it('rejects an otherwise valid polygon outside its declared bbox and oversized polygons', () => {
    expect(isValidPolygon(polygon, { ...box, width: .2 })).toBe(false);
    expect(isValidPolygon(Array.from({ length: 17 }, (_, i) => ({ x: .4 + .1 * Math.cos(i), y: .4 + .1 * Math.sin(i) })))).toBe(false);
  });
  it('detects crossings in small normalized polygons without relying on CSS pixel size', () => {
    const small = [{ x: .001, y: .001 }, { x: .003, y: .003 }, { x: .003, y: .001 }, { x: .001, y: .003 }];
    expect(isValidPolygon(small)).toBe(false);
  });
  it('validates unknown/null and independent OCR/location confidence without inventing a probability', () => {
    expect(isValidRegionMetadata({ ocrConfidence: null, positionConfidence: .2 }, box)).toBe(true);
    expect(isRegionPositionTrusted({ ocrConfidence: .99, positionConfidence: .2 })).toBe(false);
    expect(isRegionPositionTrusted({ ocrConfidence: .1, positionConfidence: .95 })).toBe(true);
    expect(isRegionPositionTrusted({})).toBe(true);
    expect(isRegionPositionTrusted({ positionConfidence: null })).toBe(true);
    expect(isRegionPositionTrusted({ positionConfidence: .2, edited: true })).toBe(true);
  });
  it.each([null, 'bad', [], { ocrConfidence: -1 }, { positionConfidence: 1.01 }, { positionConfidence: '0.9' },
    { backgroundColor: 'url(https://example.test)' }, { backgroundVariance: NaN }, { direction: 'diagonal' }, { kind: 'artwork' }])('rejects invalid metadata %#', (value) => {
    expect(isValidRegionMetadata(value)).toBe(false);
  });
  it('accepts safe background estimation metadata and validates it in region results', () => {
    expect(validateRegions([{ ...region, backgroundColor: '#20202A', backgroundVariance: .01, kind: 'dialogue', direction: 'vertical' }])).toBe(true);
    expect(validateRegions([{ ...region, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }])).toBe(false);
  });
  it('converts full-source polygon into its own bbox clip path without screen coordinates', () => {
    expect(polygonClipPath(polygon, box)).toBe('polygon(0.0000% 0.0000%, 100.0000% 0.0000%, 100.0000% 100.0000%, 0.0000% 100.0000%)');
    expect(() => polygonClipPath(polygon, { ...box, width: .1 })).toThrow();
  });
  it('uses metadata-inclusive render equality so geometry/palette/confidence edits cannot be ignored', () => {
    expect(regionRenderKey(structuredClone(region))).toBe(regionRenderKey(region));
    expect(regionRenderKey({ ...region, positionConfidence: .1 })).not.toBe(regionRenderKey(region));
    expect(regionRenderKey({ ...region, backgroundColor: '#111111' })).not.toBe(regionRenderKey(region));
    expect(regionRenderKey({ ...region, polygon: polygon.map((point) => ({ ...point, x: point.x + .00001 })) })).not.toBe(regionRenderKey(region));
  });
});

describe('manual coordinate inverse', () => {
  it('maps a CSS pointer through current painted source rect once, independently of DPR', () => {
    const painted = { x: 43.25, y: -315.5, width: 650, height: 1040 };
    const projected = mapRegionToRenderedImage(box, painted);
    expect(mapRenderedPointToImage({ x: projected.x, y: projected.y }, painted)).toEqual({ x: .1, y: .2 });
  });
  it('rejects invalid geometry and handles clamp only when explicitly requested', () => {
    const painted = { x: 100, y: 20, width: 500, height: 800 };
    expect(() => mapRenderedPointToImage({ x: 10, y: 0 }, painted)).toThrow();
    expect(mapRenderedPointToImage({ x: 10, y: 2000 }, painted, true)).toEqual({ x: 0, y: 1 });
    expect(() => mapRenderedPointToImage({ x: 10, y: 0 }, { ...painted, width: 0 })).toThrow();
  });
});
