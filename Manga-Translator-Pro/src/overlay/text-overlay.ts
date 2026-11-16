import { isRegionPositionTrusted, polygonClipPath } from '../core/region-metadata';
import type { ImageCandidate, NormalizedBox, OverlayBackground, RegionBinding, TextRegion } from '../core/types';
import { mapRegionToRenderedImage } from '../tracking/coordinate-mapper';
import type { ImageGeometry } from '../tracking/dom-geometry';

interface RegionNode {
  readonly element: HTMLDivElement;
  readonly text: HTMLSpanElement;
  readonly box: NormalizedBox;
  readonly region: TextRegion;
}
interface Layer {
  readonly outer: HTMLDivElement;
  readonly surface: HTMLDivElement;
  readonly generation: number;
  readonly regions: readonly RegionNode[];
  fittedSize: string;
}
interface FitRequest {
  readonly node: RegionNode;
  low: number;
  high: number;
  font: number;
  rounds: number;
}
export interface OverlayOptions { readonly visible: boolean; readonly background: OverlayBackground }
export interface RegionSelection { readonly binding: RegionBinding; readonly regionId: string }
export interface OverlayFrame {
  readonly binding: RegionBinding;
  readonly candidate: ImageCandidate;
  readonly geometry: ImageGeometry;
  readonly regions: readonly TextRegion[];
}

