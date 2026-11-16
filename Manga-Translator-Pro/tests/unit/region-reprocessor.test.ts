import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryChapterStore } from '../../src/chapter/indexeddb-cache';
import { ChapterSessionManager } from '../../src/chapter/session-manager';
import { contentFingerprint, createTranslationProfile } from '../../src/chapter/identity';
import { RegionReprocessor, type RegionReprocessRequest } from '../../src/chapter/region-reprocessor';
import { DEFAULT_SETTINGS } from '../../src/translation/settings';
import type { TranslationOutput } from '../../src/translation/types';

const mocks = vi.hoisted(() => ({ download: vi.fn(), translate: vi.fn() }));
vi.mock('../../src/translation/image-pipeline', () => ({ downloadImage: mocks.download, translateRegionCrop: mocks.translate }));
const output: TranslationOutput = { sourceLanguage: 'en', regions: [{ id: 'crop-1', sourceText: 'Hello', text: 'Xin chào', sourceLanguage: 'en', box: { x: .1, y: .2, width: .3, height: .1 } }] };

async function setup() {
  const store = new MemoryChapterStore();
  const session = await new ChapterSessionManager(store).attach('https://reader.test/chapter-1', 'document-1');
  const settings = { ...DEFAULT_SETTINGS, model: 'gemini-test' }, profile = createTranslationProfile(settings);
  const blob = new Blob(['synthetic source bytes']), hash = await contentFingerprint(blob);
  await store.putChapter({ ...session, profile, status: 'completed' });
  await store.putImage({ id: 'image-1', chapterId: session.id, order: 1, canonicalUrl: 'https://cdn.test/page.png', source: 'https://cdn.test/page.png',
    naturalWidth: 400, naturalHeight: 640, method: 'img', access: 'url', priority: 0, updatedAt: 1,
    state: 'COMPLETED', attempts: 1, contentHash: hash, cacheKey: 'cache-1', profileKey: profile.key });
  await store.putTranslation({ key: 'cache-1', chapterId: session.id, imageId: 'image-1', contentHash: hash, profile, output, createdAt: 1 });
  mocks.download.mockResolvedValue(blob); mocks.translate.mockResolvedValue(output);
  const request: RegionReprocessRequest = { chapterId: session.id, imageId: 'image-1', cacheKey: 'cache-1', expectedRevision: '',
    crop: { x: .12, y: .15, width: .34, height: .11 }, settings, apiKey: 'FAKE_TEST_CREDENTIAL' };
  return { store, session, request, runner: new RegionReprocessor(store) };
}

beforeEach(() => vi.resetAllMocks());
describe('trusted crop retries', () => {
  it('reuses the same pixel crop despite floating-point differences and preserves raw OCR', async () => {
    const h = await setup();
    expect(await h.runner.run(h.request, new AbortController().signal)).toEqual(output);
    expect(await h.runner.run({ ...h.request, crop: { ...h.request.crop, height: .26 - .15 } }, new AbortController().signal)).toEqual(output);
    expect(mocks.translate).toHaveBeenCalledTimes(1); expect(mocks.download).toHaveBeenCalledTimes(1);
    expect((await h.store.getTranslation('cache-1'))!.output).toEqual(output);
    expect(JSON.stringify(await h.store.getTranslation('cache-1'))).not.toContain('FAKE_TEST_CREDENTIAL');
  });
  it.each([{ model: 'different-model' }, { sourceLanguage: 'ja' as const }])('rejects configuration changes before network/cache lookup: %j', async (change) => {
    const h = await setup();
    await expect(h.runner.run({ ...h.request, settings: { ...h.request.settings, ...change } }, new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_IMAGE' });
    expect(mocks.translate).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
  });
  it('never resurrects a deleted chapter after a slow crop response', async () => {
    const h = await setup(); let finish!: (value: TranslationOutput) => void, entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    mocks.translate.mockImplementation(() => { entered(); return new Promise<TranslationOutput>((resolve) => { finish = resolve; }); });
    const pending = h.runner.run(h.request, new AbortController().signal); await started;
    await h.store.deleteChapter(h.session.id); finish(output);
    await expect(pending).rejects.toMatchObject({ code: 'STALE_IMAGE' });
    expect(await h.store.getChapter(h.session.id)).toBeUndefined(); expect(await h.store.getTranslation('cache-1')).toBeUndefined();
  });
});
