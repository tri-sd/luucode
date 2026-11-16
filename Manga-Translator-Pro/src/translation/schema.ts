import { isNormalizedBox } from '../core/geometry';
import { TranslationError } from './errors';
import { isValidRegionMetadata } from '../core/region-metadata';
import type { DetectedLanguage, VisionOutput, VisionRegion } from './types';

export const VISION_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['coordinateSystem', 'sourceLanguage', 'regions'],
  properties: {
    coordinateSystem: { type: 'string', enum: ['normalized_1000'] },
    sourceLanguage: { type: 'string', enum: ['en', 'ja', 'zh', 'ko', 'mixed', 'unknown'] },
    regions: {
      type: 'array', maxItems: 100,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'sourceText', 'translatedText', 'bbox'],
        properties: {
          id: { type: 'string', description: 'Unique region ID in reading order.' },
          sourceText: { type: 'string', description: 'Exact source text; do not invent unreadable words.' },
          translatedText: { type: 'string', description: 'Natural Vietnamese translation.' },
          bbox: {
            type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4,
            description: '[ymin, xmin, ymax, xmax], coordinates normalized to 0..1000 of the supplied image.',
          },
        },
      },
    },
  },
} as const;

/** Detailed provider schema; legacy outputs remain readable for cached v0.4 chapters. */
export const VISION_JSON_SCHEMA_V2 = {
  ...VISION_JSON_SCHEMA,
  properties: { ...VISION_JSON_SCHEMA.properties, regions: {
    ...VISION_JSON_SCHEMA.properties.regions,
    items: {
      ...VISION_JSON_SCHEMA.properties.regions.items,
      required: ['id', 'sourceText', 'translatedText', 'bbox', 'polygon', 'kind', 'direction', 'ocrConfidence', 'positionConfidence', 'reviewRequired'],
      properties: { ...VISION_JSON_SCHEMA.properties.regions.items.properties,
        polygon: { type: ['array', 'null'], minItems: 3, maxItems: 16,
          description: 'Text boundary polygon in source-image coordinates 0..1000, points {x,y}; contained in bbox. null if not reliably determined. Never invent precision.',
          items: { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: {
            x: { type: 'number', minimum: 0, maximum: 1000 }, y: { type: 'number', minimum: 0, maximum: 1000 },
          } } },
        kind: { type: 'string', enum: ['dialogue', 'narration', 'sfx', 'other'] },
        direction: { type: 'string', enum: ['horizontal', 'vertical', 'rotated'] },
        ocrConfidence: { type: ['number', 'null'], minimum: 0, maximum: 1, description: 'Self-reported transcription confidence, unknown=null; not a calibrated probability.' },
        positionConfidence: { type: ['number', 'null'], minimum: 0, maximum: 1, description: 'Self-reported region-location confidence separately from OCR, unknown=null.' },
        reviewRequired: { type: 'boolean' },
      },
    },
  } },
} as const;

export function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function onlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => key in value);
}

function text(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

export function parseVisionJson(input: string): VisionOutput {
  if (input.length > 500_000) throw new TranslationError('INVALID_JSON');
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { throw new TranslationError('INVALID_JSON'); }
  const root = objectValue(parsed);
  if (!root || !onlyKeys(root, ['coordinateSystem', 'sourceLanguage', 'regions'])
    || root['coordinateSystem'] !== 'normalized_1000'
    || typeof root['sourceLanguage'] !== 'string' || !['en', 'ja', 'zh', 'ko', 'mixed', 'unknown'].includes(root['sourceLanguage'])
    || !Array.isArray(root['regions']) || root['regions'].length > 100) throw new TranslationError('INVALID_JSON');
  const ids = new Set<string>();
  const regions: VisionRegion[] = root['regions'].map((raw: unknown) => {
    const region = objectValue(raw);
    const allowed = ['id', 'sourceText', 'translatedText', 'bbox', 'polygon', 'kind', 'direction', 'ocrConfidence', 'positionConfidence', 'reviewRequired'];
    if (!region || !['id', 'sourceText', 'translatedText', 'bbox'].every((key) => key in region) || Object.keys(region).some((key) => !allowed.includes(key))
      || !text(region['id'], 80) || ids.has(region['id'])
      || !text(region['sourceText'], 4000) || !text(region['translatedText'], 8000)
      || !Array.isArray(region['bbox']) || region['bbox'].length !== 4) throw new TranslationError('INVALID_JSON');
    ids.add(region['id']);
    const values: unknown[] = region['bbox'];
    if (!values.every((number) => typeof number === 'number' && Number.isFinite(number) && number >= -5 && number <= 1005)) {
      throw new TranslationError('INVALID_COORDINATES');
    }
    const [y0, x0, y1, x1] = (values as number[]).map((number) => Math.max(0, Math.min(1000, number)) / 1000);
    const box = { x: x0!, y: y0!, width: x1! - x0!, height: y1! - y0! };
    if (!isNormalizedBox(box)) throw new TranslationError('INVALID_COORDINATES');
    const metadata: Record<string, unknown> = {};
    if (region['polygon'] !== undefined && region['polygon'] !== null) {
      if (!Array.isArray(region['polygon']) || region['polygon'].length < 3 || region['polygon'].length > 16) throw new TranslationError('INVALID_COORDINATES');
      metadata['polygon'] = region['polygon'].map((input: unknown) => {
        const point = objectValue(input);
        if (!point || !onlyKeys(point, ['x', 'y']) || typeof point['x'] !== 'number' || typeof point['y'] !== 'number'
          || ![point['x'], point['y']].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)) throw new TranslationError('INVALID_COORDINATES');
        return { x: point['x'] / 1000, y: point['y'] / 1000 };
      });
    }
    for (const key of ['kind', 'direction', 'ocrConfidence', 'positionConfidence', 'reviewRequired']) {
      if (region[key] !== undefined) metadata[key] = region[key];
    }
    if (!isValidRegionMetadata(metadata, box)) throw new TranslationError('INVALID_COORDINATES');
    return { ...metadata, id: region['id'], sourceText: region['sourceText'].trim(), translatedText: region['translatedText'].trim(), box };
  });
  return { sourceLanguage: root['sourceLanguage'] as DetectedLanguage, regions };
}
