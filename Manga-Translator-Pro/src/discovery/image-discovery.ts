import type { DetectionEntry, DetectionMethod, DetectionReport, ImageCandidate } from '../core/types';
import { eligibilityReason } from './eligibility';
import { backgroundSource, describeSource, imageRequestKey } from './image-source';

interface Probe { readonly image: HTMLImageElement; loaded: boolean; failed: boolean }

export class ImageDiscovery {
  private readonly nodeIds = new WeakMap<HTMLElement, number>();
  private nextNodeId = 0;
  private readonly epochs = new WeakMap<HTMLElement, number>();
  private readonly observed = new Set<HTMLElement>();
  private readonly probes = new Map<string, Probe>();
  private readonly mutation = new MutationObserver((records) => {
    if (records.some((record) => !(record.target instanceof Element && record.target.closest('[data-mtp-root], [data-mtp-ui]')))) this.schedule();
  });
  private readonly resize = new ResizeObserver(() => this.schedule());
  private frame: number | null = null;
  private running = false;
  private report: DetectionReport = { domImages: 0, canvases: 0, backgrounds: 0, valid: 0, visible: 0, entries: [] };

  constructor(private readonly onSnapshot: (images: readonly ImageCandidate[]) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.mutation.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['src', 'srcset', 'sizes', 'media', 'type', 'style', 'class', 'id', 'alt', 'width', 'height', 'hidden', 'data-src', 'data-srcset'],
    });
    document.addEventListener('load', this.onImageLoad, true);
    document.addEventListener('error', this.onImageLoad, true);
    window.addEventListener('resize', this.schedule);
    document.addEventListener('visibilitychange', this.schedule);
    document.addEventListener('transitionend', this.schedule, true);
    document.addEventListener('animationend', this.schedule, true);
    this.scan();
  }

  stop(): void {
    this.running = false;
    this.mutation.disconnect(); this.resize.disconnect(); this.observed.clear();
    document.removeEventListener('load', this.onImageLoad, true);
    document.removeEventListener('error', this.onImageLoad, true);
    window.removeEventListener('resize', this.schedule);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    document.removeEventListener('visibilitychange', this.schedule);
    document.removeEventListener('transitionend', this.schedule, true);
    document.removeEventListener('animationend', this.schedule, true);
    this.frame = null;
    for (const probe of this.probes.values()) { probe.image.onload = null; probe.image.onerror = null; }
    this.probes.clear();
  }

  refresh(): void { this.scan(); }
  diagnostics(): DetectionReport { return this.report; }

  private readonly onImageLoad = (event: Event): void => {
    if (event.target instanceof HTMLImageElement) this.epochs.set(event.target, (this.epochs.get(event.target) ?? 0) + 1);
    this.schedule();
  };

  private readonly schedule = (): void => {
    if (!this.running || this.frame !== null || document.hidden) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.scan(); });
  };

  private probe(source: string): Probe {
    let probe = this.probes.get(source);
    if (probe) return probe;
    const image = new Image();
    probe = { image, loaded: false, failed: false };
    this.probes.set(source, probe);
    const state = probe;
    image.onload = () => { state.loaded = true; this.schedule(); };
    image.onerror = () => { state.failed = true; this.schedule(); };
    image.src = source;
    return probe;
  }

  private scan(): void {
    if (!this.running) return;
    const candidates: ImageCandidate[] = [], entries: DetectionEntry[] = [];
    const current = new Set<HTMLElement>(), usedSources = new Set<string>();
    let domImages = 0, canvases = 0, backgrounds = 0;
    for (const element of document.querySelectorAll<HTMLElement>('*')) {
      if (!(element instanceof HTMLElement) || element.closest('[data-mtp-root], [data-mtp-ui]')) continue;
      let method: DetectionMethod, source: string, requestKey: string, naturalWidth = 0, naturalHeight = 0, pending = '';
      const rect = element.getBoundingClientRect();
      if (element instanceof HTMLImageElement) {
        domImages++; method = element.closest('picture') ? 'picture' : 'img';
        source = element.currentSrc || element.src;
        requestKey = imageRequestKey(element);
        naturalWidth = element.naturalWidth; naturalHeight = element.naturalHeight;
        if (!element.complete || !naturalWidth) pending = 'Ảnh chưa tải xong, bị lỗi hoặc đang lazy load.';
      } else if (element instanceof HTMLCanvasElement) {
        canvases++; method = 'canvas'; source = 'canvas:visible';
        naturalWidth = element.width; naturalHeight = element.height;
        requestKey = JSON.stringify([element.width, element.height]);
      } else {
        if (rect.width < 160 || rect.height < 160) continue;
        const background = getComputedStyle(element).backgroundImage;
        if (background === 'none') continue;
        backgrounds++; method = 'background'; source = backgroundSource(background) ?? '';
        if (!source) pending = 'Background nhiều lớp/gradient/image-set chưa hỗ trợ.';
        else {
          usedSources.add(source);
          const probe = this.probe(source);
          naturalWidth = probe.image.naturalWidth; naturalHeight = probe.image.naturalHeight;
          if (!probe.loaded) pending = probe.failed ? 'Không đọc được kích thước background.' : 'Đang đọc kích thước background.';
        }
        requestKey = source;
      }
      current.add(element);
      if (!this.observed.has(element)) { this.observed.add(element); this.resize.observe(element); }
      const reason = pending || eligibilityReason({ source, naturalWidth, naturalHeight,
        renderedWidth: rect.width, renderedHeight: rect.height,
        description: `${element instanceof HTMLImageElement ? element.alt : ''} ${element.id} ${element.className} ${describeSource(source)}`,
        inNavigation: false,
      });
      let nodeId = this.nodeIds.get(element);
      if (nodeId === undefined) { nodeId = ++this.nextNodeId; this.nodeIds.set(element, nodeId); }
      entries.push({ nodeId, element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`, method,
        source: describeSource(source), naturalWidth, naturalHeight, renderedWidth: rect.width, renderedHeight: rect.height,
        valid: !reason, reason: reason || 'Đủ điều kiện kích thước; chờ kiểm tra hiển thị.',
      });
      if (!reason) candidates.push({ discoveryId: nodeId, element, method, source, requestKey, naturalWidth, naturalHeight,
        sourceKey: JSON.stringify([method, requestKey, source, naturalWidth, naturalHeight, this.epochs.get(element) ?? 0]),
      });
    }
    for (const element of this.observed) if (!current.has(element)) { this.resize.unobserve(element); this.observed.delete(element); }
    for (const [source, probe] of this.probes) if (!usedSources.has(source)) {
      probe.image.onload = probe.image.onerror = null; this.probes.delete(source);
    }
    this.report = { domImages, canvases, backgrounds, valid: candidates.length, visible: 0, entries };
    this.onSnapshot(candidates);
  }
}
