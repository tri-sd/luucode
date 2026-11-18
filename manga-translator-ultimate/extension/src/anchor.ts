import { pngBlob } from './bytes';
import { imageSource, type MangaImage } from './detector';

export interface Anchor {
  valid(): boolean;
  restore(): void;
}

type Attribute = { element: Element; name: string; before: string | null; ours: string };
function setAttr(element: Element, name: string, ours: string): Attribute {
  const before = element.getAttribute(name);
  element.setAttribute(name, ours);
  return {element, name, before, ours};
}
function attrsFor(img: HTMLImageElement, url: string, density: number): Attribute[] {
  const srcset = url + " " + density.toFixed(7) + "x";
  const attrs = [];
  if (img.parentElement instanceof HTMLPictureElement) {
    for (const source of img.parentElement.querySelectorAll(':scope > source')) {
      attrs.push(setAttr(source, 'srcset', srcset));
    }
  }
  if (img.hasAttribute('srcset') || Math.abs(density-1) > .001) attrs.push(setAttr(img, 'srcset', srcset));
  attrs.push(setAttr(img, 'src', url));
  return attrs;
}

function inlineAnchor(attrs: Attribute[], url: string): Anchor {
  return {
    valid: () => attrs.every(a => a.element.getAttribute(a.name) === a.ours),
    restore() {
      for (const a of attrs) {
        if (a.element.getAttribute(a.name) !== a.ours) continue;
        if (a.before == null) a.element.removeAttribute(a.name);
        else a.element.setAttribute(a.name, a.before);
      }
      URL.revokeObjectURL(url);
    },
  };
}

function axes(element: HTMLElement): DOMMatrix {
  let matrix = new DOMMatrix();
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent);
    if (css.perspective !== 'none') throw new Error('Ảnh có phép chiếu 3D chưa hỗ trợ ở chế độ canvas.');
    let next = new DOMMatrix(css.transform === 'none' ? undefined : css.transform);
    if (!next.is2D) throw new Error('Ảnh có phép chiếu 3D chưa hỗ trợ ở chế độ canvas.');
    const rotation = css.rotate.split(' ');
    if (rotation.length === 1 && rotation[0] !== 'none') {
      const angle = rotation[0].endsWith('rad') ? parseFloat(rotation[0])*180/Math.PI :
        rotation[0].endsWith('turn') ? parseFloat(rotation[0])*360 : parseFloat(rotation[0]);
      next = new DOMMatrix().rotate(angle).multiply(next);
    } else if (rotation.length > 1) {
      throw new Error('Ảnh có phép xoay 3D chưa hỗ trợ ở chế độ canvas.');
    }
    const scale = css.scale === 'none' ? [1, 1] : css.scale.split(' ').map(Number);
    next = new DOMMatrix().scale(scale[0], scale[1] ?? scale[0]).multiply(next);
    const zoom = Number(css.zoom) || 1;
    matrix = new DOMMatrix().scale(zoom).multiply(next).multiply(matrix);
  }
  return matrix;
}

function cssBox(element: HTMLElement) {
  const css = getComputedStyle(element);
  const horizontal = parseFloat(css.paddingLeft)+parseFloat(css.paddingRight)+parseFloat(css.borderLeftWidth)+parseFloat(css.borderRightWidth);
  const vertical = parseFloat(css.paddingTop)+parseFloat(css.paddingBottom)+parseFloat(css.borderTopWidth)+parseFloat(css.borderBottomWidth);
  return {css, width: parseFloat(css.width)+(css.boxSizing === 'border-box' ? 0 : horizontal),
    height: parseFloat(css.height)+(css.boxSizing === 'border-box' ? 0 : vertical)};
}

function project(element: HTMLElement, root: DOMRect) {
  const rect = element.getBoundingClientRect();
  const {css, width, height} = cssBox(element);
  const {a,b,c,d} = axes(element);
  const left = rect.left - Math.min(0, a*width, c*height, a*width+c*height);
  const top = rect.top - Math.min(0, b*width, d*height, b*width+d*height);
  const transform = new DOMMatrix([a,b,c,d,left-root.left,top-root.top]);
  if (![a,b,c,d,left,top,width,height].every(Number.isFinite) || Math.abs(a*d-b*c) < 1e-6)
    throw new Error('Không xác định được tọa độ ảnh.');
  return {css, width, height, transform};
}

