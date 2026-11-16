import { describe, expect, it } from 'vitest';
import { ChapterCollector, hasReachedScrollEnd, pageOrdinalFromLabels, sampledPixelFingerprint } from '../../src/chapter/chapter-collector';
import type { ImageObservation } from '../../src/chapter/types';

function observation(index: number, overrides: Partial<ImageObservation> = {}): ImageObservation {
  return { source: `https://cdn.example.test/chapter/page-${index}.webp`, sourceKey: `source-${index}`,
    naturalWidth: 1000, naturalHeight: 1600, method: 'img', documentToken: 'document-A',
    binding: { instanceId: `image-${index + 1}`, generation: 1, sourceKey: `source-${index}` }, ...overrides };
}

describe('metadata chapter collection', () => {
  it('does not collect or enqueue anything until the user starts collection', () => {
    const collector = new ChapterCollector('chapter-A');
    collector.observe([observation(1)]);
    expect(collector.count).toBe(0); expect(collector.drain()).toEqual([]);
  });
  it('retains 50 pages after scrolling to the end and back without duplicates', () => {
    const collector = new ChapterCollector('chapter-A'); collector.begin();
    for (let index = 0; index < 50; index++) collector.observe([observation(index)]);
    for (let index = 49; index >= 0; index--) collector.observe([observation(index)]);
    expect(collector.count).toBe(50);
    expect(collector.snapshot().map((image) => image.source)).toEqual(Array.from({ length: 50 }, (_, index) => observation(index).source));
    expect(collector.drain()).toHaveLength(50); expect(collector.drain()).toEqual([]);
  });
  it('does not need a DOM instance to stay alive after its source is collected', () => {
    const collector = new ChapterCollector('chapter-A'); collector.begin();
    collector.observe([observation(1)]); collector.drain(); collector.observe([]);
    collector.observe([observation(1, { binding: { instanceId: 'new-dom-instance', generation: 9, sourceKey: 'source-1' } })]);
    expect(collector.count).toBe(1); expect(collector.pendingCount).toBe(0);
  });
  it('late images join an existing collection and metadata batches are bounded', () => {
    const collector = new ChapterCollector('chapter-A'); collector.begin();
    collector.observe(Array.from({ length: 50 }, (_, index) => observation(index)));
    expect(collector.drain(12)).toHaveLength(12); expect(collector.pendingCount).toBe(38);
    collector.observe([observation(50)]); expect(collector.count).toBe(51);
  });
  it('keeps one image for identical URLs at different DOM instances', () => {
    const collector = new ChapterCollector('chapter-A'); collector.begin();
    collector.observe([observation(1), observation(1, { binding: { instanceId: 'image-twin', generation: 1, sourceKey: 'source-1' } })]);
    expect(collector.count).toBe(1);
  });
  it('refreshes vendor signed URLs without growing the registry', () => {
    const collector = new ChapterCollector('chapter-A'); collector.begin();
    collector.observe([observation(1, { source: 'https://cdn.example.test/page.webp?X-Amz-Signature=old', sourceKey: 'old' })]);
    collector.drain();
    collector.observe([observation(1, { source: 'https://cdn.example.test/page.webp?X-Amz-Signature=new', sourceKey: 'new' })]);
    expect(collector.count).toBe(1); expect(collector.drain()[0]?.source).toContain('new');
  });
  it('does not mix images when the same DOM element is recycled by a fixed reader', () => {
    const collector = new ChapterCollector('chapter-A'); collector.begin();
    const binding = { instanceId: 'image-reader', generation: 1, sourceKey: 'reader' };
    collector.observe([observation(1, { binding })]);
    collector.observe([observation(2, { binding: { ...binding, generation: 2 } })]);
    expect(collector.count).toBe(2);
  });
  it('requeues a failed persistence batch but keeps a newer signed URL', () => {
    const collector = new ChapterCollector('chapter-A'); collector.begin();
    collector.observe([observation(1)]); const batch = collector.drain();
    collector.requeue(batch); expect(collector.pendingCount).toBe(1);
    collector.finish(); collector.observe([observation(2)]); expect(collector.count).toBe(1);
    collector.begin(); collector.observe([observation(2)]); expect(collector.count).toBe(2);
  });
});

describe('collection evidence', () => {
  it('marks a scroll boundary without calling a non-scrollable fixed reader complete', () => {
    expect(hasReachedScrollEnd({ scrollTop: 0, scrollHeight: 900, clientHeight: 900 })).toBe(false);
    expect(hasReachedScrollEnd({ scrollTop: 2000, scrollHeight: 2900, clientHeight: 900 })).toBe(true);
    expect(hasReachedScrollEnd({ scrollTop: 0, scrollHeight: 2900, clientHeight: 900 })).toBe(false);
    expect(hasReachedScrollEnd({ scrollTop: NaN, scrollHeight: 2900, clientHeight: 900 })).toBe(false);
  });
  it('recognizes explicit page labels without interpreting chapter titles as page identities', () => {
    expect(pageOrdinalFromLabels(['Page 12', 'Chapter 186'])).toBe(12);
    expect(pageOrdinalFromLabels(['Trang 3 / 50'])).toBe(3);
    expect(pageOrdinalFromLabels(['Chapter 186', 'comic-page'])).toBeUndefined();
  });
  it('distinguishes sampled canvas content, dimensions, and chapter-independent pixels', () => {
    const first = sampledPixelFingerprint(1000, 1600, [0, 255, 20, 255]);
    expect(first).toBe(sampledPixelFingerprint(1000, 1600, [0, 255, 20, 255]));
    expect(first).not.toBe(sampledPixelFingerprint(1000, 1600, [1, 255, 20, 255]));
    expect(first).not.toBe(sampledPixelFingerprint(1000, 1800, [0, 255, 20, 255]));
  });
});
