import { describe, expect, it } from 'vitest';
import { apiRequestSummary, cacheHitRate, characterEditDistance, characterErrorRate, detectionMetrics, elapsedMs, humanTranslationSummary,
  intersectionOverUnion, jsonByteLength, matchRegions, ocrMetrics, overflowRate, polygonPositionErrorCssPx, regionPositionErrorCssPx } from '../../src/benchmark/metrics';

const left = { box: { x: .1, y: .2, width: .2, height: .2 }, sourceText: 'Hello' };
const right = { box: { x: .6, y: .2, width: .2, height: .2 }, sourceText: 'World' };

describe('evidence-based benchmark metrics', () => {
  it('does not let duplicate predictions inflate detection recall', () => {
    expect(detectionMetrics([left, right], [left, left])).toMatchObject({ expected: 2, detected: 2, matched: 1, recall: .5, precision: .5 });
  });
  it('uses maximum one-to-one matching rather than an order-dependent greedy choice', () => {
    const expected = [{ box: { x: 0, y: 0, width: .6, height: .4 } }, { box: { x: .3, y: 0, width: .4, height: .4 } }];
    const actual = [{ box: { x: .1, y: 0, width: .4, height: .4 } }, { box: { x: 0, y: 0, width: .2, height: .4 } }];
    expect(matchRegions(expected, actual, .3)).toHaveLength(2);
  });
  it('represents no evidence as null, while a missed annotated region is zero recall', () => {
    expect(detectionMetrics([], [])).toMatchObject({ recall: null, precision: null });
    expect(detectionMetrics([left], [])).toMatchObject({ recall: 0, precision: null });
  });
  it('rejects invalid IoU thresholds and ignores degenerate geometry', () => {
    expect(() => matchRegions([left], [left], 0)).toThrow();
    expect(intersectionOverUnion(left.box, { ...left.box, width: 0 })).toBe(0);
  });
  it('counts Unicode code points and normalizes canonically equivalent Vietnamese', () => {
    expect(characterEditDistance('😀日', '😀本')).toBe(1);
    expect(characterErrorRate('ấ', 'a\u0302\u0301')).toBe(0);
    expect(characterErrorRate('한국어', '한국')).toBeCloseTo(1 / 3);
  });
  it('does not silently remove whitespace and allows insertion CER greater than one', () => {
    expect(characterErrorRate('a b', 'ab')).toBeCloseTo(1 / 3);
    expect(characterErrorRate('a b', 'ab', true)).toBe(0);
    expect(characterErrorRate('a', 'abcde')).toBe(4);
    expect(characterErrorRate('', '')).toBeNull();
  });
  it('counts missed OCR regions and hallucinated unmatched text', () => {
    expect(ocrMetrics([left, right], [{ ...left, sourceText: 'Hallo' }])).toMatchObject({ referenceCharacters: 10, characterErrors: 6, characterErrorRate: .6, exactRegionRate: 0 });
    expect(ocrMetrics([left], [left, { ...right, sourceText: 'FAKE' }])).toMatchObject({ characterErrors: 4, characterErrorRate: .8 });
  });
  it('compares CSS-pixel rectangles independently of DPR', () => {
    expect(regionPositionErrorCssPx({ x: 10.25, y: -100, width: 140, height: 50 }, { x: 10.5, y: -99, width: 141.5, height: 50 })).toBe(1.5);
    expect(() => regionPositionErrorCssPx({ x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 })).toThrow();
  });
  it('matches polygon geometry independently of starting vertex order', () => {
    const expected = [{ x: 10, y: 20 }, { x: 20, y: 20 }, { x: 15, y: 30 }];
    expect(polygonPositionErrorCssPx(expected, [expected[2]!, expected[0]!, expected[1]!])).toBe(0);
    expect(polygonPositionErrorCssPx(expected, [])).toBeNull();
  });
  it('keeps cache/overflow counts explicit and absent samples unmeasured', () => {
    expect(cacheHitRate(8, 10)).toBe(.8);
    expect(cacheHitRate(0, 0)).toBeNull();
    expect(overflowRate([false, true, false, false])).toBe(.25);
    expect(overflowRate([])).toBeNull();
    expect(() => cacheHitRate(2, 1)).toThrow();
  });
  it('distinguishes duplicate initial requests from intentional quota retries and scoped crop jobs', () => {
    expect(apiRequestSummary([{ key: 'image/profile/full', kind: 'initial' }, { key: 'image/profile/full', kind: 'retry' },
      { key: 'image/profile/full', kind: 'initial' }, { key: 'image/profile/crop-a', kind: 'initial' }]))
      .toEqual({ total: 4, uniqueInitialRequests: 2, duplicateInitialRequests: 1, intentionalRetries: 1 });
  });
  it('measures UTF-8 metadata bytes and elapsed time without pretending to measure RAM', () => {
    expect(jsonByteLength('日')).toBe(5);
    expect(elapsedMs(12.5, 31)).toBe(18.5);
    expect(() => elapsedMs(31, 12.5)).toThrow();
  });
  it('does not invent translation quality without human evaluation', () => {
    expect(humanTranslationSummary([])).toBeNull();
    expect(humanTranslationSummary([{ reviewer: 'Human A', adequacy: 4, fluency: 3, terminology: 5 },
      { reviewer: 'Human B', adequacy: 2, fluency: 5, terminology: 3 }])).toMatchObject({ samples: 2, adequacyMean: 3, fluencyMean: 4, terminologyMean: 4 });
    expect(() => humanTranslationSummary([{ reviewer: '', adequacy: 5, fluency: 5, terminology: 5 }])).toThrow();
  });
});
