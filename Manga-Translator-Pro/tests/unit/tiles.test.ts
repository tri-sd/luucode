import { describe, expect, it } from 'vitest';
import { deduplicateRegions, mapTileRegions, planTiles } from '../../src/translation/tiles';
import type { TranslatedRegion } from '../../src/translation/types';
import { TranslationError } from '../../src/translation/errors';

describe('source-image tiling', () => {
  it('leaves an ordinary manga page as one tile', () => {
    expect(planTiles(1000, 1600)).toEqual([{ index: 0, x: 0, y: 0, width: 1000, height: 1600, sourceWidth: 1000, sourceHeight: 1600 }]);
  });
  it('covers a long webtoon with overlap and maps regions back into the full source image', () => {
    const tiles = planTiles(1000, 3600);
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.y + tiles[0]!.height - tiles[1]!.y).toBe(192);
    const result = mapTileRegions({ sourceLanguage: 'ko', regions: [{ id: 'r', sourceText: '안녕', translatedText: 'Xin chào', box: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } }] }, tiles[1]!)[0]!;
    expect(result.box.x).toBeCloseTo(0.1);
    expect(result.box.y).toBeCloseTo((1856 + 1744 * 0.2) / 3600);
    expect(result.sourceText).toBe('안녕');
    expect(result.text).toBe('Xin chào');
    expect(result.id).toBe('tile-1-r');
  });
  it.each([[0, 1000], [1000, 0], [NaN, 1000], [1000, 30000], [10000, 10000]])('bounds memory and billable tile requests for %j x %j', (width, height) => {
    expect(() => planTiles(width, height)).toThrow(new TranslationError('IMAGE_TOO_LARGE'));
  });
  it('removes duplicate OCR in overlap without deleting repeated dialogue at other positions', () => {
    const region: TranslatedRegion = { id: 'a', sourceText: 'Hello!', sourceLanguage: 'en', text: 'Xin chào!', box: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 } };
    const overlapping = { ...region, id: 'b', box: { ...region.box, x: 0.101 } };
    const repeated = { ...region, id: 'c', box: { ...region.box, y: 0.6 } };
    const different = { ...region, id: 'd', sourceText: 'Wait!' };
    expect(deduplicateRegions([region, overlapping, repeated, different]).map((item) => item.id)).toEqual(['a', 'c', 'd']);
  });
});
