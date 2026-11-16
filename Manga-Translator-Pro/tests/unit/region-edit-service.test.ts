import { describe, expect, it, vi } from 'vitest';
import { ChapterService } from '../../src/chapter/chapter-service';
import { MemoryChapterStore } from '../../src/chapter/indexeddb-cache';
import { createTranslationProfile } from '../../src/chapter/identity';
import { dispatchChapterRpc } from '../../src/chapter/rpc';
import type { ImageObservation } from '../../src/chapter/types';
import { DEFAULT_SETTINGS } from '../../src/translation/settings';
import type { TranslationOutput } from '../../src/translation/types';

const url = 'https://reader.test/title/test/chapter-1', documentToken = '0123456789abcdef0123456789abcdef';
const sourceKey = 'source-1';
const observation: ImageObservation = { source: 'https://cdn.test/1.png', sourceKey, method: 'img', naturalWidth: 1000, naturalHeight: 1600,
  documentToken, binding: { instanceId: 'image-1', generation: 1, sourceKey } };
const output: TranslationOutput = { sourceLanguage: 'en', regions: [{ id: 'bubble-1', sourceText: 'SOURCE', sourceLanguage: 'en', text: 'Bản dịch gốc',
  box: { x: .1, y: .2, width: .3, height: .1 }, polygon: [{ x: .1, y: .2 }, { x: .4, y: .2 }, { x: .4, y: .3 }, { x: .1, y: .3 }], ocrConfidence: .9, positionConfidence: .8 }] };
async function setup(verifyHash?: () => Promise<string>) {
  const store = new MemoryChapterStore(), execute = vi.fn(async () => undefined), changed = vi.fn();
  const settings = { ...DEFAULT_SETTINGS, model: 'gemini-unit-test' }, profile = createTranslationProfile(settings);
  const service = new ChapterService({ store, privateConfig: async () => ({ settings, apiKey: 'FAKE_TEST_CREDENTIAL_123456789' }), execute,
    permitted: async () => true, verifyHash: verifyHash ?? (async () => 'content-hash'), changed });
  await service.command(url, documentToken, 'collect'); await service.observe(url, documentToken, [observation]);
  const ready = await service.command(url, documentToken, 'finish');
  await store.putChapter({ ...ready.session, profile, status: 'completed' });
  await store.putImage({ ...ready.images[0]!, state: 'COMPLETED', cacheKey: 'cache-1', contentHash: 'content-hash', profileKey: profile.key });
  await store.putTranslation({ key: 'cache-1', chapterId: ready.session.id, imageId: ready.images[0]!.id, contentHash: 'content-hash', profile, output, createdAt: 1 });
  return { store, service, execute, changed, chapterId: ready.session.id };
}

describe('trusted manual-edit service and RPC', () => {
  it('saves per-content overrides, updates restoration, and resets without provider calls or mutating raw OCR', async () => {
    const h = await setup();
    const snapshot = await h.service.regionSnapshot(url, documentToken, observation);
    expect(snapshot.revision).toBe(''); expect(snapshot.original).toEqual(output);
    const saved = await h.service.saveRegionEdits(url, documentToken, observation, snapshot.cacheKey, snapshot.revision, {
      overrides: { 'bubble-1': { text: 'Bản dịch đã biên tập', box: { x: .2, y: .3, width: .3, height: .1 } } }, added: [],
    });
    expect(saved.revision).toMatch(/^[a-f0-9]{32}$/);
    expect(saved.output.regions[0]).toMatchObject({ text: 'Bản dịch đã biên tập', edited: true, box: { x: .2, y: .3, width: .3, height: .1 } });
    expect(saved.original).toEqual(output);
    expect((await h.service.restore(url, documentToken, [observation]))[0]!.output.regions[0]!.text).toBe('Bản dịch đã biên tập');
    const reset = await h.service.resetRegionEdits(url, documentToken, observation, saved.cacheKey, saved.revision);
    expect(reset.output).toEqual(output); expect(reset.revision).not.toBe(saved.revision);
    expect(h.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(saved)).not.toContain('FAKE_TEST_CREDENTIAL');
  });
  it('refuses optimistic-version conflicts, unknown region IDs, foreign cache keys and source changes', async () => {
    const h = await setup(), first = await h.service.regionSnapshot(url, documentToken, observation);
    await h.service.saveRegionEdits(url, documentToken, observation, first.cacheKey, first.revision, { overrides: { 'bubble-1': { text: 'Lần sửa 1' } } });
    await expect(h.service.saveRegionEdits(url, documentToken, observation, first.cacheKey, first.revision, { overrides: {} })).rejects.toMatchObject({ code: 'STALE_IMAGE' });
    const current = await h.service.regionSnapshot(url, documentToken, observation);
    await expect(h.service.saveRegionEdits(url, documentToken, observation, 'foreign-cache', current.revision, { overrides: {} })).rejects.toMatchObject({ code: 'STALE_IMAGE' });
    await expect(h.service.saveRegionEdits(url, documentToken, observation, current.cacheKey, current.revision, { overrides: { missing: { text: 'bad' } } })).rejects.toMatchObject({ code: 'INVALID_JSON' });
    await expect(h.service.regionSnapshot(url, documentToken, { ...observation, source: 'https://cdn.test/other.png' })).rejects.toMatchObject({ code: 'STALE_IMAGE' });
  });
  it('does not resurrect a cleared cache when a pending source verification later finishes', async () => {
    let resolve!: (value: string) => void, started!: () => void;
    const waiting = new Promise<string>((done) => { resolve = done; }), entered = new Promise<void>((done) => { started = done; });
    const h = await setup(async () => { started(); return waiting; });
    const pending = h.service.regionSnapshot(url, documentToken, observation); await entered;
    await h.service.command(url, documentToken, 'clear'); resolve('content-hash');
    await expect(pending).rejects.toMatchObject({ code: 'STALE_IMAGE' });
    expect(await h.store.getTranslation('cache-1')).toBeUndefined();
  });
  it('exposes edit RPC only after parsing the exact document/source binding', async () => {
    const h = await setup();
    const context = { url, documentToken };
    const snapshot = await dispatchChapterRpc(h.service, context, { type: 'chapter:regions', observation });
    expect(snapshot).toMatchObject({ cacheKey: 'cache-1', sourceKey });
    await expect(dispatchChapterRpc(h.service, context, { type: 'chapter:regions', observation: { ...observation, documentToken: 'foreign-document' } })).rejects.toMatchObject({ code: 'STALE_IMAGE' });
    await expect(dispatchChapterRpc(h.service, context, { type: 'chapter:save-regions', observation, cacheKey: 'cache-1', expectedRevision: 123, edits: {} })).rejects.toMatchObject({ code: 'STALE_IMAGE' });
  });
  it('uses the same override for separate DOM bindings of the same image, never another chapter', async () => {
    const h = await setup(), snapshot = await h.service.regionSnapshot(url, documentToken, observation);
    await h.service.saveRegionEdits(url, documentToken, observation, snapshot.cacheKey, '', { overrides: { 'bubble-1': { text: 'Bản dùng chung' } } });
    const twin = { ...observation, binding: { ...observation.binding, instanceId: 'image-99' } };
    expect((await h.service.restore(url, documentToken, [twin]))[0]!.output.regions[0]!.text).toBe('Bản dùng chung');
    await expect(h.service.regionSnapshot('https://reader.test/title/test/chapter-2', documentToken, observation)).rejects.toMatchObject({ code: 'STALE_IMAGE' });
  });
});
