import { isValidPolygon } from '../core/region-metadata';
import { isNormalizedBox } from '../core/geometry';
import type { NormalizedBox, NormalizedPoint, RegionMetadata } from '../core/types';
import { TranslationError } from '../translation/errors';
import { objectValue } from '../translation/schema';
import type { DetectedLanguage, TranslatedRegion, TranslationOutput } from '../translation/types';
import type { RegionOverride, UserRegionEdits } from './types';

const languages: readonly DetectedLanguage[] = ['en', 'ja', 'zh', 'ko', 'mixed', 'unknown'];
const forbiddenIds = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);
function invalid(): never { throw new TranslationError('INVALID_COORDINATES'); }
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) && !forbiddenIds.has(value);
}
function validBox(input: unknown): input is NormalizedBox {
  const value = objectValue(input);
  return Boolean(value && ['x', 'y', 'width', 'height'].every((key) => typeof value[key] === 'number') && isNormalizedBox(value as unknown as NormalizedBox));
}
function cloneBox(box: NormalizedBox): NormalizedBox { return { x: box.x, y: box.y, width: box.width, height: box.height }; }

/** Shared renderer/edit validation prevents two coordinate contracts from diverging. */
export function validEditPolygon(input: unknown, box: NormalizedBox): input is readonly NormalizedPoint[] {
  return isValidPolygon(input, box);
}

/** Copy only public, validated metadata. Unknown fields and credentials are never persisted. */
export function cleanRegionMetadata(input: RegionMetadata, box: NormalizedBox): RegionMetadata {
  const result: Record<string, unknown> = {};
  if (input.polygon !== undefined) {
    if (!validEditPolygon(input.polygon, box)) invalid();
    result['polygon'] = input.polygon.map((point) => ({ x: point.x, y: point.y }));
  }
  if (input.kind !== undefined) {
    if (!['dialogue', 'narration', 'sfx', 'other'].includes(input.kind)) invalid();
    result['kind'] = input.kind;
  }
  if (input.direction !== undefined) {
    if (!['horizontal', 'vertical', 'rotated'].includes(input.direction)) invalid();
    result['direction'] = input.direction;
  }
  for (const key of ['ocrConfidence', 'positionConfidence'] as const) if (input[key] !== undefined) {
    const value = input[key];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) invalid();
    result[key] = value;
  }
  for (const key of ['reviewRequired', 'edited'] as const) if (input[key] !== undefined) {
    if (typeof input[key] !== 'boolean') invalid();
    result[key] = input[key];
  }
  if (input.backgroundColor !== undefined) {
    if (typeof input.backgroundColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.backgroundColor)) invalid();
    result['backgroundColor'] = input.backgroundColor;
  }
  if (input.backgroundVariance !== undefined) {
    if (typeof input.backgroundVariance !== 'number' || !Number.isFinite(input.backgroundVariance) || input.backgroundVariance < 0 || input.backgroundVariance > 1) invalid();
    result['backgroundVariance'] = input.backgroundVariance;
  }
  return result as RegionMetadata;
}

export function cleanTranslatedRegion(input: unknown): TranslatedRegion {
  const value = objectValue(input);
  if (!value || !validId(value['id']) || !validBox(value['box']) || typeof value['text'] !== 'string' || !value['text'].trim()
    || value['text'].length > 8000 || typeof value['sourceText'] !== 'string' || value['sourceText'].length > 4000
    || !languages.includes(value['sourceLanguage'] as DetectedLanguage)) throw new TranslationError('INVALID_JSON');
  return { id: value['id'], text: value['text'], sourceText: value['sourceText'], sourceLanguage: value['sourceLanguage'] as DetectedLanguage,
    box: cloneBox(value['box']), ...cleanRegionMetadata(value as RegionMetadata, value['box']) };
}

export function cleanTranslationOutput(output: TranslationOutput): TranslationOutput {
  if (!languages.includes(output.sourceLanguage) || !Array.isArray(output.regions) || output.regions.length > 500) throw new TranslationError('INVALID_JSON');
  const regions = output.regions.map(cleanTranslatedRegion);
  if (new Set(regions.map((region) => region.id)).size !== regions.length) throw new TranslationError('INVALID_JSON');
  const value = { sourceLanguage: output.sourceLanguage, regions };
  if (JSON.stringify(value).length > 1_000_000) throw new TranslationError('INVALID_JSON');
  return value;
}

export interface RegionEditsInput {
  readonly overrides: Readonly<Record<string, RegionOverride>>;
  readonly added: readonly TranslatedRegion[];
}

