import { base64, responseBlob } from './bytes';
import { fetchImage } from './protocol';

export type MangaImage = HTMLImageElement | HTMLCanvasElement;

export interface ReaderAdapter {
  matches(url: URL): boolean;
  candidates(root: Document | Element): Iterable<MangaImage>;
  accepts(image: MangaImage): boolean;
}

const generic: ReaderAdapter = {
  matches: () => true,
  candidates: root => root.querySelectorAll<MangaImage>('img,canvas'),
  accepts: element => {
    if (element.hasAttribute('data-mtu-overlay') ||
        element.closest('header,nav,footer,aside,[role="banner"],[role="advertisement"],[aria-hidden="true"]')) return false;
    if (/(^|[\s_-])(banner|advert|avatar|logo|thumbnail|sponsor|ads?)([\s_-]|$)/i.test(element.className.toString())) return false;
    const r = element.getBoundingClientRect();
    const [nw, nh] = dimensions(element);
    if (nw && nh && (nw < 240 || nh < 200 || nw/nh > 3.8)) return false;
    return r.width >= Math.min(250, innerWidth*.42) && (r.height >= 175 ||
      (!ready(element) && element instanceof HTMLImageElement && Boolean(element.dataset.src || element.src)));
  },
};
const adapters: ReaderAdapter[] = [generic];

export function scan(root: Document | Element): MangaImage[] {
  const adapter = adapters.find(a => a.matches(new URL(location.href))) ?? generic;
  return Array.from(adapter.candidates(root)).filter(i => adapter.accepts(i));
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

export async function capture(element: MangaImage, url: string, signal: AbortSignal): Promise<string> {
  if (element instanceof HTMLCanvasElement) return asCanvas(element);
  const parsed = new URL(url, location.href);
  if (!['http:', 'https:', 'blob:', 'data:'].includes(parsed.protocol)) throw new Error('Định dạng địa chỉ ảnh không được hỗ trợ.');
  const scoped = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
  try {
    const response = await fetch(parsed, {credentials: 'same-origin', signal: scoped});
    return await base64(await responseBlob(response));
  } catch {
    signal.throwIfAborted();
    try { return await asCanvas(element); }
    catch {
      signal.throwIfAborted();
      if (['http:', 'https:'].includes(parsed.protocol)) return fetchImage(parsed.href);
      throw new Error('Chrome không cho phép đọc ảnh này.');
    }
  }
}
