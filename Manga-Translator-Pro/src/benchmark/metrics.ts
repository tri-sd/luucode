import type { NormalizedBox, Rect } from '../core/types';

export interface BoxRegion { readonly box: NormalizedBox }
export interface OcrRegion extends BoxRegion { readonly sourceText: string }
export interface CssPoint { readonly x: number; readonly y: number }
export interface RegionMatch { readonly expectedIndex: number; readonly actualIndex: number; readonly iou: number }

function finiteBox(box: NormalizedBox): boolean {
  return [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;
}
export function intersectionOverUnion(a: NormalizedBox, b: NormalizedBox): number {
  if (!finiteBox(a) || !finiteBox(b)) return 0;
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = width * height;
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}

/** Maximum one-to-one cardinality, with higher-IoU edges considered first. Duplicate predictions never increase recall. */
export function matchRegions(expected: readonly BoxRegion[], actual: readonly BoxRegion[], threshold = 0.5): RegionMatch[] {
  if (!(threshold > 0 && threshold <= 1)) throw new RangeError('IoU threshold must be in (0, 1]');
  const edges = expected.map((region) => actual.map((candidate, index) => ({ index, iou: intersectionOverUnion(region.box, candidate.box) }))
    .filter((edge) => edge.iou >= threshold).sort((a, b) => b.iou - a.iou || a.index - b.index));
  const owner = new Map<number, number>();
  const augment = (expectedIndex: number, visited: Set<number>): boolean => {
    for (const edge of edges[expectedIndex] ?? []) {
      if (visited.has(edge.index)) continue;
      visited.add(edge.index);
      const previous = owner.get(edge.index);
      if (previous === undefined || augment(previous, visited)) { owner.set(edge.index, expectedIndex); return true; }
    }
    return false;
  };
  for (let index = 0; index < expected.length; index++) augment(index, new Set());
  return [...owner].map(([actualIndex, expectedIndex]) => ({ expectedIndex, actualIndex,
    iou: intersectionOverUnion(expected[expectedIndex]!.box, actual[actualIndex]!.box) })).sort((a, b) => a.expectedIndex - b.expectedIndex);
}

export function detectionMetrics(expected: readonly BoxRegion[], actual: readonly BoxRegion[], threshold = 0.5) {
  const matches = matchRegions(expected, actual, threshold);
  return { expected: expected.length, detected: actual.length, matched: matches.length,
    recall: expected.length ? matches.length / expected.length : null,
    precision: actual.length ? matches.length / actual.length : null, matches };
}

/** NFC code points; preserve interior spaces/newlines unless the caller explicitly chooses otherwise. */
export function normalizeOcrText(value: string, ignoreWhitespace = false): string {
  const normalized = value.normalize('NFC').trim();
  return ignoreWhitespace ? normalized.replace(/\s/gu, '') : normalized;
}
export function characterEditDistance(reference: string, actual: string): number {
  const left = Array.from(reference), right = Array.from(actual);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(current[column - 1]! + 1, previous[column]! + 1,
        previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[right.length]!;
}
export function characterErrorRate(reference: string, actual: string, ignoreWhitespace = false): number | null {
  const normalized = normalizeOcrText(reference, ignoreWhitespace);
  return normalized.length ? characterEditDistance(normalized, normalizeOcrText(actual, ignoreWhitespace)) / Array.from(normalized).length : null;
}

/** End-to-end OCR: omitted regions count as deletions, unmatched predicted text as insertions. CER may exceed 1. */
export function ocrMetrics(expected: readonly OcrRegion[], actual: readonly OcrRegion[], threshold = 0.5, ignoreWhitespace = false) {
  const matches = matchRegions(expected, actual, threshold);
  const referenceTexts = expected.map((region) => normalizeOcrText(region.sourceText, ignoreWhitespace));
  const actualTexts = actual.map((region) => normalizeOcrText(region.sourceText, ignoreWhitespace));
  const expectedMatches = new Map(matches.map((match) => [match.expectedIndex, match.actualIndex]));
  const matchedActual = new Set(matches.map((match) => match.actualIndex));
  let errors = 0, exact = 0;
  for (let index = 0; index < referenceTexts.length; index++) {
    const predictedIndex = expectedMatches.get(index);
    const text = predictedIndex === undefined ? '' : actualTexts[predictedIndex]!;
    errors += characterEditDistance(referenceTexts[index]!, text);
    if (predictedIndex !== undefined && referenceTexts[index] === text) exact++;
  }
  for (let index = 0; index < actualTexts.length; index++) if (!matchedActual.has(index)) errors += Array.from(actualTexts[index]!).length;
  const referenceCharacters = referenceTexts.reduce((total, text) => total + Array.from(text).length, 0);
  return { referenceCharacters, characterErrors: errors, characterErrorRate: referenceCharacters ? errors / referenceCharacters : null,
    exactRegions: exact, exactRegionRate: expected.length ? exact / expected.length : null, matchedRegions: matches.length };
}

/** Compare rendered CSS geometry, never natural pixels, DPR-scaled pixels or a missing-layer sentinel. */
export function regionPositionErrorCssPx(expected: Rect, actual: Rect): number {
  if (![expected.x, expected.y, expected.width, expected.height, actual.x, actual.y, actual.width, actual.height].every(Number.isFinite)) {
    throw new RangeError('Rendered geometry must be finite');
  }
  return Math.max(Math.abs(actual.x - expected.x), Math.abs(actual.y - expected.y), Math.abs(actual.width - expected.width), Math.abs(actual.height - expected.height));
}
export function polygonPositionErrorCssPx(expected: readonly CssPoint[], actual: readonly CssPoint[]): number | null {
  if (!expected.length || !actual.length) return null;
  if ([...expected, ...actual].some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new RangeError('Polygon coordinates must be finite CSS pixels');
  const directed = (from: readonly CssPoint[], to: readonly CssPoint[]): number => Math.max(...from.map((point) =>
    Math.min(...to.map((other) => Math.hypot(point.x - other.x, point.y - other.y)))));
  return Math.max(directed(expected, actual), directed(actual, expected));
}
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator < 0 || denominator < numerator) throw new RangeError('Invalid observation counts');
  return denominator ? numerator / denominator : null;
}
export function overflowRate(samples: readonly boolean[]): number | null { return ratio(samples.filter(Boolean).length, samples.length); }
export function cacheHitRate(hits: number, lookups: number): number | null { return ratio(hits, lookups); }
export interface ApiRequestObservation { readonly key: string; readonly kind: 'initial' | 'retry' }
export function apiRequestSummary(requests: readonly ApiRequestObservation[]) {
  const initial = new Set<string>();
  let duplicates = 0, retries = 0;
  for (const request of requests) {
    if (!request.key) throw new TypeError('A request needs a content/profile/crop scope key');
    if (request.kind === 'retry') { retries++; continue; }
    if (initial.has(request.key)) duplicates++; else initial.add(request.key);
  }
  return { total: requests.length, uniqueInitialRequests: initial.size, duplicateInitialRequests: duplicates, intentionalRetries: retries };
}
export function elapsedMs(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new RangeError('Invalid elapsed time observation');
  return end - start;
}
export function jsonByteLength(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
export interface HumanTranslationReview {
  readonly reviewer: string;
  readonly adequacy: number;
  readonly fluency: number;
  readonly terminology: number;
}
export function humanTranslationSummary(reviews: readonly HumanTranslationReview[]) {
  if (!reviews.length) return null;
  for (const review of reviews) if (!review.reviewer.trim() || [review.adequacy, review.fluency, review.terminology]
    .some((score) => !Number.isInteger(score) || score < 1 || score > 5)) throw new RangeError('Human review scores must be integers 1..5 with reviewer attribution');
  const mean = (field: 'adequacy' | 'fluency' | 'terminology'): number => reviews.reduce((total, review) => total + review[field], 0) / reviews.length;
  return { samples: reviews.length, adequacyMean: mean('adequacy'), fluencyMean: mean('fluency'), terminologyMean: mean('terminology'), scale: '1..5; human rubric, not a parity percentage' };
}