/** Validates a complete override document, not a mutable patch to the raw OCR result. */
export function validateRegionEdits(input: unknown, original: TranslationOutput): RegionEditsInput {
  const value = objectValue(input);
  if (!value || Object.keys(value).some((key) => !['overrides', 'added', 'revision', 'updatedAt'].includes(key))) throw new TranslationError('INVALID_JSON');
  const rawOverrides = value['overrides'] === undefined ? {} : objectValue(value['overrides']);
  const rawAdded = value['added'] === undefined ? [] : value['added'];
  if (!rawOverrides || !Array.isArray(rawAdded) || Object.keys(rawOverrides).length > 500 || rawAdded.length + original.regions.length > 500) throw new TranslationError('INVALID_JSON');
  const originalById = new Map(original.regions.map((region) => [region.id, region]));
  const overrides: Record<string, RegionOverride> = Object.create(null) as Record<string, RegionOverride>;
  for (const id of Object.keys(rawOverrides)) {
    const raw = objectValue(rawOverrides[id]), source = originalById.get(id);
    if (!validId(id) || !source || !raw || Object.keys(raw).some((key) => !['text', 'box', 'polygon', 'hidden'].includes(key))) throw new TranslationError('INVALID_JSON');
    if (own(raw, 'text') && (typeof raw['text'] !== 'string' || !raw['text'].trim() || raw['text'].length > 8000)) throw new TranslationError('INVALID_JSON');
    if (own(raw, 'box') && !validBox(raw['box'])) invalid();
    if (own(raw, 'hidden') && typeof raw['hidden'] !== 'boolean') throw new TranslationError('INVALID_JSON');
    const box = validBox(raw['box']) ? raw['box'] : source.box;
    if (own(raw, 'polygon') && raw['polygon'] !== null && !validEditPolygon(raw['polygon'], box)) invalid();
    overrides[id] = {
      ...(own(raw, 'text') ? { text: raw['text'] as string } : {}),
      ...(own(raw, 'box') ? { box: cloneBox(box) } : {}),
      ...(own(raw, 'polygon') ? { polygon: raw['polygon'] === null ? null : (raw['polygon'] as readonly NormalizedPoint[]).map((point) => ({ x: point.x, y: point.y })) } : {}),
      ...(own(raw, 'hidden') ? { hidden: raw['hidden'] as boolean } : {}),
    };
  }
  const added = rawAdded.map((region) => ({ ...cleanTranslatedRegion(region), edited: true, reviewRequired: false }));
  const ids = new Set(originalById.keys());
  for (const region of added) { if (ids.has(region.id)) throw new TranslationError('INVALID_JSON'); ids.add(region.id); }
  const result = { overrides, added };
  if (JSON.stringify(result).length > 1_000_000) throw new TranslationError('INVALID_JSON');
  return result;
}

export function cleanUserRegionEdits(input: UserRegionEdits, original: TranslationOutput): UserRegionEdits {
  if (typeof input.revision !== 'string' || !/^[a-f0-9]{32}$/.test(input.revision) || !Number.isFinite(input.updatedAt) || input.updatedAt < 0) throw new TranslationError('INVALID_JSON');
  return { revision: input.revision, updatedAt: input.updatedAt, ...validateRegionEdits(input, original) };
}

export function applyRegionEdits(original: TranslationOutput, edits?: UserRegionEdits): TranslationOutput {
  if (!edits) return original;
  const validated = validateRegionEdits(edits, original);
  const regions = original.regions.flatMap((region): TranslatedRegion[] => {
    const override = validated.overrides[region.id];
    if (!override) return [region];
    if (override.hidden) return [];
    const box = override.box ?? region.box;
    const polygon = override.polygon === null ? undefined : override.polygon ?? (region.polygon && override.box ? region.polygon.map((point) => ({
      x: box.x + (point.x - region.box.x) / region.box.width * box.width,
      y: box.y + (point.y - region.box.y) / region.box.height * box.height,
    })) : region.polygon);
    const { polygon: _originalPolygon, ...base } = region;
    const { polygon: _overridePolygon, hidden: _hidden, ...changes } = override;
    void _originalPolygon; void _overridePolygon; void _hidden;
    return [{ ...base, ...changes, box, ...(polygon ? { polygon } : {}), edited: true, reviewRequired: false }];
  });
  return cleanTranslationOutput({ sourceLanguage: original.sourceLanguage, regions: [...regions, ...validated.added] });
}
