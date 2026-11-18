import { base64, responseBlob } from './bytes';
import { fetchImage } from './protocol';

export type MangaImage = HTMLImageElement | HTMLCanvasElement;

export interface ReaderAdapter {
  matches(url: URL): boolean;
  candidates(root: Document | Element): Iterable<MangaImage>;
  accepts(image: MangaImage, shortStrip?: boolean): boolean;
}

const generic: ReaderAdapter = {
  matches: () => true,
  candidates: root => root.querySelectorAll<MangaImage>('img,canvas'),
  accepts: (element, shortStrip = false) => {
    if (element.hasAttribute('data-mtu-overlay') ||
        element.closest('header,nav,footer,aside,[role="banner"],[role="advertisement"],[aria-hidden="true"]')) return false;
    if (/(^|[\s_-])(banner|advert|avatar|logo|thumbnail|sponsor|ads?)([\s_-]|$)/i.test(element.className.toString())) return false;
    const r = element.getBoundingClientRect();
    const [nw, nh] = dimensions(element);
    if (nw && nh && (nw < 240 || nh < (shortStrip ? 36 : 200) || nw/nh > (shortStrip ? 26 : 3.8))) return false;
    return r.width >= Math.min(250, innerWidth*.42) && (r.height >= (shortStrip ? 18 : 175) ||
      (!ready(element) && element instanceof HTMLImageElement && Boolean(element.dataset.src || element.src)));
  },
};
const adapters: ReaderAdapter[] = [generic];

export function scan(root: Document | Element, knownWidths: readonly number[] = []): MangaImage[] {
  const adapter = adapters.find(a => a.matches(new URL(location.href))) ?? generic;
  const candidates = Array.from(adapter.candidates(root));
  const standard = new Set(candidates.filter(image => adapter.accepts(image)));
  const peers = new Map<Element, number[]>();
  function containers(image: MangaImage) {
    const parents: Element[] = [];
    let parent = image.parentElement;
    while (parent && parent !== document.body && parents.length < 3) {
      parents.push(parent);
      parent = parent.parentElement;
    }
    return parents;
  }
  for (const image of standard) {
    const [width] = dimensions(image);
    if (!width) continue;
    for (const parent of containers(image)) {
      const widths = peers.get(parent) ?? [];
      if (!widths.includes(width)) widths.push(width);
      peers.set(parent, widths);
    }
  }
  return candidates.filter(image => standard.has(image) || (
    ready(image) && adapter.accepts(image, true) &&
    (knownWidths.some(width => Math.abs(dimensions(image)[0]/width-1) < .18) ||
     containers(image).some(parent => peers.get(parent)?.some(width => Math.abs(dimensions(image)[0]/width-1) < .18)))
  ));
}
export function ready(element: MangaImage): boolean {
  return element instanceof HTMLImageElement ? element.complete && element.naturalWidth > 0 :
    element.width > 0 && element.height > 0;
}
export function dimensions(element: MangaImage): [number, number] {
  return element instanceof HTMLImageElement ? [element.naturalWidth, element.naturalHeight] : [element.width, element.height];
}
export function imageSource(element: MangaImage): string {
  return element instanceof HTMLImageElement ? (element.currentSrc || element.src) : `canvas:${element.width}x${element.height}`;
}

function asCanvas(element: MangaImage): Promise<string> {
  const [width, height] = dimensions(element);
  if (width*height > 25_000_000 || Math.max(width,height) > 35000) throw new Error('Ảnh quá lớn.');
  let canvas: HTMLCanvasElement;
  if (element instanceof HTMLCanvasElement) {
    canvas = element;
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(element, 0, 0, width, height);
  }
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('Chrome không đọc được pixel của ảnh.')), 'image/png')).then(base64);
}

export async function capture(element: MangaImage | null, url: string, signal: AbortSignal): Promise<string> {
  if (element instanceof HTMLCanvasElement) return asCanvas(element);
  const parsed = new URL(url, location.href);
  if (!['http:', 'https:', 'blob:', 'data:'].includes(parsed.protocol)) throw new Error('Định dạng địa chỉ ảnh không được hỗ trợ.');
  const scoped = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
  try {
    const response = await fetch(parsed, {credentials: 'same-origin', signal: scoped});
    return await base64(await responseBlob(response));
  } catch {
    signal.throwIfAborted();
    try {
      if (element) return await asCanvas(element);
    } catch {
      signal.throwIfAborted();
    }
    if (['http:', 'https:'].includes(parsed.protocol)) return fetchImage(parsed.href);
    throw new Error('Chrome không cho phép đọc ảnh này.');
  }
}
