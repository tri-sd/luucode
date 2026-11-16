import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalChapterUrl, canonicalImageUrl, chapterIdentity, contentFingerprint, createTranslationProfile, imageIdentity, stableDigest, translationCacheKey } from '../../src/chapter/identity';
import { ImageRegistry } from '../../src/chapter/image-registry';
import { MemoryChapterStore, withChapterLock } from '../../src/chapter/indexeddb-cache';
import { chapterProgress } from '../../src/chapter/progress';
import { ChapterSessionManager } from '../../src/chapter/session-manager';
import type { ChapterImage, ImageObservation } from '../../src/chapter/types';

function observation(index: number, changes: Partial<ImageObservation> = {}): ImageObservation {
  return { source: `https://cdn.example.test/pages/${index}.webp`, sourceKey: `source-${index}`, naturalWidth: 1000, naturalHeight: 1600,
    method: 'img', binding: { instanceId: `image-${index}`, generation: 1, sourceKey: `source-${index}` }, documentToken: 'document-1', ...changes };
}
async function setup(url = 'https://reader.example.test/title/1/chapter/2') {
  const store = new MemoryChapterStore(), sessions = new ChapterSessionManager(store), registry = new ImageRegistry(store);
  const session = await sessions.attach(url, 'document-1');
  return { store, sessions, registry, session };
}

describe('chapter/image content identity', () => {
  it.each(['', 'abc', 'Manga tiếng Việt 日本語 中文 한국어', 'x'.repeat(1000)])('matches SHA256 reference %#', (input) => {
    expect(stableDigest(input)).toBe(createHash('sha256').update(input).digest('hex'));
  });
  it('hashes actual Blob bytes rather than URL/DOM position', async () => {
    expect(await contentFingerprint(new Blob(['abc']))).toBe(createHash('sha256').update('abc').digest('hex'));
  });
  it('canonicalizes harmless query order/tracking while preserving chapter/SPA identity', () => {
    const first = chapterIdentity('https://EXAMPLE.test/read?chapter=2&title=1&utm_source=mail#/series/1/2');
    const second = chapterIdentity('https://example.test/read?title=1&chapter=2#/series/1/2');
    expect(first).toEqual(second);
    expect(first.id).not.toBe(chapterIdentity('https://example.test/read?title=1&chapter=3#/series/1/3').id);
    expect(canonicalChapterUrl('https://example.test/read?chapter=2#page-12')).toBe('https://example.test/read?chapter=2');
    expect(canonicalChapterUrl('https://example.test/read#custom-chapter-2')).toContain('#custom-chapter-2');
  });
  it('only strips recognizable signed URL credentials, preserving content query parameters', () => {
    const a = canonicalImageUrl('https://cdn.test/p.png?page=4&X-Amz-Signature=abc&X-Amz-Date=20260101&X-Amz-Expires=30');
    const b = canonicalImageUrl('https://cdn.test/p.png?X-Amz-Signature=def&page=4&X-Amz-Date=20260102');
    expect(a).toBe(b);
    expect(a).not.toBe(canonicalImageUrl('https://cdn.test/p.png?page=5'));
    expect(canonicalImageUrl('https://cdn.test/p.png?token=page-4&expires=123&signature=content-id')).toContain('signature=content-id');
    expect(canonicalImageUrl('https://cdn.test/p.png?token=page-4')).not.toBe(canonicalImageUrl('https://cdn.test/p.png?token=page-5'));
    expect(canonicalImageUrl('https://cdn.test/p.png?Key-Pair-Id=K1&Signature=abc&Policy=expires-a&page=4'))
      .toBe(canonicalImageUrl('https://cdn.test/p.png?Key-Pair-Id=K2&Signature=def&Policy=expires-b&page=4'));
  });
  it('shares URL image content across DOM instances, never across chapters', () => {
    const original = observation(1);
    expect(imageIdentity('chapter-a', original)).toBe(imageIdentity('chapter-a', { ...original, binding: { ...original.binding, instanceId: 'image-999' } }));
    expect(imageIdentity('chapter-a', original)).not.toBe(imageIdentity('chapter-b', original));
    expect(imageIdentity('chapter-a', original)).not.toBe(imageIdentity('chapter-a', { ...original, naturalWidth: 2000, naturalHeight: 3200 }));
  });
  it('does not reuse an unverified canvas across documents or different canvas instances', () => {
    const canvas = observation(1, { source: 'canvas:visible', method: 'canvas' });
    expect(imageIdentity('chapter-a', canvas)).not.toBe(imageIdentity('chapter-a', { ...canvas, documentToken: 'document-2' }));
    expect(imageIdentity('chapter-a', canvas)).not.toBe(imageIdentity('chapter-a', { ...canvas, binding: { ...canvas.binding, instanceId: 'image-2' } }));
    expect(imageIdentity('chapter-a', { ...canvas, fingerprint: 'pixels-a' })).toBe(imageIdentity('chapter-a', { ...canvas, documentToken: 'document-2', fingerprint: 'pixels-a' }));
    expect(imageIdentity('chapter-a', { ...canvas, fingerprint: 'pixels-a' })).not.toBe(imageIdentity('chapter-a', { ...canvas, fingerprint: 'pixels-b' }));
  });
  it('separates model, source, glossary and OCR/prompt profile versions in cache keys', () => {
    const first = createTranslationProfile({ model: 'gemini-test', sourceLanguage: 'auto' }, 'Hero = Anh Hùng');
    expect(first.ocrVersion).toBe('gemini-vision-v2'); expect(first.promptVersion).toBe('chapter-vision-v2');
    for (const profile of [createTranslationProfile({ model: 'gemini-other', sourceLanguage: 'auto' }, 'Hero = Anh Hùng'),
      createTranslationProfile({ model: 'gemini-test', sourceLanguage: 'ja' }, 'Hero = Anh Hùng'),
      createTranslationProfile({ model: 'gemini-test', sourceLanguage: 'auto' }, 'Hero = Người Hùng'),
      { ...first, ocrVersion: 'gemini-vision-v1', promptVersion: 'chapter-vision-v1', key: 'legacy-profile' },
      createTranslationProfile({ model: 'gemini-test', sourceLanguage: 'auto' }, 'Hero = Anh Hùng', 'review')]) {
      expect(translationCacheKey('sha256-image', profile)).not.toBe(translationCacheKey('sha256-image', first));
    }
    expect(translationCacheKey('sha256-other-image', first)).not.toBe(translationCacheKey('sha256-image', first));
  });
});

