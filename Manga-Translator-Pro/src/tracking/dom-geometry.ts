import { fittedImageRect, intersectRects, isSupportedScale, isSupportedTransform, parseObjectPosition, type ObjectFit } from '../core/geometry';
import type { ImageCandidate, Rect } from '../core/types';

export interface ImageGeometry {
  readonly painted: Rect;
  readonly clip: Rect;
  readonly anchor: 'document' | 'viewport';
}
export type Measurement = { readonly geometry: ImageGeometry; readonly reason: null } | { readonly geometry: null; readonly reason: string };

/** One cache per animation frame, shared by images with the same ancestors. */
export class FrameMeasurements {
  private readonly styles = new Map<Element, CSSStyleDeclaration>();
  private readonly rectangles = new Map<Element, DOMRect>();
  style(element: Element): CSSStyleDeclaration {
    let result = this.styles.get(element);
    if (!result) { result = getComputedStyle(element); this.styles.set(element, result); }
    return result;
  }
  rect(element: Element): DOMRect {
    let result = this.rectangles.get(element);
    if (!result) { result = element.getBoundingClientRect(); this.rectangles.set(element, result); }
    return result;
  }
}

const number = (value: string): number => Number.parseFloat(value) || 0;
const clips = (value: string): boolean => /^(hidden|clip|scroll|auto)$/.test(value);
const fail = (reason: string): Measurement => ({ geometry: null, reason });

function unsupported(style: CSSStyleDeclaration): string | null {
  if (style.display === 'none' || style.visibility !== 'visible' || number(style.opacity) === 0) return 'Phần tử/ancestor đang ẩn.';
  if (!isSupportedTransform(style.transform) || !isSupportedScale(style.scale)
    || !['none', '', '0deg'].includes(style.rotate)) return 'Transform xoay, lật hoặc skew chưa hỗ trợ.';
  if (!['none', ''].includes(style.perspective)) return 'Perspective chưa hỗ trợ.';
  if (!['none', ''].includes(style.clipPath) || !['none', ''].includes(style.maskImage)) return 'clip-path/mask chưa hỗ trợ.';
  if (style.zoom && style.zoom !== 'normal' && !(number(style.zoom) > 0)) return 'CSS zoom không hợp lệ.';
  return null;
}

function backgroundPaint(candidate: ImageCandidate, style: CSSStyleDeclaration, content: Rect, padding: Rect, outer: Rect, sx: number, sy: number): Rect | null {
  if (style.backgroundAttachment !== 'scroll') return null;
  const origin = style.backgroundOrigin === 'content-box' ? content : style.backgroundOrigin === 'border-box' ? outer : padding;
  const position = parseObjectPosition(style.backgroundPosition);
  if (!position) return null;
  let painted: Rect;
  const size = style.backgroundSize;
  if (size === 'contain' || size === 'cover') painted = fittedImageRect(origin, candidate.naturalWidth, candidate.naturalHeight, size, position, sx, sy);
  else {
    const tokens = size.trim().split(/\s+/);
    if (tokens.length === 1) tokens.push('auto');
    if (tokens.length !== 2) return null;
    const length = (token: string, total: number, scale: number): number | null => {
      if (token === 'auto') return null;
      if (!/^\d+(?:\.\d+)?(?:px|%)$/.test(token)) return NaN;
      return token.endsWith('%') ? number(token) / 100 * total : number(token) * scale;
    };
    let w = length(tokens[0]!, origin.width, sx), h = length(tokens[1]!, origin.height, sy);
    const ratio = (candidate.naturalWidth * sx) / (candidate.naturalHeight * sy);
    if (w === null && h === null) { w = candidate.naturalWidth * sx; h = candidate.naturalHeight * sy; }
    else if (w === null) w = h! * ratio;
    else if (h === null) h = w / ratio;
    if (!(w! > 0 && h! > 0)) return null;
    painted = fittedImageRect(origin, w! / sx, h! / sy, 'none', position, sx, sy);
  }
  // Repeated small backgrounds have no unique source-to-element mapping.
  if (style.backgroundRepeat !== 'no-repeat' && (painted.width < origin.width - 0.1 || painted.height < origin.height - 0.1)) return null;
  return painted;
}

