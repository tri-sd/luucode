import { ImageRegistry } from '../src/chapter/image-registry';
import { createTranslationProfile, translationCacheKey } from '../src/chapter/identity';
import { IndexedDBCache, withChapterLock } from '../src/chapter/indexeddb-cache';
import { ChapterSessionManager } from '../src/chapter/session-manager';
import type { CachedTranslation, ChapterImage, ImageObservation } from '../src/chapter/types';

const cache = new IndexedDBCache('mtp-v040-browser-storage-tests');
const sessions = new ChapterSessionManager(cache), registry = new ImageRegistry(cache);
const chapterUrl = 'https://reader.example.test/series/1/chapter/2';
const profile = createTranslationProfile({ model: 'gemini-mock', sourceLanguage: 'en' }, 'Hero = Anh Hùng');
function observation(index: number): ImageObservation {
  return { source: `https://cdn.example.test/page-${index}.png`, sourceKey: `image-${index}`, naturalWidth: 1000, naturalHeight: 1600,
    method: 'img', binding: { instanceId: `image-${index}`, generation: 1, sourceKey: `image-${index}` }, documentToken: 'browser-storage-document' };
}
function result(image: ChapterImage): CachedTranslation {
  return { key: translationCacheKey(`sha256-bytes-${image.order}`, profile), imageId: image.id, chapterId: image.chapterId,
    contentHash: `sha256-bytes-${image.order}`, profile, createdAt: Date.now(), output: { sourceLanguage: 'en', regions: [
      { id: 'bubble-1', sourceText: 'Let us begin.', text: 'Chúng ta bắt đầu thôi.', sourceLanguage: 'en', box: { x: .12, y: .15, width: .34, height: .11 } },
    ] } };
}
const harness = {
  async seed(count = 50) {
    const started = performance.now();
    const session = await sessions.attach(chapterUrl, 'browser-storage-document');
    const collecting = await sessions.startCollection(session.id);
    const images = await registry.observe(collecting, Array.from({ length: count }, (_, index) => observation(index + 1)), 'browser-storage-document');
    const first = images[0]!, translation = result(first);
    await withChapterLock(cache, session.id, async () => {
      await cache.putTranslation(translation);
      await cache.putImage({ ...first, state: 'COMPLETED', attempts: 1, contentHash: translation.contentHash, cacheKey: translation.key, profileKey: profile.key });
    });
    await sessions.update(session.id, { profile, status: 'ready' });
    return { view: await sessions.view(session.id), durationMs: performance.now() - started };
  },
  async restore() {
    const session = await sessions.attach(chapterUrl, 'browser-storage-reloaded');
    const view = await sessions.view(session.id), first = view.images[0]!;
    return { view, translation: first.cacheKey ? await cache.getTranslation(first.cacheKey) : undefined };
  },
  async reobserve() {
    const session = await sessions.attach(chapterUrl, 'browser-storage-document');
    return registry.observe(session, [observation(1)], 'browser-storage-document');
  },
  async completeSlowly() {
    const session = await sessions.attach(chapterUrl, 'browser-storage-document');
    await withChapterLock(cache, session.id, async () => {
      const first = (await cache.listImages(session.id))[0]!;
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      await cache.putImage({ ...first, state: 'COMPLETED', attempts: 7, cacheKey: 'concurrent-checkpoint' });
    });
  },
  async deleteIsolation() {
    const first = await sessions.attach(chapterUrl, 'browser-storage-document');
    const image = (await cache.listImages(first.id))[0]!;
    const entry = result(image);
    await cache.putTranslation(entry);
    await cache.putImage({ ...image, cacheKey: entry.key });
    const other = await sessions.attach('https://reader.example.test/series/1/chapter/3', 'browser-storage-document');
    const [otherImage] = await registry.observe(other, [observation(1)], 'browser-storage-document');
    await cache.putImage({ ...otherImage!, state: 'COMPLETED', cacheKey: entry.key });
    await withChapterLock(cache, first.id, () => cache.deleteChapter(first.id));
    const remaining = { deleted: await cache.getChapter(first.id), oldImages: await cache.listImages(first.id), other: await sessions.view(other.id),
      sharedTranslation: await cache.getTranslation(entry.key) };
    await withChapterLock(cache, other.id, () => cache.deleteChapter(other.id));
    return { ...remaining, afterLastReference: await cache.getTranslation(entry.key) };
  },
  async privateFieldProtection() {
    const session = await sessions.attach(chapterUrl, 'browser-storage-document');
    await cache.putChapter({ ...session, apiKey: 'PRIVATE_FAKE_KEY_MUST_NOT_STORE', options: { ...session.options, apiKey: 'PRIVATE_FAKE_KEY_MUST_NOT_STORE' } } as typeof session);
    const [image] = await registry.observe(session, [observation(1)], 'browser-storage-document');
    await cache.putImage({ ...image!, apiKey: 'PRIVATE_FAKE_KEY_MUST_NOT_STORE', bitmap: new Blob(['MUST_NOT_PERSIST_BITMAP']) } as ChapterImage);
    return JSON.stringify([await cache.getChapter(session.id), await cache.listImages(session.id)]);
  },
  hasWebLocks: Boolean(navigator.locks),
};
Object.assign(window, { chapterStorage: harness });
declare global { interface Window { chapterStorage: typeof harness } }
