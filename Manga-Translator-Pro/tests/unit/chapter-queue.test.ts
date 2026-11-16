import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryChapterStore } from '../../src/chapter/indexeddb-cache';
import { chapterProgress } from '../../src/chapter/progress';
import { TranslationQueue, type QueueRunner, type QueueRunResult } from '../../src/chapter/translation-queue';
import { DEFAULT_CHAPTER_OPTIONS, type ChapterImage, type ChapterSession, type TranslationProfile } from '../../src/chapter/types';
import { TranslationError } from '../../src/translation/errors';

const profile: TranslationProfile = { key: 'profile-v1', model: 'gemini-test-model', sourceLanguage: 'en', targetLanguage: 'vi',
  ocrVersion: 'vision-1', promptVersion: 'chapter-1', glossaryVersion: 'glossary-1', glossary: '' };
const queues: TranslationQueue[] = [];
afterEach(() => { for (const queue of queues.splice(0)) queue.dispose(); vi.useRealTimers(); });

async function setup(count: number, concurrency: 1 | 2 = 2, maxAttempts: 1 | 2 | 3 = 3) {
  const store = new MemoryChapterStore();
  const session: ChapterSession = { id: 'chapter-1', url: 'https://reader.test/series/chapter-1', documentIds: ['document-1'],
    createdAt: 1, updatedAt: 1, revision: 0, status: 'ready', endObserved: true, completeConfirmed: true, collectionNote: 'User confirmed',
    options: { ...DEFAULT_CHAPTER_OPTIONS, concurrency, maxAttempts }, profile };
  await store.putChapter(session);
  for (let order = 0; order < count; order++) {
    const image: ChapterImage = { id: `page-${order}`, chapterId: session.id, order,
      canonicalUrl: `https://cdn.test/${order}.png`, source: `https://cdn.test/${order}.png`, naturalWidth: 1000, naturalHeight: 1600,
      method: 'img', access: 'url', state: 'DISCOVERED', attempts: 0, priority: 0, updatedAt: 1 };
    await store.putImage(image);
  }
  return store;
}
function output(image: ChapterImage, suffix = ''): QueueRunResult {
  return { cacheKey: `cache-${image.id}${suffix}`, contentHash: `sha256-${image.id}`,
    output: { sourceLanguage: 'en', regions: [{ id: 'bubble-1', box: { x: .1, y: .2, width: .3, height: .1 },
      sourceText: `SOURCE ${image.id}`, sourceLanguage: 'en', text: `Bản dịch ${image.id}${suffix}` }] } };
}
function queue(store: MemoryChapterStore, run: QueueRunner, retryBaseMs = 1000): TranslationQueue {
  const instance = new TranslationQueue({ store, chapterId: 'chapter-1', run, retryBaseMs, random: () => 0 });
  queues.push(instance); return instance;
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function flush(): Promise<void> { for (let i = 0; i < 30; i++) await Promise.resolve(); }

// Provider adapters here are deterministic test doubles; no key or live Gemini request.
describe('persistent chapter translation scheduler', () => {
  it('translates 50 unique images with at most two requests, checkpoints results, and never re-sends completed pages', async () => {
    const store = await setup(50);
    const calls: string[] = [];
    let active = 0, maximum = 0;
    const scheduler = queue(store, async (image, context) => {
      calls.push(image.id); active++; maximum = Math.max(maximum, active);
      await context.onState('OCR_PROCESSING');
      await new Promise((done) => setTimeout(done, 1));
      await context.onState('TRANSLATING');
      active--; return output(image);
    });
    await scheduler.start(); await scheduler.waitForIdle();
    expect(calls).toHaveLength(50); expect(new Set(calls).size).toBe(50); expect(maximum).toBe(2);
    const images = await store.listImages('chapter-1');
    expect(chapterProgress(images)).toMatchObject({ total: 50, completed: 50, failed: 0, percent: 100 });
    expect((await store.getChapter('chapter-1'))?.status).toBe('completed');
    expect((await store.getTranslation(images[0]!.cacheKey!))?.output.regions[0]?.text).toContain('Bản dịch');
    await scheduler.start(); await scheduler.waitForIdle();
    expect(calls).toHaveLength(50);
  });

  it('pauses dispatch if a translated result cannot be checkpointed instead of paying for the rest of the chapter', async () => {
    const store = await setup(5, 1);
    const persist = store.putTranslation.bind(store);
    let fail = true, calls = 0;
    store.putTranslation = async (entry) => { if (fail) { fail = false; throw new Error('Synthetic storage full'); } await persist(entry); };
    const scheduler = queue(store, async (image) => { calls++; return output(image); });
    await scheduler.start(); await scheduler.waitForIdle();
    expect(calls).toBe(1);
    expect((await store.getChapter('chapter-1'))?.status).toBe('paused');
    expect((await store.listImages('chapter-1'))[0]).toMatchObject({ state: 'FAILED', errorCode: 'CACHE_STORAGE' });
    await scheduler.retryFailed(); await scheduler.waitForIdle();
    expect(chapterProgress(await store.listImages('chapter-1')).completed).toBe(5);
  });

  it('isolates five failures among thirty successes and retries only failed pages on explicit request', async () => {
    const store = await setup(35);
    let fail = true;
    const calls: string[] = [];
    const scheduler = queue(store, async (image) => {
      calls.push(image.id);
      if (fail && image.order >= 30) throw new TranslationError('INVALID_JSON');
      return output(image);
    });
    await scheduler.start(); await scheduler.waitForIdle();
    expect(chapterProgress(await store.listImages('chapter-1'))).toMatchObject({ completed: 30, failed: 5, active: 0 });
    expect(calls).toHaveLength(35);
    fail = false;
    await scheduler.retryFailed(); await scheduler.waitForIdle();
    expect(calls).toHaveLength(40);
    expect(calls.slice(35).every((id) => Number(id.slice(5)) >= 30)).toBe(true);
    expect(chapterProgress(await store.listImages('chapter-1')).completed).toBe(35);
  });

  it('persists exponential retry deadlines and applies global 429 cooldown before dispatching another image', async () => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    const store = await setup(2, 1);
    const calls: { id: string; time: number }[] = [];
    const scheduler = queue(store, async (image) => {
      calls.push({ id: image.id, time: Date.now() });
      if (image.id === 'page-0' && image.attempts < 3) throw new TranslationError('QUOTA');
      return output(image);
    });
    await scheduler.start(); await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ id: 'page-0', time: 10000 }]);
    const pending = (await store.listImages('chapter-1'))[0]!;
    expect(pending).toMatchObject({ state: 'QUEUED', attempts: 1, nextAttemptAt: 11000, errorCode: 'QUOTA' });
    await vi.advanceTimersByTimeAsync(999); expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000); await scheduler.waitForIdle();
    expect(calls.map((call) => call.time)).toEqual([10000, 11000, 13000, 13000]);
    expect(chapterProgress(await store.listImages('chapter-1')).completed).toBe(2);
  });

  it('honors Retry-After and caps automatic attempts without stopping other pages', async () => {
    vi.useFakeTimers(); vi.setSystemTime(20000);
    const store = await setup(2, 1, 2);
    const times: number[] = [];
    const scheduler = queue(store, async (image) => {
      if (image.order === 0) {
        times.push(Date.now());
        throw Object.assign(new TranslationError('QUOTA'), { retryAfterMs: 5000 });
      }
      return output(image);
    });
    await scheduler.start(); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4999); expect(times).toEqual([20000]);
    await vi.advanceTimersByTimeAsync(1); await scheduler.waitForIdle();
    expect(times).toEqual([20000, 25000]);
    expect(chapterProgress(await store.listImages('chapter-1'))).toMatchObject({ completed: 1, failed: 1 });
  });

  it('pause drains current requests and resume continues without re-translating successful images', async () => {
    const store = await setup(6);
    const release = gate<void>(), calls: string[] = [];
    const scheduler = queue(store, async (image) => {
      calls.push(image.id); if (image.order < 2) await release.promise; return output(image);
    });
    await scheduler.start(); expect(calls).toHaveLength(2);
    await scheduler.pause(); release.resolve(); await scheduler.waitForIdle();
    expect(calls).toHaveLength(2);
    expect(chapterProgress(await store.listImages('chapter-1'))).toMatchObject({ completed: 2, queued: 4 });
    expect((await store.getChapter('chapter-1'))?.status).toBe('paused');
    await scheduler.resume(); await scheduler.waitForIdle();
    expect(calls).toHaveLength(6); expect(new Set(calls).size).toBe(6);
  });

  it('cancel aborts work, records pending cancellations and ignores a late provider response', async () => {
    const store = await setup(4);
    const release = gate<void>(), signals: AbortSignal[] = [];
    const scheduler = queue(store, async (image, context) => {
      signals.push(context.signal); await release.promise; return output(image);
    });
    await scheduler.start(); await scheduler.cancel();
    expect(signals).toHaveLength(2); expect(signals.every((signal) => signal.aborted)).toBe(true);
    release.resolve(); await scheduler.waitForIdle();
    const images = await store.listImages('chapter-1');
    expect(images.every((image) => image.state === 'CANCELLED')).toBe(true);
    expect(await store.getTranslation('cache-page-0')).toBeUndefined();
    expect((await store.getChapter('chapter-1'))?.status).toBe('cancelled');
  });

  it('recovers interrupted checkpoints after executor recreation and rejects the obsolete executor result', async () => {
    const store = await setup(3);
    const release = gate<void>();
    const old = queue(store, async (image) => { await release.promise; return output(image, '-obsolete'); });
    await old.start();
    expect((await store.listImages('chapter-1')).filter((image) => image.state === 'FETCHING')).toHaveLength(2);
    old.dispose();
    const calls: string[] = [];
    const restarted = queue(store, async (image) => { calls.push(image.id); return output(image); });
    await restarted.recover();
    expect((await store.getChapter('chapter-1'))?.status).toBe('paused');
    expect((await store.listImages('chapter-1')).every((image) => image.state === 'QUEUED')).toBe(true);
    await restarted.resume(); await restarted.waitForIdle();
    release.resolve(); await flush();
    expect(calls).toHaveLength(3);
    expect(await store.getTranslation('cache-page-0-obsolete')).toBeUndefined();
    expect(chapterProgress(await store.listImages('chapter-1')).completed).toBe(3);
  });

  it('does not allow a second live scheduler to reset or duplicate active requests', async () => {
    const store = await setup(2);
    const release = gate<void>();
    const first = queue(store, async (image) => { await release.promise; return output(image); });
    await first.start();
    await expect(first.recover()).rejects.toMatchObject({ code: 'BUSY' });
    const duplicate = queue(store, async (image) => output(image));
    await expect(duplicate.recover()).rejects.toMatchObject({ code: 'BUSY' });
    await expect(duplicate.start()).rejects.toMatchObject({ code: 'BUSY' });
    release.resolve(); await first.waitForIdle();
    expect((await store.listImages('chapter-1')).every((image) => image.attempts === 1)).toBe(true);
  });

  it('drops results if chapter deletion or profile replacement makes the checkpoint obsolete', async () => {
    const store = await setup(1);
    const release = gate<void>();
    const scheduler = queue(store, async (image) => { await release.promise; return output(image); });
    await scheduler.start();
    const session = (await store.getChapter('chapter-1'))!;
    await store.putChapter({ ...session, profile: { ...profile, key: 'profile-v2' } });
    release.resolve(); await scheduler.waitForIdle();
    expect(await store.getTranslation('cache-page-0')).toBeUndefined();
    scheduler.dispose();
    const secondRelease = gate<void>();
    const replacement = queue(store, async (image) => { await secondRelease.promise; return output(image); });
    await replacement.recover(); await replacement.start();
    await store.deleteChapter('chapter-1');
    secondRelease.resolve(); await replacement.waitForIdle();
    expect(await store.getChapter('chapter-1')).toBeUndefined();
    expect(await store.getTranslation('cache-page-0')).toBeUndefined();
  });

  it('schedules explicit viewport priority while keeping successful earlier-page context bounded', async () => {
    const store = await setup(6, 1);
    const release = gate<void>(), calls: string[] = [], contexts = new Map<string, string>();
    const scheduler = queue(store, async (image, context) => {
      calls.push(image.id); contexts.set(image.id, context.context);
      if (image.order === 0) await release.promise;
      return output(image);
    });
    await scheduler.start(); await scheduler.prioritize(['page-4']); release.resolve(); await scheduler.waitForIdle();
    expect(calls).toEqual(['page-0', 'page-4', 'page-1', 'page-2', 'page-3', 'page-5']);
    const context = JSON.parse(contexts.get('page-5')!) as { page: number }[];
    expect(context.map((page) => page.page)).toEqual([1, 2, 3, 4]);
    expect(contexts.get('page-5')!.length).toBeLessThanOrEqual(8000);
  });


  it('does not start a request cancelled while its FETCHING checkpoint is being broadcast', async () => {
    const store = await setup(1), release = gate<void>();
    let waiting = false;
    const run = vi.fn<QueueRunner>(async (image) => output(image));
    const scheduler = new TranslationQueue({ store, chapterId: 'chapter-1', run,
      onChanged: async () => {
        if (!waiting && (await store.listImages('chapter-1'))[0]?.state === 'FETCHING') {
          waiting = true; await release.promise;
        }
      },
    });
    queues.push(scheduler);
    const starting = scheduler.start();
    for (let i = 0; i < 100 && !waiting; i++) await Promise.resolve();
    expect(waiting).toBe(true);
    await scheduler.cancel(); release.resolve(); await starting; await scheduler.waitForIdle();
    expect(run).not.toHaveBeenCalled();
    expect((await store.listImages('chapter-1'))[0]?.state).toBe('CANCELLED');
  });

  it('restores a persisted RENDER_READY checkpoint from cache without calling the provider', async () => {
    const store = await setup(1), image = (await store.listImages('chapter-1'))[0]!;
    const result = output(image);
    await store.putTranslation({ key: result.cacheKey, imageId: image.id, chapterId: image.chapterId,
      contentHash: result.contentHash, profile, output: result.output, createdAt: 1 });
    await store.putImage({ ...image, state: 'RENDER_READY', cacheKey: result.cacheKey, profileKey: profile.key, attempts: 1 });
    const run = vi.fn<QueueRunner>();
    const scheduler = queue(store, run);
    await scheduler.recover(); await scheduler.start(); await scheduler.waitForIdle();
    expect(run).not.toHaveBeenCalled();
    expect((await store.listImages('chapter-1'))[0]!.state).toBe('COMPLETED');
  });
});
