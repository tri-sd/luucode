import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChapterService, chapterOrigins, type ChapterServiceDependencies } from '../../src/chapter/chapter-service';
import { createTranslationProfile, imageIdentity, translationCacheKey } from '../../src/chapter/identity';
import { MemoryChapterStore } from '../../src/chapter/indexeddb-cache';
import type { CachedTranslation, ChapterView, ImageObservation } from '../../src/chapter/types';
import { DEFAULT_SETTINGS } from '../../src/translation/settings';
import type { TranslationOutput } from '../../src/translation/types';

const URL_A = 'https://reader.test/title/a/chapter/1';
const URL_B = 'https://reader.test/title/a/chapter/2';
const DOCUMENT = 'chapter-document-1234567890';
const FAKE_KEY = 'FAKE_UNIT_TEST_API_KEY_1234567890';
const HASH = 'sha256-synthetic-fixture-content';
const translated: TranslationOutput = { sourceLanguage: 'en', regions: [{ id: 'bubble-1', sourceText: 'Synthetic source', sourceLanguage: 'en',
  text: 'Bản dịch thử nghiệm', box: { x: .1, y: .2, width: .3, height: .1 } }] };

afterEach(() => vi.useRealTimers());
function observation(index = 1, changes: Partial<ImageObservation> = {}): ImageObservation {
  const sourceKey = `fixture-source-${index}`;
  return { source: `https://cdn.test/${index}.png`, sourceKey, method: 'img', naturalWidth: 1000, naturalHeight: 1600,
    documentToken: DOCUMENT, binding: { instanceId: `image-${index}`, generation: 1, sourceKey }, ...changes };
}
function harness(overrides: Partial<ChapterServiceDependencies> = {}) {
  const store = new MemoryChapterStore();
  const config = { settings: { ...DEFAULT_SETTINGS, model: 'gemini-unit-test-model' }, apiKey: FAKE_KEY };
  const privateConfig = vi.fn(async () => config);
  const permitted = vi.fn(async (_origins: readonly string[]) => true);
  const execute = vi.fn<ChapterServiceDependencies['execute']>(async () => undefined);
  const verifyHash = vi.fn<NonNullable<ChapterServiceDependencies['verifyHash']>>(async () => HASH);
  const changed = vi.fn(), permissionHint = vi.fn(async () => undefined);
  const dependencies: ChapterServiceDependencies = { store, privateConfig, permitted, execute, changed, permissionHint, verifyHash, ...overrides };
  return { store, config, privateConfig, permitted, execute, verifyHash, changed, permissionHint, service: new ChapterService(dependencies) };
}
async function collect(service: ChapterService, observations: readonly ImageObservation[] = [observation()], url = URL_A): Promise<ChapterView> {
  await service.command(url, DOCUMENT, 'collect');
  await service.observe(url, DOCUMENT, observations);
  return service.command(url, DOCUMENT, 'finish');
}
async function cached(h: ReturnType<typeof harness>, url = URL_A, obs = observation()): Promise<ChapterView> {
  const view = await collect(h.service, [obs], url);
  const profile = createTranslationProfile(h.config.settings, view.session.options.glossary);
  const key = translationCacheKey(HASH, profile);
  await h.store.putChapter({ ...view.session, status: 'completed', profile });
  await h.store.putImage({ ...view.images[0]!, state: 'COMPLETED', attempts: 1, profileKey: profile.key, cacheKey: key, contentHash: HASH });
  await h.store.putTranslation({ key, imageId: view.images[0]!.id, chapterId: view.session.id, contentHash: HASH, profile, output: translated, createdAt: Date.now() });
  return h.service.sessions.view(view.session.id);
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('chapter service collection and trusted execution boundaries', () => {
  it('does not register images before explicit collection or call Gemini while collecting fifty images', async () => {
    const h = harness();
    const initial = await h.service.attach(URL_A, DOCUMENT);
    expect(initial.session.status).toBe('idle'); expect(initial.images).toHaveLength(0);
    expect((await h.service.observe(URL_A, DOCUMENT, [observation()], true)).images).toHaveLength(0);
    await h.service.command(URL_A, DOCUMENT, 'collect');
    const observations = Array.from({ length: 50 }, (_, index) => observation(index + 1));
    await h.service.observe(URL_A, DOCUMENT, observations, true);
    const reversed = await h.service.observe(URL_A, DOCUMENT, [...observations].reverse());
    expect(reversed.images).toHaveLength(50); expect(reversed.progress.discovered).toBe(50);
    expect(reversed.session.endObserved).toBe(true); expect(reversed.session.completeConfirmed).toBe(false);
    expect(h.privateConfig).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled(); expect(h.verifyHash).not.toHaveBeenCalled();
    const finished = await h.service.command(URL_A, DOCUMENT, 'finish');
    expect(finished.session.status).toBe('ready'); expect(finished.session.completeConfirmed).toBe(false);
    await h.service.observe(URL_A, DOCUMENT, [observation(51)]);
    expect((await h.service.attach(URL_A, DOCUMENT)).images).toHaveLength(50);
  });

  it('requires finishing collection and at least one image before any translation request', async () => {
    const h = harness();
    await expect(h.service.command(URL_A, DOCUMENT, 'translate')).rejects.toMatchObject({ code: 'COLLECTION_REQUIRED' });
    await h.service.command(URL_A, DOCUMENT, 'collect');
    await h.service.observe(URL_A, DOCUMENT, [observation()]);
    await expect(h.service.command(URL_A, DOCUMENT, 'translate')).rejects.toMatchObject({ code: 'COLLECTION_REQUIRED' });
    expect(h.privateConfig).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
    await h.service.command(URL_A, DOCUMENT, 'finish');
    const view = await h.service.command(URL_A, DOCUMENT, 'translate');
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ command: 'translate', chapterId: view.session.id, ...h.config });
    expect(view.session.profile?.model).toBe(h.config.settings.model);
  });

  it('checks configuration and image-origin permissions before dispatching a trusted executor', async () => {
    const h = harness(); await collect(h.service, [observation(), observation(2, { source: 'https://other-cdn.test/2.png' })]);
    h.config.apiKey = '';
    await expect(h.service.command(URL_A, DOCUMENT, 'translate')).rejects.toMatchObject({ code: 'CONFIG' });
    expect(h.execute).not.toHaveBeenCalled(); expect(h.permitted).not.toHaveBeenCalled();
    h.config.apiKey = FAKE_KEY; h.permitted.mockResolvedValue(false);
    await expect(h.service.command(URL_A, DOCUMENT, 'translate')).rejects.toMatchObject({ code: 'CHAPTER_ACCESS' });
    expect(h.permitted).toHaveBeenCalledWith(['https://cdn.test/*', 'https://other-cdn.test/*']);
    expect(h.permissionHint).toHaveBeenCalledOnce(); expect(h.execute).not.toHaveBeenCalled();
    expect((await h.service.attach(URL_A, DOCUMENT)).session.profile).toBeUndefined();
  });

  it('does not include the API key in public views or persistent chapter/image metadata', async () => {
    const h = harness(); await collect(h.service);
    const view = await h.service.command(URL_A, DOCUMENT, 'translate');
    expect(JSON.stringify(view)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(await h.store.getChapter(view.session.id))).not.toContain(FAKE_KEY);
    expect(JSON.stringify(await h.store.listImages(view.session.id))).not.toContain(FAKE_KEY);
    expect(h.execute.mock.calls[0]?.[0].apiKey).toBe(FAKE_KEY); // Trusted offscreen transport only.
  });

  it('accepts only known control options and does not persist extra credentials smuggled into options', async () => {
    const h = harness();
    const view = await h.service.command(URL_A, DOCUMENT, 'options', { concurrency: 1, maxAttempts: 2, glossary: 'Hero = Người Hùng',
      overlayVisible: false, overlayBackground: 'original', apiKey: FAKE_KEY });
    expect(view.session.options).toMatchObject({ concurrency: 1, maxAttempts: 2, glossary: 'Hero = Người Hùng', overlayVisible: false, overlayBackground: 'original' });
    expect(JSON.stringify(view)).not.toContain(FAKE_KEY);
    await expect(h.service.command(URL_A, DOCUMENT, 'options', { concurrency: 9 })).rejects.toMatchObject({ code: 'CONFIG' });
  });

  it('returns only unique downloadable origins and never treats a canvas as a CDN request', async () => {
    const h = harness();
    const view = await collect(h.service, [observation(), observation(2), observation(3, { source: 'canvas:visible', method: 'canvas' })]);
    expect(chapterOrigins(view)).toEqual(['https://cdn.test/*']);
    expect(view.images.find((image) => image.method === 'canvas')?.access).toBe('live-only');
  });
});