export function measureCandidate(candidate: ImageCandidate, frame: FrameMeasurements): Measurement {
  const viewport = window.visualViewport;
  if (viewport && (Math.abs(viewport.scale - 1) > 0.001 || Math.abs(viewport.offsetLeft) > 0.01 || Math.abs(viewport.offsetTop) > 0.01)) {
    return fail('Pinch zoom chưa hỗ trợ; hãy đưa pinch zoom về 100%. Zoom trình duyệt và zoom reader vẫn được hỗ trợ.');
  }
  const image = candidate.element;
  if (!image.isConnected || !image.getClientRects().length) return fail('Phần tử không còn trong DOM hoặc không được render.');
  const style = frame.style(image);
  const reason = unsupported(style);
  if (reason) return fail(reason);
  const rootStyle = frame.style(document.documentElement);
  if (rootStyle.transform !== 'none' || !['none', ''].includes(rootStyle.scale)
    || !['none', '', '0deg'].includes(rootStyle.rotate)) return fail('Transform trên html chưa hỗ trợ.');
  const outer = frame.rect(image);
  const borderX = number(style.borderLeftWidth) + number(style.borderRightWidth);
  const borderY = number(style.borderTopWidth) + number(style.borderBottomWidth);
  const paddingX = number(style.paddingLeft) + number(style.paddingRight);
  const paddingY = number(style.paddingTop) + number(style.paddingBottom);
  const cssWidth = number(style.width), cssHeight = number(style.height);
  const borderBoxWidth = style.boxSizing === 'border-box' ? cssWidth : cssWidth + borderX + paddingX;
  const borderBoxHeight = style.boxSizing === 'border-box' ? cssHeight : cssHeight + borderY + paddingY;
  if (!(borderBoxWidth > 0 && borderBoxHeight > 0)) return fail('Kích thước CSS bằng 0.');
  const sx = outer.width / borderBoxWidth, sy = outer.height / borderBoxHeight;
  const padding: Rect = { x: outer.x + number(style.borderLeftWidth) * sx, y: outer.y + number(style.borderTopWidth) * sy,
    width: (borderBoxWidth - borderX) * sx, height: (borderBoxHeight - borderY) * sy };
  const content: Rect = { x: padding.x + number(style.paddingLeft) * sx, y: padding.y + number(style.paddingTop) * sy,
    width: padding.width - paddingX * sx, height: padding.height - paddingY * sy };
  if (!(content.width > 0 && content.height > 0)) return fail('Content box bằng 0.');
  let painted: Rect | null;
  let paintClip = content;
  if (candidate.method === 'background') {
    painted = backgroundPaint(candidate, style, content, padding, outer, sx, sy);
    paintClip = style.backgroundClip === 'content-box' ? content : style.backgroundClip === 'padding-box' ? padding : outer;
  } else {
    const position = parseObjectPosition(style.objectPosition), fit = style.objectFit;
    painted = position && ['fill', 'contain', 'cover', 'none', 'scale-down'].includes(fit)
      ? fittedImageRect(content, candidate.naturalWidth, candidate.naturalHeight, fit as ObjectFit, position, sx, sy) : null;
  }
  if (!painted) return fail('object-position/background-size/position/repeat chưa hỗ trợ.');
  let clip = intersectRects(painted, paintClip);
  if (clip) clip = intersectRects(clip, { x: 0, y: 0, width: document.documentElement.clientWidth, height: window.innerHeight });
  if (!clip) return fail('Ảnh nằm ngoài vùng đang xem.');
  let fixed = style.position === 'fixed';
  for (let ancestor = image.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const ancestorStyle = frame.style(ancestor), why = unsupported(ancestorStyle);
    if (why) return fail(why);
    if (fixed && (ancestorStyle.transform !== 'none' || !['none', ''].includes(ancestorStyle.scale)
      || /layout|paint|strict|content/.test(ancestorStyle.contain))) fixed = false;
    if (ancestorStyle.position === 'fixed') fixed = true;
    if (!(clips(ancestorStyle.overflowX) || clips(ancestorStyle.overflowY))) continue;
    const rect = frame.rect(ancestor);
    const ax = ancestor.offsetWidth ? rect.width / ancestor.offsetWidth : 1;
    const ay = ancestor.offsetHeight ? rect.height / ancestor.offsetHeight : 1;
    clip = intersectRects(clip, {
      x: clips(ancestorStyle.overflowX) ? rect.x + ancestor.clientLeft * ax : clip.x,
      y: clips(ancestorStyle.overflowY) ? rect.y + ancestor.clientTop * ay : clip.y,
      width: clips(ancestorStyle.overflowX) ? ancestor.clientWidth * ax : clip.width,
      height: clips(ancestorStyle.overflowY) ? ancestor.clientHeight * ay : clip.height,
    });
    if (!clip) return fail('Ảnh bị cắt hoàn toàn bởi container.');
  }
  return { geometry: { painted, clip, anchor: fixed ? 'viewport' : 'document' }, reason: null };
}

/** Hit tests prevent selecting an inactive slide hidden behind the active page. */
export function visibleFraction(candidate: Pick<ImageCandidate, 'element'>, geometry: ImageGeometry): number {
  const { clip } = geometry;
  let visible = 0;
  for (const x of [0.2, 0.5, 0.8]) for (const y of [0.2, 0.5, 0.8]) {
    const top = document.elementsFromPoint(clip.x + clip.width * x, clip.y + clip.height * y).find((element) => {
      // Editable regions deliberately receive pointer input. They must never occlude
      // their own source in discovery/geometry hit tests, including Shadow DOM hosts.
      for (let current: Element | null = element; current;) {
        if (current.closest('[data-mtp-root], [data-mtp-ui]')) return false;
        const root = current.getRootNode();
        current = root instanceof ShadowRoot ? root.host : null;
      }
      return true;
    });
    if (top === candidate.element || (getComputedStyle(candidate.element).pointerEvents === 'none' && top?.contains(candidate.element))) visible++;
  }
  return visible / 9;
}
