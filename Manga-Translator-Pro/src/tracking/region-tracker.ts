import { regionRenderKey } from '../core/region-metadata';
import { createMockRegions, matchesBinding, validateRegions } from '../core/regions';
import type { DetectionReport, ImageCandidate, RegionBinding, RegionResult, TextRegion } from '../core/types';
import { ImageDiscovery } from '../discovery/image-discovery';
import { isCurrentCandidate } from '../discovery/image-source';
import { TextOverlay, type OverlayFrame, type OverlayOptions, type RegionSelection } from '../overlay/text-overlay';
import { FrameMeasurements, measureCandidate, visibleFraction } from './dom-geometry';
import type { ImageGeometry } from './dom-geometry';
import type { ImageSelection } from '../translation/types';

interface TrackedImage {
  readonly candidate: ImageCandidate;
  readonly binding: RegionBinding;
  regions: readonly TextRegion[];
  nearViewport: boolean;
}

interface InstanceState { readonly id: string; generation: number }

export interface TrackingStatus {
  readonly active: boolean;
  readonly trackedCount: number;
  readonly visibleCount: number;
  readonly images: readonly (RegionBinding & { readonly source: string })[];
}

export class RegionTracker {
  readonly documentToken = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  private readonly instances = new WeakMap<HTMLElement, InstanceState>();
  private readonly tracked = new Map<HTMLElement, TrackedImage>();
  private readonly discovery = new ImageDiscovery((images) => this.reconcile(images));
  private overlay: TextOverlay | null = null;
  private intersection: IntersectionObserver | null = null;
  private frame: number | null = null;
  private active = false;
  private nextId = 0;
  private readonly imageSubscribers = new Set<(images: readonly ImageCandidate[]) => void>();
  private overlayOptions: OverlayOptions = { visible: true, background: 'mask' };
  private captureHidden = false;
  private editing = false;
  private readonly selectionSubscribers = new Set<(selection: RegionSelection) => void>();

