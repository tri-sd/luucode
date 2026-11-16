import type { ImageCandidate } from '../core/types';

/** An authored picture/srcset change invalidates results before decode. */
export function imageRequestKey(image: HTMLImageElement): string {
  return JSON.stringify([image.getAttribute('src'), image.getAttribute('srcset'), image.getAttribute('sizes'),
    [...(image.closest('picture')?.querySelectorAll('source') ?? [])]
      .map((source) => [source.srcset, source.sizes, source.media, source.type])]);
}

/** Only one URL layer is safe to map as one image. */
export function backgroundSource(value: string): string | null {
  const match = value.match(/^url\((?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^()\s]+))\)$/);
  const source = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!source || source.includes('\\')) return null;
  try { return new URL(source, document.baseURI).href; } catch { return null; }
}

export function isCurrentCandidate(candidate: ImageCandidate): boolean {
  const element = candidate.element;
  if (!element.isConnected) return false;
  if (element instanceof HTMLImageElement) return element.complete
    && imageRequestKey(element) === candidate.requestKey
    && (element.currentSrc || element.src) === candidate.source
    && element.naturalWidth === candidate.naturalWidth && element.naturalHeight === candidate.naturalHeight;
  if (element instanceof HTMLCanvasElement) return element.width === candidate.naturalWidth && element.height === candidate.naturalHeight;
  return backgroundSource(getComputedStyle(element).backgroundImage) === candidate.source;
}

/** Never expose signed queries, data payloads or embedded credentials in diagnostics. */
export function describeSource(source: string): string {
  try { const url = new URL(source); return /^https?:$/.test(url.protocol) ? `${url.origin}${url.pathname}` : `${url.protocol} (ảnh nội bộ)`; }
  catch { return '(chưa có nguồn)'; }
}