function clipToScrollAncestors(element: HTMLElement, root: DOMRect, matrix: DOMMatrix) {
  let area: {left:number; right:number; top:number; bottom:number} | undefined;
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clipX = style.overflowX !== 'visible';
    const clipY = style.overflowY !== 'visible';
    if (!clipX && !clipY) continue;
    const rect = parent.getBoundingClientRect();
    const xScale = parent.offsetWidth ? rect.width/parent.offsetWidth : 1;
    const yScale = parent.offsetHeight ? rect.height/parent.offsetHeight : 1;
    const l = rect.left+parent.clientLeft*xScale, t = rect.top+parent.clientTop*yScale;
    const r = l+parent.clientWidth*xScale, b = t+parent.clientHeight*yScale;
    area ??= {left:-1e5,right:1e5,top:-1e5,bottom:1e5};
    if (clipX) { area.left = Math.max(area.left,l); area.right = Math.min(area.right,r); }
    if (clipY) { area.top = Math.max(area.top,t); area.bottom = Math.min(area.bottom,b); }
  }
  if (!area) return '';
  if (area.left >= area.right || area.top >= area.bottom) return 'inset(100%)';
  const inv = matrix.inverse();
  const points = [[area.left,area.top],[area.right,area.top],[area.right,area.bottom],[area.left,area.bottom]];
  return 'polygon('+points.map(([x,y]) => {
    const local = inv.transformPoint(new DOMPoint(x-root.left,y-root.top));
    return `${local.x}px ${local.y}px`;
  }).join(',')+')';
}

async function canvasAnchor(image: MangaImage, blob: Blob, signal: AbortSignal): Promise<Anchor> {
  const bitmap = await createImageBitmap(blob);
  let layer: HTMLDivElement | undefined;
  let canvas: HTMLCanvasElement;
  try {
    signal.throwIfAborted();
    // A zero-size absolutely positioned root adds no reader layout footprint.
    if (getComputedStyle(document.documentElement).transform !== 'none') throw new Error('Trang biến đổi phần tử gốc.');
    layer = document.createElement('div');
    layer.setAttribute('data-mtu-overlay', '');
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:10;display:block';
    canvas = document.createElement('canvas');
    canvas.setAttribute('data-mtu-overlay', '');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', {alpha: true});
    if (!context) throw new Error('Không tạo được canvas.');
    context.drawImage(bitmap, 0, 0);
    canvas.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;display:block;max-width:none;max-height:none;box-sizing:border-box;pointer-events:none';
    layer.append(canvas);
    document.documentElement.append(layer);
    function update() {
      const root = layer!.getBoundingClientRect();
      const {css, width, height, transform} = project(image, root);
      canvas.style.width = width+'px';
      canvas.style.height = height+'px';
      canvas.style.transform = transform.toString();
      canvas.style.objectFit = css.objectFit;
      canvas.style.objectPosition = css.objectPosition;
      canvas.style.padding = css.padding;
      canvas.style.borderWidth = css.borderWidth;
      canvas.style.borderStyle = css.borderStyle;
      canvas.style.borderColor = 'transparent';
      canvas.style.borderRadius = css.borderRadius;
      canvas.style.clipPath = clipToScrollAncestors(image, root, transform);
    }
    update();
    const source = imageSource(image);
    const before = image.style.getPropertyValue('opacity');
    const priority = image.style.getPropertyPriority('opacity');
    const visualOpacity = getComputedStyle(image).opacity;
    canvas.style.opacity = visualOpacity;
    image.style.setProperty('opacity', '0', 'important');
    let raf = 0;
    const restore = () => {
      cancelAnimationFrame(raf);
      layer?.remove();
      if (image.style.getPropertyValue('opacity') === '0' && image.style.getPropertyPriority('opacity') === 'important') {
        if (before) image.style.setProperty('opacity', before, priority);
        else image.style.removeProperty('opacity');
      }
      canvas.width = 0;
      canvas.height = 0;
    };
    // rAF tracks compositor transforms, page and nested scroll, and reflows
    // even when the image itself does not resize.
    const follow = () => {
      if (!image.isConnected || !layer?.isConnected) { restore(); return; }
      try { update(); } catch { restore(); return; }
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return {valid: () => Boolean(layer?.isConnected && image.style.opacity === '0' && imageSource(image) === source), restore};
  } catch (error) {
    layer?.remove();
    throw error;
  } finally {
    bitmap.close();
  }
}

async function fastDecode(img: HTMLImageElement): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([img.decode(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Đợi hiển thị ảnh quá lâu.')), 1800);
    })]);
  } finally { clearTimeout(timer); }
}

export async function apply(image: MangaImage, data: string, signal: AbortSignal): Promise<Anchor> {
  signal.throwIfAborted();
  const blob = pngBlob(data);
  if (image instanceof HTMLImageElement) {
    const url = URL.createObjectURL(blob);
    const probe = new Image();
    probe.src = url;
    try {
      await fastDecode(probe);
      signal.throwIfAborted();
      const density = probe.naturalWidth / Math.max(1, image.naturalWidth);
      const anchor = inlineAnchor(attrsFor(image, url, density), url);
      try {
        await fastDecode(image);
        signal.throwIfAborted();
        if (!anchor.valid()) throw new Error('Website đã đổi ảnh.');
        return anchor;
      } catch (error) {
        anchor.restore();
        throw error;
      }
    } catch {
      URL.revokeObjectURL(url);
      signal.throwIfAborted();
    }
  }
  return canvasAnchor(image, blob, signal);
}