const css = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; pointer-events: none !important; }
  .layer { position: absolute; overflow: hidden; margin: 0; padding: 0; border: 0; }
  .surface { position: absolute; margin: 0; padding: 0; border: 0; }
  .region {
    position: absolute; display: flex; align-items: center; justify-content: center;
    overflow: hidden; margin: 0; padding: 3px; border: 1px solid #2873bd;
    border-radius: 5px; background: rgba(255, 255, 255, .95); color: #12304c;
    font-family: Arial, "Segoe UI", sans-serif; font-weight: 600; line-height: 1.25;
    text-align: center; white-space: pre-line; overflow-wrap: anywhere;
    user-select: none; text-shadow: none; letter-spacing: normal;
  }
  :host([data-background="dark"]) .region { background:#17191c; color:#fff; border-color:transparent; border-radius:8px; font-weight:700; }
  :host([data-background="adaptive"]) .region { background:#fff; color:#18364b; border-color:transparent; }
  :host([data-editing="true"]) .region, :host([data-editing="true"]) .region * { pointer-events:auto !important; cursor:crosshair; }
  :host([data-editing="true"]) .region { outline:1px dashed #16a085; outline-offset:-1px; }
  .text { display: block; flex: 0 1 auto; min-width: 0; width: 100%; }
  :host([data-background="original"]) .region { background: transparent; border-color: transparent; }
`;

function setStyle(element: HTMLElement, name: string, value: string): void {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}
const px = (value: number): string => `${value.toFixed(4)}px`;

export class TextOverlay {
  readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly layers = new Map<string, Layer>();
  private readonly unit = document.createElement('div');
  private readonly pendingFits = new Map<HTMLDivElement, FitRequest>();
  private fitFrame: number | null = null;
  private options: OverlayOptions = { visible: true, background: 'mask' };
  private captureHidden = false;
  private editing = false;

  constructor(private readonly onSelect?: (selection: RegionSelection) => void) {
    this.host = document.createElement('div');
    this.host.setAttribute('data-mtp-root', 'phase-1');
    this.host.setAttribute('aria-hidden', 'true');
    const properties: Record<string, string> = {
      all: 'initial', position: 'absolute', display: 'block', top: '0', left: '0',
      width: '0', height: '0', margin: '0', padding: '0', border: '0',
      'pointer-events': 'none', 'z-index': '2147483646',
      'contain': 'style', 'visibility': 'visible', 'opacity': '1',
    };
    for (const [name, value] of Object.entries(properties)) this.host.style.setProperty(name, value, 'important');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    this.unit.style.cssText = 'position:absolute;width:100px;height:100px;visibility:hidden;pointer-events:none';
    this.shadow.append(style, this.unit);
    this.ensureMounted();
  }

  setOptions(options: OverlayOptions): void {
    this.options = options;
    this.host.dataset['background'] = options.background;
    for (const layer of this.layers.values()) for (const node of layer.regions) this.applyAppearance(node);
    this.syncVisibility();
  }
  setEditMode(enabled: boolean): void {
    if (this.editing === enabled) return;
    this.editing = enabled;
    this.host.dataset['editing'] = String(enabled);
    for (const [id, layer] of this.layers) this.removeLayer(id, layer);
  }
  setCaptureHidden(hidden: boolean): void { this.captureHidden = hidden; this.syncVisibility(); }
  private syncVisibility(): void {
    this.host.style.setProperty('visibility', this.options.visible && !this.captureHidden ? 'visible' : 'hidden', 'important');
  }

  ensureMounted(): void {
    if (this.host.isConnected) return;
    document.documentElement.append(this.host);
    // A font-fit callback may have discarded disconnected regions while the site
    // removed our host. Refit recovered layers once after mounting again.
    for (const layer of this.layers.values()) layer.fittedSize = '';
  }
  unitScale(): number { return this.unit.getBoundingClientRect().width / 100 || 1; }

  /** Page geometry is read before this write phase. Text fitting is batched separately. */
  render(frames: readonly OverlayFrame[], rootX: number, rootY: number, scale = 1): void {
    const visible = new Set(frames.map((frame) => frame.binding.instanceId));
    for (const [id, layer] of this.layers) if (!visible.has(id)) this.removeLayer(id, layer);
    for (const frame of frames) {
      const { binding, geometry } = frame;
      let layer = this.layers.get(binding.instanceId);
      if (layer && layer.generation !== binding.generation) { this.removeLayer(binding.instanceId, layer); layer = undefined; }
      if (!layer) {
        layer = this.createLayer(frame);
        this.layers.set(binding.instanceId, layer);
        this.shadow.append(layer.outer);
      }
      const fixed = geometry.anchor === 'viewport';
      setStyle(layer.outer, 'position', fixed ? 'fixed' : 'absolute');
      setStyle(layer.outer, 'left', px((geometry.clip.x - (fixed ? 0 : rootX)) / scale));
      setStyle(layer.outer, 'top', px((geometry.clip.y - (fixed ? 0 : rootY)) / scale));
      setStyle(layer.outer, 'width', px(geometry.clip.width / scale));
      setStyle(layer.outer, 'height', px(geometry.clip.height / scale));
      setStyle(layer.surface, 'left', px((geometry.painted.x - geometry.clip.x) / scale));
      setStyle(layer.surface, 'top', px((geometry.painted.y - geometry.clip.y) / scale));
      const width = geometry.painted.width / scale, height = geometry.painted.height / scale;
      setStyle(layer.surface, 'width', px(width));
      setStyle(layer.surface, 'height', px(height));
      const fittedSize = `${width.toFixed(3)}:${height.toFixed(3)}`;
      if (layer.fittedSize !== fittedSize) {
        layer.fittedSize = fittedSize;
        for (const node of layer.regions) {
          const box = mapRegionToRenderedImage(node.box, { x: 0, y: 0, width, height });
          const font = Math.max(1, Math.min(22, width * 0.025, (box.height - 8) / 1.25));
          setStyle(node.element, 'font-size', px(font));
          this.pendingFits.set(node.element, { node, low: 1, high: font, font, rounds: 0 });
        }
        this.scheduleFit();
      }
    }
  }

  invalidate(instanceId: string): void {
    const layer = this.layers.get(instanceId);
    if (layer) this.removeLayer(instanceId, layer);
  }
  private removeLayer(id: string, layer: Layer): void {
    for (const node of layer.regions) this.pendingFits.delete(node.element);
    layer.outer.remove(); this.layers.delete(id);
  }
  destroy(): void {
    if (this.fitFrame !== null) cancelAnimationFrame(this.fitFrame);
    this.fitFrame = null;
    this.pendingFits.clear(); this.layers.clear(); this.host.remove();
  }
  get visibleCount(): number { return this.layers.size; }

  private scheduleFit(): void {
    if (this.fitFrame !== null || this.pendingFits.size === 0) return;
    this.fitFrame = requestAnimationFrame(this.fitText);
  }
  private readonly fitText = (): void => {
    this.fitFrame = null;
    // Read every overlay text first, then write font sizes. At most eight rounds
    // after creation/resize; scrolling alone never starts another fit cycle.
    const readings = [...this.pendingFits.values()].map((request) => {
      const { element, text } = request.node;
      return { request, connected: element.isConnected,
        fits: text.scrollWidth <= Math.max(0, element.clientWidth - 6)
          && text.scrollHeight <= Math.max(0, element.clientHeight - 6) };
    });
    for (const { request, connected, fits } of readings) {
      const { element } = request.node;
      if (!connected) { this.pendingFits.delete(element); continue; }
      if (fits) request.low = request.font;
      else request.high = request.font;
      request.rounds++;
      if ((fits && request.rounds === 1) || request.rounds >= 8 || request.high - request.low <= 0.15) {
        setStyle(element, 'font-size', px(request.low));
        element.dataset['fitState'] = request.low < 8 ? 'small-text' : fits ? 'fit' : 'needs-review';
        this.pendingFits.delete(element);
      } else {
        request.font = (request.low + request.high) / 2;
        setStyle(element, 'font-size', px(request.font));
      }
    }
    this.scheduleFit();
  };


  private applyAppearance(node: RegionNode): void {
    const { element, region } = node;
    if (this.options.background === 'adaptive' && region.backgroundColor && (region.backgroundVariance ?? 0) <= 0.08) {
      const color = region.backgroundColor;
      const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
      const luminance = channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
      setStyle(element, 'background-color', color);
      setStyle(element, 'color', luminance > 140 ? '#15191d' : '#ffffff');
    } else {
      element.style.removeProperty('background-color'); element.style.removeProperty('color');
    }
  }

  private createLayer(frame: OverlayFrame): Layer {
    const outer = document.createElement('div'); outer.className = 'layer';
    outer.dataset['instanceId'] = frame.binding.instanceId;
    outer.dataset['generation'] = String(frame.binding.generation);
    outer.dataset['source'] = frame.candidate.source;
    outer.dataset['sourceElement'] = frame.candidate.element.id;
    const surface = document.createElement('div'); surface.className = 'surface';
    const regions: RegionNode[] = [];
    for (const region of frame.regions) {
      if (!this.editing && !isRegionPositionTrusted(region)) continue;
      const element = document.createElement('div'); element.className = 'region';
      element.dataset['regionId'] = region.id;
      element.dataset['kind'] = region.kind ?? 'unknown';
      element.dataset['sourceDirection'] = region.direction ?? 'unknown';
      element.dataset['ocrConfidence'] = region.ocrConfidence == null ? 'unknown' : String(region.ocrConfidence);
      element.dataset['positionConfidence'] = region.positionConfidence == null ? 'unknown' : String(region.positionConfidence);
      element.dataset['reviewRequired'] = String(region.reviewRequired === true || !isRegionPositionTrusted(region));
      if (region.polygon) element.style.clipPath = polygonClipPath(region.polygon, region.box);
      element.addEventListener('click', (event) => {
        if (!this.editing || !event.isTrusted) return;
        event.preventDefault(); event.stopPropagation();
        this.onSelect?.({ binding: frame.binding, regionId: region.id });
      });
      const text = document.createElement('span'); text.className = 'text'; text.textContent = region.text;
      element.append(text);
      Object.assign(element.style, { left: `${region.box.x * 100}%`, top: `${region.box.y * 100}%`, width: `${region.box.width * 100}%`, height: `${region.box.height * 100}%` });
      const node: RegionNode = { element, text, box: region.box, region };
      this.applyAppearance(node);
      surface.append(element); regions.push(node);
    }
    outer.append(surface);
    return { outer, surface, generation: frame.binding.generation, regions, fittedSize: '' };
  }
}
