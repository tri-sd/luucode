import { ChapterContentController } from '../src/chapter/content-controller';
import { chapterIdentity, createTranslationProfile, imageIdentity, stableDigest, translationCacheKey } from '../src/chapter/identity';
import { ImageRegistry } from '../src/chapter/image-registry';
import { IndexedDBCache } from '../src/chapter/indexeddb-cache';
import { ChapterSessionManager } from '../src/chapter/session-manager';
import type { ChapterSession, ChapterView, ImageObservation, TranslationProfile } from '../src/chapter/types';
import { RegionTracker } from '../src/tracking/region-tracker';
import type { TranslationOutput } from '../src/translation/types';

// Test-only extension-service bridge. Website-origin IndexedDB here is isolated from production.
const store = new IndexedDBCache('mtp-chapter-content-test-v040');
const sessions = new ChapterSessionManager(store);
const registry = new ImageRegistry(store);
let tracker = new RegionTracker({ initialRegions: 'empty' });
let controller: ChapterContentController;
let providerCalls = 0;
let providerDelay = 3;
let processing: Promise<void> | undefined;
const requests: string[] = [];
const active = new Set<string>();

function output(image: { order: number }): TranslationOutput {
  return { sourceLanguage: 'en', regions: [{ id: 'mock-1', sourceText: `SOURCE PAGE ${image.order}`, text: `Bản dịch trang ${image.order}`,
    sourceLanguage: 'en', box: { x: .12, y: .15, width: .34, height: .11 } }] };
}

async function completeChapter(chapter: ChapterSession, profile: TranslationProfile): Promise<void> {
  for (const image of await store.listImages(chapter.id)) {
    const current = await store.getChapter(chapter.id);
    if (!current || current.profile?.key !== profile.key) return;
    if (image.state === 'COMPLETED' && image.profileKey === profile.key) continue;
    providerCalls++;
    const contentHash = stableDigest(image.canonicalUrl), cacheKey = translationCacheKey(contentHash, profile);
    await store.putTranslation({ key: cacheKey, imageId: image.id, chapterId: chapter.id, contentHash, profile, output: output(image), createdAt: Date.now() });
    await store.putImage({ ...image, state: 'COMPLETED', contentHash, cacheKey, profileKey: profile.key, completedAt: Date.now(), updatedAt: Date.now() });
    await sessions.update(chapter.id, {});
    controller.refresh();
    await new Promise<void>((done) => setTimeout(done, providerDelay));
  }
  await sessions.update(chapter.id, { status: 'completed' });
  controller.refresh();
}

async function service(request: Readonly<Record<string, unknown>>): Promise<unknown> {
  const type = request['type'] as string;
  requests.push(type);
  const url = request['url'] as string, documentToken = request['documentToken'] as string;
  const chapterId = chapterIdentity(url).id;
  let chapter = await store.getChapter(chapterId);
  if (type === 'chapter:attach') { chapter = await sessions.attach(url, documentToken); return sessions.view(chapter.id); }
  if (!chapter) throw new Error('Attach before using the test chapter service');
  if (type === 'chapter:status') return sessions.view(chapterId);
  if (type === 'chapter:observe') {
    if (chapter.status === 'collecting') {
      await registry.observe(chapter, request['observations'] as ImageObservation[], documentToken);
      await sessions.update(chapterId, { endObserved: chapter.endObserved || request['endObserved'] === true });
    }
    return sessions.view(chapterId);
  }
  if (type === 'chapter:restore') {
    const images = await store.listImages(chapterId);
    const result = [];
    for (const observation of request['observations'] as ImageObservation[]) {
      const image = images.find((item) => item.id === imageIdentity(chapterId, observation));
      if (!image?.cacheKey || image.state !== 'COMPLETED' || image.profileKey !== chapter.profile?.key) continue;
      const cached = await store.getTranslation(image.cacheKey);
      if (cached) result.push({ imageId: image.id, sourceKey: observation.sourceKey, output: cached.output });
    }
    return result;
  }
  if (type !== 'chapter:command') throw new Error('Unexpected content test message');
  switch (request['command']) {
    case 'collect': await sessions.startCollection(chapterId); break;
    case 'finish': await sessions.finishCollection(chapterId, chapter.endObserved); break;
    case 'translate': {
      const profile = createTranslationProfile({ model: 'gemini-test-content', sourceLanguage: 'en' }, chapter.options.glossary);
      chapter = await sessions.update(chapterId, { status: 'running', profile });
      if (!active.has(chapterId)) {
        active.add(chapterId);
        processing = completeChapter(chapter, profile).finally(() => active.delete(chapterId));
      }
      break;
    }
    case 'clear':
      await store.deleteChapter(chapterId); await sessions.attach(url, documentToken); break;
    case 'visibility': await sessions.update(chapterId, { options: { ...chapter.options, overlayVisible: !chapter.options.overlayVisible } }); break;
    case 'background': await sessions.update(chapterId, { options: { ...chapter.options, overlayBackground: request['value'] === 'original' ? 'original' : 'mask' } }); break;
    case 'cancel': await sessions.update(chapterId, { status: 'cancelled' }); break;
  }
  return sessions.view(chapterId);
}

function start(): void {
  controller = new ChapterContentController(tracker, service);
  controller.start();
}
const harness = {
  get tracker() { return tracker; },
  get controller() { return controller; },
  setProviderDelay: (milliseconds: number): void => { providerDelay = milliseconds; },
  stats: () => ({ providerCalls, requests: [...requests] }),
  async view(): Promise<ChapterView> { return sessions.view(chapterIdentity(location.href).id); },
  async waitForProcessing(): Promise<void> { await processing; },
  async recreateRuntime(): Promise<void> {
    controller.stop(); tracker.stop(); tracker = new RegionTracker({ initialRegions: 'empty' }); start();
  },
  async clearExternal(): Promise<void> {
    const identity = chapterIdentity(location.href);
    await store.deleteChapter(identity.id); await sessions.attach(location.href, tracker.documentToken);
    controller.invalidateTranslations(true); controller.refresh();
  },
  async changeProfile(): Promise<void> {
    const chapterId = chapterIdentity(location.href).id;
    await sessions.update(chapterId, { profile: createTranslationProfile({ model: 'gemini-test-other-model', sourceLanguage: 'en' }) });
    controller.refresh();
  },
};
Object.assign(window, { chapterContentHarness: harness });
start();
declare global {
  interface Window {
    chapterContentHarness: typeof harness;
    fixtureReady: Promise<boolean>;
    chapterFixture: { add(index: number): Promise<void>; remount(index: number): Promise<void>; turn(index: number): Promise<void>; navigate(name: string): Promise<unknown> };
  }
}