describe('verified cache restoration and invalidation', () => {
  it('restores two DOM instances from one validated translation without invoking the executor or requiring a key', async () => {
    const h = harness(); await cached(h); h.config.apiKey = '';
    const twin = observation(1, { sourceKey: 'twin-source', binding: { instanceId: 'image-999', generation: 1, sourceKey: 'twin-source' } });
    const results = await h.service.restore(URL_A, DOCUMENT, [observation(), twin]);
    expect(results).toHaveLength(2); expect(new Set(results.map((result) => result.imageId)).size).toBe(1);
    expect(results.map((result) => result.sourceKey)).toEqual(['fixture-source-1', 'twin-source']);
    expect(results.every((result) => result.output.regions[0]?.text === 'Bản dịch thử nghiệm')).toBe(true);
    expect(h.verifyHash).toHaveBeenCalledOnce(); expect(h.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(results)).not.toContain(FAKE_KEY);
  });

  it('restores after reload and signed-URL renewal only when the current bytes still match', async () => {
    const signed = observation(1, { source: 'https://cdn.test/1.png?X-Amz-Signature=old&page=1' });
    const h = harness(); const view = await cached(h, URL_A, signed);
    const documentToken = 'reload-document-1234567890';
    const renewed = { ...signed, source: 'https://cdn.test/1.png?X-Amz-Signature=new&page=1', sourceKey: 'reloaded-source', documentToken };
    const results = await h.service.restore(URL_A, documentToken, [renewed]);
    expect(results).toHaveLength(1); expect(results[0]?.imageId).toBe(view.images[0]?.id);
    expect(h.verifyHash).toHaveBeenCalledWith(renewed);
    h.verifyHash.mockResolvedValue('sha256-other-bytes');
    expect(await h.service.restore(URL_A, documentToken, [{ ...renewed, sourceKey: 'changed-content' }])).toEqual([]);
  });

  it('refuses mismatched bytes, unavailable origins, stale documents, and live-only canvases', async () => {
    const h = harness(); await cached(h);
    h.verifyHash.mockResolvedValue('sha256-different');
    expect(await h.service.restore(URL_A, DOCUMENT, [observation()])).toEqual([]);
    await cached(h); // Re-seed a valid completed record so the permission gate is exercised independently.
    h.verifyHash.mockClear(); h.permitted.mockResolvedValue(false);
    expect(await h.service.restore(URL_A, DOCUMENT, [observation()])).toEqual([]); expect(h.verifyHash).not.toHaveBeenCalled();
    h.permitted.mockResolvedValue(true);
    expect(await h.service.restore(URL_A, DOCUMENT, [observation(1, { documentToken: 'old-document' })])).toEqual([]);
    const canvasHarness = harness(), canvas = observation(1, { source: 'canvas:visible', method: 'canvas' });
    await cached(canvasHarness, URL_A, canvas);
    expect(await canvasHarness.service.restore(URL_A, DOCUMENT, [canvas])).toEqual([]); expect(canvasHarness.verifyHash).not.toHaveBeenCalled();
  });


  it('invalidates a completed source whose verified bytes changed, while retaining its historical cached output', async () => {
    const h = harness(); const initial = await cached(h), cacheKey = initial.images[0]!.cacheKey!;
    h.verifyHash.mockResolvedValue('sha256-replaced-source');
    expect(await h.service.restore(URL_A, DOCUMENT, [observation()])).toEqual([]);
    const changed = await h.service.attach(URL_A, DOCUMENT), image = changed.images[0]!;
    expect(image.state).toBe('DISCOVERED'); expect(image.attempts).toBe(0);
    expect(image.cacheKey).toBeUndefined(); expect(image.profileKey).toBeUndefined(); expect(image.contentHash).toBeUndefined();
    expect(changed.session.revision).toBeGreaterThan(initial.session.revision);
    expect(await h.store.getTranslation(cacheKey)).toBeDefined();
    expect(h.execute).not.toHaveBeenCalled();
    await h.service.command(URL_A, DOCUMENT, 'translate'); expect(h.execute).toHaveBeenCalledOnce();
  });

  it('does not invalidate a newer running image checkpoint when an older hash verification finishes', async () => {
    const started = gate<void>(), complete = gate<string>();
    const h = harness({ verifyHash: async () => { started.resolve(); return complete.promise; } });
    const initial = await cached(h);
    const pending = h.service.restore(URL_A, DOCUMENT, [observation()]); await started.promise;
    await h.store.putImage({ ...initial.images[0]!, state: 'OCR_PROCESSING', attempts: 2 });
    complete.resolve('sha256-replaced-source'); expect(await pending).toEqual([]);
    expect((await h.store.listImages(initial.session.id))[0]).toMatchObject({ state: 'OCR_PROCESSING', attempts: 2, cacheKey: initial.images[0]!.cacheKey });
  });

  it('rejects foreign-chapter, wrong-profile and inconsistent content metadata before reading image bytes', async () => {
    const h = harness(); const view = await cached(h), key = view.images[0]!.cacheKey!;
    const entry = (await h.store.getTranslation(key))!;
    for (const changed of [
      { ...entry, chapterId: 'foreign-chapter' },
      { ...entry, profile: { ...entry.profile, key: 'foreign-profile' } },
      { ...entry, contentHash: 'other-content' },
    ] satisfies CachedTranslation[]) {
      await h.store.putTranslation(changed);
      expect(await h.service.restore(URL_A, DOCUMENT, [observation()])).toEqual([]);
    }
    expect(h.verifyHash).not.toHaveBeenCalled();
  });

  it('changing model or glossary blocks old restoration and resets checkpoints only on explicit translation', async () => {
    const h = harness(); const original = await cached(h);
    h.config.settings.model = 'gemini-another-test-model';
    expect(await h.service.restore(URL_A, DOCUMENT, [observation()])).toEqual([]);
    expect((await h.store.listImages(original.session.id))[0]?.state).toBe('COMPLETED');
    const changedModel = await h.service.command(URL_A, DOCUMENT, 'translate');
    expect(changedModel.session.profile?.key).not.toBe(original.session.profile?.key);
    expect(changedModel.images[0]).toMatchObject({ state: 'DISCOVERED', attempts: 0 });
    expect(changedModel.images[0]?.cacheKey).toBeUndefined();
    expect(await h.store.getTranslation(original.images[0]!.cacheKey!)).toBeDefined();
    const withGlossary = await h.service.command(URL_A, DOCUMENT, 'options', { glossary: 'Hero = Anh Hùng' });
    const oldProfile = withGlossary.session.profile!.key;
    await h.service.command(URL_A, DOCUMENT, 'translate');
    const latest = await h.service.attach(URL_A, DOCUMENT);
    expect(latest.session.profile?.key).not.toBe(oldProfile); expect(latest.session.profile?.glossary).toBe('Hero = Anh Hùng');
    expect(h.execute).toHaveBeenCalledTimes(2);
  });

  it('clearing cache cancels work and prevents an already-running verification reply from restoring deleted results', async () => {
    const started = gate<void>(), complete = gate<string>();
    const h = harness({ verifyHash: async () => { started.resolve(); return complete.promise; } });
    const initial = await cached(h);
    const pending = h.service.restore(URL_A, DOCUMENT, [observation()]); await started.promise;
    const cleared = await h.service.command(URL_A, DOCUMENT, 'clear');
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ chapterId: initial.session.id, command: 'cancel' });
    expect(cleared.images).toHaveLength(0); expect(cleared.session.status).toBe('idle');
    complete.resolve(HASH); expect(await pending).toEqual([]);
    expect(await h.store.getTranslation(initial.images[0]!.cacheKey!)).toBeUndefined();
  });

  it('never shares image records across chapters, even when their URLs and content bytes match', async () => {
    const h = harness(); const first = await collect(h.service, [observation()], URL_A), second = await collect(h.service, [observation()], URL_B);
    expect(first.session.id).not.toBe(second.session.id); expect(first.images[0]!.id).not.toBe(second.images[0]!.id);
    expect(imageIdentity(first.session.id, observation())).toBe(first.images[0]!.id);
    expect(imageIdentity(second.session.id, observation())).toBe(second.images[0]!.id);
    const profile = createTranslationProfile(h.config.settings);
    const keyA = 'chapter-a-cache-association', keyB = 'chapter-b-cache-association';
    await h.store.putChapter({ ...first.session, profile, status: 'completed' });
    await h.store.putChapter({ ...second.session, profile, status: 'completed' });
    for (const [view, key, text] of [[first, keyA, 'Bản dịch chương 1'], [second, keyB, 'Bản dịch chương 2']] as const) {
      await h.store.putImage({ ...view.images[0]!, state: 'COMPLETED', profileKey: profile.key, contentHash: HASH, cacheKey: key });
      await h.store.putTranslation({ key, imageId: view.images[0]!.id, chapterId: view.session.id, profile, contentHash: HASH,
        output: { ...translated, regions: translated.regions.map((region) => ({ ...region, text })) }, createdAt: Date.now() });
    }
    expect((await h.service.restore(URL_A, DOCUMENT, [observation()]))[0]?.output.regions[0]?.text).toBe('Bản dịch chương 1');
    expect((await h.service.restore(URL_B, DOCUMENT, [observation()]))[0]?.output.regions[0]?.text).toBe('Bản dịch chương 2');
    await h.service.command(URL_A, DOCUMENT, 'clear');
    expect((await h.service.restore(URL_B, DOCUMENT, [observation()]))[0]?.output.regions[0]?.text).toBe('Bản dịch chương 2');
  });

  it('does not let a same-clock clear/recollect operation resurrect a stale verification response', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const started = gate<void>(), complete = gate<string>();
    const h = harness({ verifyHash: async () => { started.resolve(); return complete.promise; } });
    await cached(h);
    const pending = h.service.restore(URL_A, DOCUMENT, [observation()]); await started.promise;
    await h.service.command(URL_A, DOCUMENT, 'clear');
    await collect(h.service);
    await h.service.command(URL_A, DOCUMENT, 'translate'); // Same profile, new image checkpoint, no completed result yet.
    complete.resolve(HASH);
    expect(await pending).toEqual([]);
  });
  it('cannot overwrite a newer same-key translation after clear and recollect happen within the same clock tick', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const started = gate<void>(), complete = gate<string>();
    const h = harness({ verifyHash: async () => { started.resolve(); return complete.promise; } });
    await cached(h);
    const pending = h.service.restore(URL_A, DOCUMENT, [observation()]); await started.promise;
    await h.service.command(URL_A, DOCUMENT, 'clear');
    const newer = await cached(h), key = newer.images[0]!.cacheKey!;
    const entry = (await h.store.getTranslation(key))!;
    await h.store.putTranslation({ ...entry, output: { ...entry.output,
      regions: entry.output.regions.map((region) => ({ ...region, text: 'Bản dịch mới sau xóa cache' })) } });
    complete.resolve(HASH);
    const results = await pending;
    expect(results.every((result) => result.output.regions.every((region) => region.text === 'Bản dịch mới sau xóa cache'))).toBe(true);
  });

});
