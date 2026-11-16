import { describe, expect, it } from 'vitest';
import { isComicImage, type ImageEvidence } from '../../src/discovery/eligibility';

describe('comic image discovery', () => {
  const page: ImageEvidence = {
    source: 'https://cdn.example.test/chapter/page-01.webp', naturalWidth: 900, naturalHeight: 1400,
    renderedWidth: 600, renderedHeight: 933, description: 'chapter page-01', inNavigation: false,
  };
  it('accepts a regular comic page', () => expect(isComicImage(page)).toBe(true));
  it('accepts a long webtoon strip', () => expect(isComicImage({ ...page, naturalHeight: 18000, renderedHeight: 12000 })).toBe(true));
  it('accepts a double-page spread', () => expect(isComicImage({ ...page, naturalWidth: 1800, naturalHeight: 1100 })).toBe(true));
  it('does not reject a reader based on its container role', () => expect(isComicImage({ ...page, inNavigation: true })).toBe(true));
  it.each([
    { naturalWidth: 0 }, { naturalHeight: 0 }, { naturalWidth: 64 }, { renderedWidth: 80 },
    { description: 'profile avatar picture' }, { description: '/assets/logo/image.png' },
    { naturalWidth: 1800, naturalHeight: 300 }, { source: '' }, { renderedHeight: NaN },
  ])('rejects decoration, unloaded or tiny images %j', (change) => {
    expect(isComicImage({ ...page, ...change })).toBe(false);
  });
});