describe('persistent chapter registry/session', () => {
  it('collects 50 images in reading order, survives reverse scrolling and deduplicates twins', async () => {
    const { registry, session, sessions } = await setup();
    for (let index = 1; index <= 50; index++) await registry.observe(session, [observation(index)], 'document-1');
    for (let index = 50; index >= 1; index--) await registry.observe(session, [observation(index), observation(index, { binding: { instanceId: `twin-${index}`, generation: 1, sourceKey: `source-${index}` } })], 'document-1');
    const view = await sessions.view(session.id);
    expect(view.images).toHaveLength(50);
    expect(view.images.map((image) => image.order)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(view.progress.total).toBe(50); expect(view.progress.discovered).toBe(50);
    expect(view.images.every((image) => image.state === 'DISCOVERED' && image.attempts === 0)).toBe(true);
  });
  it('retains metadata after DOM disappearance and allows a late image without losing previous results', async () => {
    const { registry, session, store } = await setup();
    const [first] = await registry.observe(session, [observation(1)], 'document-1');
    await store.putImage({ ...first!, state: 'COMPLETED', contentHash: 'hash-1', cacheKey: 'cached-1', profileKey: 'profile-1' });
    await registry.observe(session, [], 'document-1');
    const records = await registry.observe(session, [observation(1), observation(2)], 'document-1');
    expect(records).toHaveLength(2); expect(records[0]).toMatchObject({ state: 'COMPLETED', cacheKey: 'cached-1', contentHash: 'hash-1' });
    expect(records[1]?.order).toBe(2);
  });
  it('refreshes signed access URLs without creating a second image or resetting processing state', async () => {
    const { registry, session, store } = await setup();
    const [first] = await registry.observe(session, [observation(1, { source: 'https://cdn.test/1.png?X-Amz-Signature=old&page=1' })], 'document-1');
    await store.putImage({ ...first!, state: 'OCR_PROCESSING', attempts: 2 });
    const [updated] = await registry.observe(session, [observation(1, { source: 'https://cdn.test/1.png?X-Amz-Signature=new&page=1' })], 'document-1');
    expect(updated?.id).toBe(first?.id); expect(updated?.source).toContain('new'); expect(updated?.state).toBe('OCR_PROCESSING'); expect(updated?.attempts).toBe(2);
  });
  it('restores the same chapter across reload while isolating a new chapter and stale document observations', async () => {
    const { registry, session, store, sessions } = await setup();
    await registry.observe(session, [observation(1)], 'document-1');
    const reload = await sessions.attach(session.url, 'document-2');
    expect(reload.id).toBe(session.id); expect(reload.documentIds).toEqual(['document-1', 'document-2']);
    expect((await sessions.view(reload.id)).images).toHaveLength(1);
    const other = await sessions.attach('https://reader.example.test/title/1/chapter/3', 'document-2');
    await registry.observe(other, [observation(1, { documentToken: 'document-2' })], 'document-2');
    expect((await sessions.view(other.id)).images[0]?.id).not.toBe((await store.listImages(session.id))[0]?.id);
    await registry.observe(other, [observation(9)], 'document-2');
    expect((await sessions.view(other.id)).images).toHaveLength(1);
  });
  it('never claims scrolling to the bottom proves a complete chapter', async () => {
    const { sessions, session } = await setup();
    await sessions.startCollection(session.id);
    const finished = await sessions.finishCollection(session.id, true);
    expect(finished.endObserved).toBe(true); expect(finished.completeConfirmed).toBe(false); expect(finished.status).toBe('ready');
    expect(finished.collectionNote).toContain('Chưa tự khẳng định');
  });
  it('serializes registry and queue updates, preserving completed checkpoints', async () => {
    const { registry, session, store } = await setup();
    await registry.observe(session, [observation(1)], 'document-1');
    await Promise.all([
      withChapterLock(store, session.id, async () => {
        const [image] = await store.listImages(session.id);
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        await store.putImage({ ...image!, state: 'COMPLETED', attempts: 1, cacheKey: 'cached-checkpoint' });
      }),
      registry.observe(session, [observation(1)], 'document-1'),
    ]);
    expect((await store.listImages(session.id))[0]).toMatchObject({ state: 'COMPLETED', attempts: 1, cacheKey: 'cached-checkpoint' });
  });
  it('does not append an observation batch after collection ends while it waits for the queue lock', async () => {
    const { registry, session, sessions, store } = await setup();
    const collecting = await sessions.startCollection(session.id);
    await registry.observe(collecting, [observation(1)], 'document-1');
    await Promise.all([
      withChapterLock(store, session.id, async () => {
        const current = (await store.getChapter(session.id))!;
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        await store.putChapter({ ...current, status: 'running', revision: current.revision + 1 });
        const [image] = await store.listImages(session.id);
        await store.putImage({ ...image!, state: 'QUEUED' });
      }),
      registry.observe(collecting, [observation(1), observation(2)], 'document-1'),
    ]);
    const images = await store.listImages(session.id);
    expect(images).toHaveLength(1); expect(images[0]?.state).toBe('QUEUED');
  });
  it('rejects a stale batch from a deleted chapter incarnation after the same URL is recreated', async () => {
    const store = new MemoryChapterStore();
    let timestamp = 1000;
    const sessions = new ChapterSessionManager(store, () => timestamp);
    const registry = new ImageRegistry(store, () => timestamp);
    const first = await sessions.attach('https://reader.example.test/chapter/1', 'document-1');
    await store.deleteChapter(first.id); timestamp = 2000;
    const replacement = await sessions.attach(first.url, 'document-2');
    expect(replacement.id).toBe(first.id);
    expect(await registry.observe(first, [observation(1)], 'document-1')).toEqual([]);
    expect(await store.listImages(replacement.id)).toEqual([]);
  });
  it('ignores late observations after explicit chapter deletion', async () => {
    const { registry, session, store } = await setup();
    await store.deleteChapter(session.id);
    expect(await registry.observe(session, [observation(1)], 'document-1')).toEqual([]);
    expect(await store.listImages(session.id)).toEqual([]);
  });
  it('does not persist accidental credentials or raw bitmap fields', async () => {
    const { session, store, registry } = await setup();
    await store.putChapter({ ...session, apiKey: 'MUST_NOT_STORE', options: { ...session.options, apiKey: 'MUST_NOT_STORE' } } as typeof session);
    const [image] = await registry.observe(session, [observation(1)], 'document-1');
    await store.putImage({ ...image!, apiKey: 'MUST_NOT_STORE', bitmap: 'data:image/png;base64,PRIVATE' } as ChapterImage);
    const serialized = JSON.stringify([await store.getChapter(session.id), await store.listImages(session.id)]);
    expect(serialized).not.toContain('MUST_NOT_STORE'); expect(serialized).not.toContain('PRIVATE');
  });
  it('reports 30 successes and 5 failures as settled without calling failures successes', async () => {
    const { registry, session } = await setup();
    const images = await registry.observe(session, Array.from({ length: 35 }, (_, index) => observation(index + 1)), 'document-1');
    const summary = chapterProgress(images.map((image, index) => ({ ...image, state: index < 30 ? 'COMPLETED' : 'FAILED' })));
    expect(summary).toMatchObject({ total: 35, completed: 30, failed: 5, active: 0, settled: 35, percent: 100 });
  });
});