  constructor(private readonly options: { readonly initialRegions?: 'mock' | 'empty' } = {}) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.overlay = new TextOverlay((selection) => {
      if (!this.editing || !this.findRecord(selection.binding)) return;
      for (const subscriber of this.selectionSubscribers) subscriber(selection);
    });
    this.overlay.setEditMode(this.editing);
    this.overlay.setOptions(this.overlayOptions);
    this.overlay.setCaptureHidden(this.captureHidden);
    this.intersection = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!(entry.target instanceof HTMLElement)) continue;
        const record = this.tracked.get(entry.target);
        if (record) record.nearViewport = entry.isIntersecting;
      }
    }, { rootMargin: '600px' });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.discovery.start();
    this.schedule();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.discovery.stop();
    this.intersection?.disconnect();
    this.intersection = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.tracked.clear();
    this.notifyImages();
    this.overlay?.destroy();
    this.overlay = null;
  }

  status(): TrackingStatus {
    return {
      active: this.active, trackedCount: this.tracked.size,
      visibleCount: this.overlay?.visibleCount ?? 0,
      images: [...this.tracked.values()].map(({ binding, candidate }) => ({ ...binding, source: candidate.source })),
    };
  }

  currentImage(): ImageSelection | null {
    const frame = new FrameMeasurements();
    let selected: { readonly record: TrackedImage; readonly area: number } | undefined;
    for (const record of this.tracked.values()) {
      if (!isCurrentCandidate(record.candidate)) continue;
      const geometry = measureCandidate(record.candidate, frame).geometry;
      if (!geometry) continue;
      const area = geometry.clip.width * geometry.clip.height * visibleFraction(record.candidate, geometry);
      if (area <= 0) continue;
      if (!selected || area > selected.area) selected = { record, area };
    }
    if (!selected) return null;
    const { candidate, binding } = selected.record;
    return { ...binding, documentToken: this.documentToken, source: candidate.source, method: candidate.method, requiresCapture: candidate.method === 'canvas' || !/^https?:/.test(candidate.source), naturalWidth: candidate.naturalWidth, naturalHeight: candidate.naturalHeight };
  }

  /** DOM identities remain transient; persistent chapter identity belongs to ImageRegistry. */
  candidates(): readonly ImageCandidate[] {
    return [...this.tracked.values()].filter((record) => isCurrentCandidate(record.candidate)).map((record) => record.candidate);
  }

  bindings(): readonly { readonly candidate: ImageCandidate; readonly binding: RegionBinding }[] {
    return [...this.tracked.values()].filter((record) => isCurrentCandidate(record.candidate))
      .map(({ candidate, binding }) => ({ candidate, binding }));
  }

  bindingFor(element: HTMLElement): RegionBinding | null {
    const record = this.tracked.get(element);
    return record && isCurrentCandidate(record.candidate) ? record.binding : null;
  }

  /** The owner unsubscribes on disposal; stop emits [] without retaining detached nodes. */
  subscribeImages(callback: (images: readonly ImageCandidate[]) => void): () => void {
    this.imageSubscribers.add(callback);
    callback(this.candidates());
    return () => { this.imageSubscribers.delete(callback); };
  }

  subscribeRegionSelection(callback: (selection: RegionSelection) => void): () => void {
    this.selectionSubscribers.add(callback);
    return () => { this.selectionSubscribers.delete(callback); };
  }

  setEditMode(enabled: boolean): void { this.editing = enabled; this.overlay?.setEditMode(enabled); }

  clearRegions(): void {
    for (const record of this.tracked.values()) {
      record.regions = [];
      this.overlay?.invalidate(record.binding.instanceId);
    }
  }

  setOverlayOptions(options: Partial<OverlayOptions>): void {
    this.overlayOptions = { ...this.overlayOptions, ...options };
    this.overlay?.setOptions(this.overlayOptions);
  }

  refresh(): void { this.discovery.refresh(); }

  debugDetection(): DetectionReport {
    this.discovery.refresh();
    const report = this.discovery.diagnostics();
    const frame = new FrameMeasurements();
    let visible = 0;
    const entries = report.entries.map((entry) => {
      if (!entry.valid) return entry;
      const record = [...this.tracked.values()].find((item) => item.candidate.discoveryId === entry.nodeId);
      if (!record) return entry;
      const measurement = measureCandidate(record.candidate, frame);
      const isVisible = measurement.geometry && visibleFraction(record.candidate, measurement.geometry) > 0;
      if (isVisible) visible++;
      return { ...entry, reason: isVisible ? 'Đang hiển thị; có thể dịch.' : measurement.reason || 'Bị phần tử khác che khuất.' };
    });
    return { ...report, visible, entries };
  }

  geometry(selection: ImageSelection): ImageGeometry | null {
    const record = this.findRecord(selection);
    return record ? measureCandidate(record.candidate, new FrameMeasurements()).geometry : null;
  }

  element(selection: ImageSelection): HTMLElement | null { return this.findRecord(selection)?.candidate.element ?? null; }

  hideOverlay(hidden: boolean): void {
    this.captureHidden = hidden;
    this.overlay?.setCaptureHidden(hidden);
  }

  private findRecord(binding: RegionBinding): TrackedImage | undefined {
    return [...this.tracked.values()].find((item) => matchesBinding(item.binding, binding) && isCurrentCandidate(item.candidate));
  }

  applyRegions(result: RegionResult): boolean {
    if (!validateRegions(result.regions)) return false;
    const record = [...this.tracked.values()].find((item) => matchesBinding(item.binding, result)
      && isCurrentCandidate(item.candidate));
    if (!record) return false;
    if (record.regions.length === result.regions.length
      && record.regions.every((previous, index) => regionRenderKey(previous) === regionRenderKey(result.regions[index]!))) return true;
    record.regions = result.regions;
    this.overlay?.invalidate(record.binding.instanceId);
    return true;
  }

  private reconcile(candidates: readonly ImageCandidate[]): void {
    let changed = false;
    const present = new Set(candidates.map((candidate) => candidate.element));
    for (const [image, record] of this.tracked) {
      if (!present.has(image)) {
        this.intersection?.unobserve(image);
        this.overlay?.invalidate(record.binding.instanceId);
        this.tracked.delete(image);
        changed = true;
      }
    }
    for (const candidate of candidates) {
      const previous = this.tracked.get(candidate.element);
      if (previous?.candidate.sourceKey === candidate.sourceKey) continue;
      let instance = this.instances.get(candidate.element);
      if (!instance) {
        instance = { id: `image-${++this.nextId}`, generation: 0 };
        this.instances.set(candidate.element, instance);
      }
      instance.generation++;
      changed = true;
      const binding: RegionBinding = {
        instanceId: instance.id, generation: instance.generation, sourceKey: candidate.sourceKey,
      };
      this.overlay?.invalidate(instance.id);
      this.tracked.set(candidate.element, {
        candidate, binding, regions: this.options.initialRegions === 'empty' ? [] : createMockRegions(`${instance.id} · v${instance.generation}`), nearViewport: true,
      });
      this.intersection?.observe(candidate.element);
    }
    if (changed) this.notifyImages();
  }

  private notifyImages(): void {
    if (this.imageSubscribers.size === 0) return;
    const snapshot = this.candidates();
    for (const subscriber of this.imageSubscribers) subscriber(snapshot);
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden && this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    } else if (!document.hidden) this.schedule();
  };

  private schedule(): void {
    if (!this.active || document.hidden || this.frame !== null) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    this.frame = null;
    if (!this.active || !this.overlay) return;
    this.overlay.ensureMounted();
    const measurements = new FrameMeasurements();
    const root = measurements.rect(this.overlay.host);
    const frames: OverlayFrame[] = [];
    for (const record of this.tracked.values()) {
      // Source changes must hide old regions before the asynchronous discovery scan runs.
      if (!this.overlayOptions.visible || !record.nearViewport || record.regions.length === 0 || !isCurrentCandidate(record.candidate)) continue;
      const geometry = measureCandidate(record.candidate, measurements).geometry;
      if (geometry && visibleFraction(record.candidate, geometry) > 0) frames.push({ binding: record.binding, candidate: record.candidate, geometry, regions: record.regions });
    }
    this.overlay.render(frames, root.x, root.y, this.overlay.unitScale());
    this.schedule();
  };
}
