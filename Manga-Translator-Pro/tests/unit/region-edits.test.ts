import { describe, expect, it } from 'vitest';
import { applyRegionEdits, cleanTranslatedRegion, cleanUserRegionEdits, validateRegionEdits } from '../../src/chapter/region-edits';
import { MemoryChapterStore } from '../../src/chapter/indexeddb-cache';
import { createTranslationProfile } from '../../src/chapter/identity';
import type { CachedTranslation, UserRegionEdits } from '../../src/chapter/types';
import type { TranslationOutput } from '../../src/translation/types';

const original: TranslationOutput = { sourceLanguage: 'ja', regions: [{ id: 'bubble-1', sourceText: 'こんにちは', sourceLanguage: 'ja',
  text: 'Xin chào', box: { x: .1, y: .2, width: .3, height: .2 }, polygon: [{ x: .1, y: .2 }, { x: .4, y: .2 }, { x: .4, y: .4 }, { x: .1, y: .4 }],
  kind: 'dialogue', direction: 'vertical', ocrConfidence: .9, positionConfidence: .7, reviewRequired: false, backgroundColor: '#ffffff', backgroundVariance: .01 }] };
const revision = 'a'.repeat(32);
function edits(overrides: UserRegionEdits['overrides'], added: UserRegionEdits['added'] = []): UserRegionEdits { return { revision, updatedAt: 1, overrides, added }; }

describe('persistent user region edits', () => {
  it('changes text and moves source-normalized polygon with a bbox while retaining raw OCR', () => {
    const before = structuredClone(original);
    const changed = applyRegionEdits(original, edits({ 'bubble-1': { text: 'Chào bạn!', box: { x: .2, y: .3, width: .6, height: .4 } } }));
    expect(changed.regions[0]).toMatchObject({ text: 'Chào bạn!', sourceText: 'こんにちは', edited: true, direction: 'vertical', ocrConfidence: .9 });
    expect(changed.regions[0]!.polygon![0]).toEqual({ x: .2, y: .3 });
    expect(changed.regions[0]!.polygon![2]!.x).toBeCloseTo(.8);
    expect(changed.regions[0]!.polygon![2]!.y).toBeCloseTo(.7);
    expect(original).toEqual(before);
  });
  it('lets a human explicitly discard an inaccurate provider polygon and use a bbox', () => {
    const changed = applyRegionEdits(original, edits({ 'bubble-1': { polygon: null } }));
    expect(changed.regions[0]!.polygon).toBeUndefined();
    expect(original.regions[0]!.polygon).toHaveLength(4);
  });
  it('keeps hidden originals available for reset and adds an independently identified manual region', () => {
    const added = { id: 'manual-1', sourceText: '', sourceLanguage: 'ja' as const, text: 'Chữ thêm bằng tay', box: { x: .5, y: .6, width: .2, height: .1 } };
    const changed = applyRegionEdits(original, edits({ 'bubble-1': { hidden: true } }, [added]));
    expect(changed.regions.map((region) => region.id)).toEqual(['manual-1']);
    expect(changed.regions[0]!.edited).toBe(true);
    expect(original.regions).toHaveLength(1);
    expect(applyRegionEdits(original, edits({}))).toEqual(original);
  });
  it('rejects invalid normalized boxes and crossing polygons instead of repositioning guesses', () => {
    expect(() => validateRegionEdits({ overrides: { 'bubble-1': { box: { x: .9, y: .2, width: .3, height: .1 } } } }, original)).toThrow();
    expect(() => validateRegionEdits({ overrides: { 'bubble-1': { box: { x: NaN, y: .2, width: .3, height: .1 } } } }, original)).toThrow();
    expect(() => validateRegionEdits({ overrides: { 'bubble-1': { polygon: [{ x: .1, y: .2 }, { x: .4, y: .4 }, { x: .1, y: .4 }, { x: .4, y: .2 }] } } }, original)).toThrow();
  });
  it('rejects unknown/unsafe IDs, duplicate additions and arbitrary override fields', () => {
    expect(() => validateRegionEdits({ overrides: { unknown: { text: 'Không có region' } } }, original)).toThrow();
    expect(() => validateRegionEdits(JSON.parse('{"overrides":{"__proto__":{"text":"bad"}}}'), original)).toThrow();
    expect(() => validateRegionEdits({ overrides: { 'bubble-1': { apiKey: 'NEVER_STORE' } } }, original)).toThrow();
    expect(() => validateRegionEdits({ added: [original.regions[0]] }, original)).toThrow();
  });
  it('copies only validated polygon and confidence metadata, never an arbitrary secret field', () => {
    const cleaned = cleanTranslatedRegion({ ...original.regions[0], apiKey: 'NOT_A_REAL_KEY_DO_NOT_COPY' });
    expect(cleaned).toEqual(original.regions[0]);
    expect(JSON.stringify(cleaned)).not.toContain('NOT_A_REAL_KEY');
    expect(() => cleanTranslatedRegion({ ...original.regions[0], positionConfidence: 1.1 })).toThrow();
    expect(() => cleanTranslatedRegion({ ...original.regions[0], backgroundVariance: 2 })).toThrow();
  });
  it('validates edit versions and size caps', () => {
    expect(() => cleanUserRegionEdits({ ...edits({}), revision: '' }, original)).toThrow();
    expect(() => validateRegionEdits({ overrides: { 'bubble-1': { text: 'x'.repeat(8001) } } }, original)).toThrow();
  });
  it('preserves edits and metadata when a completed cached result is checkpointed again', async () => {
    const store = new MemoryChapterStore();
    const entry: CachedTranslation = { key: 'cached', chapterId: 'chapter-1', imageId: 'image-1', contentHash: 'hash',
      profile: createTranslationProfile({ model: 'gemini-test', sourceLanguage: 'ja' }), output: original, createdAt: 1,
      userEdits: edits({ 'bubble-1': { text: 'Bản sửa được giữ' } }) };
    await store.putTranslation(entry);
    const { userEdits: _userEdits, ...checkpoint } = entry; void _userEdits;
    await store.putTranslation(checkpoint);
    const stored = (await store.getTranslation('cached'))!;
    expect(stored.output).toEqual(original);
    expect(stored.userEdits).toEqual(entry.userEdits);
    expect(applyRegionEdits(stored.output, stored.userEdits).regions[0]!.text).toBe('Bản sửa được giữ');
    await store.putTranslation({ ...checkpoint, userEdits: edits({}) });
    expect(applyRegionEdits((await store.getTranslation('cached'))!.output, (await store.getTranslation('cached'))!.userEdits)).toEqual(original);
  });
});
