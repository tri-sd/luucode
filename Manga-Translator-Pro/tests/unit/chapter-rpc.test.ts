import { describe, expect, it } from 'vitest';
import { parseObservations } from '../../src/chapter/rpc';
import { canonicalChapterUrl, chapterIdentity, stableDigest } from '../../src/chapter/identity';
import { visionPrompt } from '../../src/translation/gemini-client';

const token = '0123456789abcdef0123456789abcdef';
const observation = { source: 'https://cdn.test/page.png', sourceKey: 'source-v1', naturalWidth: 1000, naturalHeight: 1600,
  method: 'img', documentToken: token, binding: { instanceId: 'image-1', generation: 1, sourceKey: 'source-v1' } };
describe('chapter transport and identity boundaries', () => {
  it('rejects a batch belonging to another document and mismatched DOM/source binding', () => {
    expect(() => parseObservations([{ ...observation, documentToken: 'another-document-token' }], token)).toThrow();
    expect(() => parseObservations([{ ...observation, sourceKey: 'replaced-source' }], token)).toThrow();
  });
  it('does not copy API keys or arbitrary website fields into observations', () => {
    const result = parseObservations([{ ...observation, apiKey: 'DO_NOT_TRANSPORT', unexpected: 'PAGE_FIELD' }], token);
    expect(result).toEqual([observation]);
  });
  it('limits batches and rejects unloaded dimensions', () => {
    expect(() => parseObservations(Array.from({ length: 13 }, () => observation), token, 12)).toThrow();
    expect(() => parseObservations([{ ...observation, naturalWidth: 0 }], token)).toThrow();
  });
  it('preserves chapter identity across explicitly marked reader page query changes', () => {
    expect(chapterIdentity('https://reader.test/chapter-42?page=1').id).toBe(chapterIdentity('https://reader.test/chapter-42?page=2').id);
    expect(chapterIdentity('https://reader.test/read?chapter=42&page=1').id).toBe(chapterIdentity('https://reader.test/read?chapter=42&page=2').id);
    expect(chapterIdentity('https://reader.test/chapter-43?page=1').id).not.toBe(chapterIdentity('https://reader.test/chapter-42?page=1').id);
    expect(canonicalChapterUrl('https://reader.test/read?page=2')).not.toBe(canonicalChapterUrl('https://reader.test/read?page=1'));
  });
  it('gives deterministic identity without relying on screen/DOM position', () => {
    expect(stableDigest('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('separates preceding dialogue reference from visible-page OCR instructions', () => {
    const prompt = visionPrompt('ja', 'Name = Tên; previous dialogue only');
    expect(prompt).toContain('only text visible in this supplied image');
    expect(prompt).toContain('never copy its dialogue into this page');
    expect(prompt).toContain('<reference_data>');
  });
});
