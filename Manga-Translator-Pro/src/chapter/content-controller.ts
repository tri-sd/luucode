import type { ImageCandidate, RegionBinding } from '../core/types';
import { isCurrentCandidate } from '../discovery/image-source';
import type { RegionTracker } from '../tracking/region-tracker';
import type { TranslationOutput } from '../translation/types';
import { RegionEditor } from '../ui/region-editor';
import { applyRegionEdits, type RegionEditsInput } from './region-edits';
import type { EditableRegionSnapshot } from './chapter-service';
import { imageIdentity } from './identity';
import { FloatingTranslatorController, type ChapterPanelAction } from '../ui/floating-translator';
import { ChapterCollector, hasReachedScrollEnd, pageOrdinalFromLabels, sampledPixelFingerprint } from './chapter-collector';
import { chapterIdentity } from './identity';
import type { ChapterView, ImageObservation } from './types';

export type ChapterTransport = (request: Readonly<Record<string, unknown>>) => Promise<unknown>;
export interface ChapterRestoration {
  readonly imageId: string;
  readonly sourceKey: string;
  readonly output: TranslationOutput;
}
interface LiveObservation { readonly candidate: ImageCandidate; readonly observation: ImageObservation }
const bindingKey = (binding: RegionBinding): string => JSON.stringify([binding.instanceId, binding.generation, binding.sourceKey]);

/** Content-side lifecycle only. Persistence/provider work stays in trusted extension contexts. */
export class ChapterContentController {
  private editor: RegionEditor | undefined;
  private editing: LiveObservation | undefined;
  private unsubscribeSelection: (()=>void) | undefined;
  private readonly floating: FloatingTranslatorController;
  private view: ChapterView | undefined;
  private collector: ChapterCollector;
  private url: string;
  private chapterId: string;
  private epoch = 0;
  private running = false;
  private captureHidden = false;
  private unsubscribe: (() => void) | undefined;
  private syncTimer: number | undefined;
  private pollTimer: number | undefined;
  private retryTimer: number | undefined;
  private navigationFrame: number | undefined;
  private interactionFrame: number | undefined;
  private attaching: Promise<void> | undefined;
  private syncing: Promise<void> | undefined;
  private flushing: Promise<void> | undefined;
  private syncAgain = false;
  private commandBusy = false;
  private retryAfter = 0;
  private completionMarker = '';
  private readonly retiredSessions = new Set<string>();
  private readonly applied = new Map<string, string>();
  private readonly attempted = new Map<string, string>();

  constructor(private readonly tracker: RegionTracker, private readonly transport: ChapterTransport) {
    const identity = chapterIdentity(location.href);
    this.url = identity.url; this.chapterId = identity.id;
    this.collector = new ChapterCollector(identity.id);
    this.floating = new FloatingTranslatorController({ onAction: (action) => this.command(action.command, action.value) });
    this.floating.setAvailable(false);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tracker.start();
    this.unsubscribe = this.tracker.subscribeImages(() => {
      this.checkNavigation();
      this.pruneBindings();
      this.collectCurrent();
      this.updateAvailability();
      this.scheduleSync(120);
    });
    this.unsubscribeSelection = this.tracker.subscribeRegionSelection(({binding,regionId})=>{
      if(this.editing && bindingKey(this.editing.observation.binding)===bindingKey(binding)) this.editor?.selectRegion(regionId);
      else void this.openEditor(binding,regionId).catch((error:unknown)=>this.showError(error));
    });
    window.addEventListener('popstate', this.onNavigation);
    window.addEventListener('hashchange', this.onNavigation);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('pointerup', this.onInteraction, true);
    window.addEventListener('keydown', this.onInteraction, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    // This checks metadata/progress, not the DOM. Discovery remains observer-driven.
    this.pollTimer = window.setInterval(() => {
      if (document.hidden) return;
      if (this.view?.session.status === 'running' || this.view?.session.status === 'collecting') this.scheduleSync(0);
    }, 1200);
    this.scheduleNavigationCheck();
    this.scheduleSync(0);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false; this.epoch++;
    this.closeEditor(false);
    this.unsubscribeSelection?.(); this.unsubscribeSelection=undefined;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    window.removeEventListener('popstate', this.onNavigation);
    window.removeEventListener('hashchange', this.onNavigation);
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('pointerup', this.onInteraction, true);
    window.removeEventListener('keydown', this.onInteraction, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const timer of [this.syncTimer, this.pollTimer, this.retryTimer]) if (timer !== undefined) clearTimeout(timer);
    for (const frame of [this.navigationFrame, this.interactionFrame]) if (frame !== undefined) cancelAnimationFrame(frame);
    this.syncTimer = this.pollTimer = this.retryTimer = this.navigationFrame = this.interactionFrame = undefined;
    this.applied.clear(); this.attempted.clear(); this.collector.finish();
    this.floating.destroy();
  }

  currentView(): ChapterView | undefined { return this.view; }
  refresh(): void { this.scheduleSync(0); }

  invalidateTranslations(resetSession = false): void {
    if (resetSession) this.resetTranslationsForClear();
    this.applied.clear(); this.attempted.clear(); this.completionMarker = '';
    this.tracker.clearRegions(); this.retryAfter = 0;
    this.scheduleSync(0);
  }

  setCaptureHidden(hidden: boolean): void { this.captureHidden = hidden; this.editor?.setHidden(hidden); this.updateAvailability(); }

  async command(command: ChapterPanelAction['command'], value?: unknown): Promise<void> {
    if (!this.running || this.commandBusy) return;
    this.commandBusy = true; this.floating.setBusy(true); this.floating.setMessage('');
    try {
      this.checkNavigation();
      const commandEpoch = this.epoch;
      await this.attach();
      if (!this.isCurrent(commandEpoch)) return;
      if (command === 'edit') { await this.openEditor(); return; }
      if (command === 'finish' || command === 'translate' || command === 'quick-translate') {
        this.collectCurrent(); await this.flush();
        if (!this.isCurrent(commandEpoch)) return;
      }
      if(command==='quick-translate' && this.view?.session.status==='collecting') {
        const finished=await this.request<ChapterView>('chapter:command',{command:'finish'});
        if(!this.isCurrent(commandEpoch))return;
        this.acceptView(finished);
      }
      if (command === 'clear') this.resetTranslationsForClear();
      const epoch = this.epoch;
      const response = await this.request<ChapterView>('chapter:command', { command:command==='quick-translate'?'translate':command, ...(value === undefined ? {} : { value }) });
      if (!this.isCurrent(epoch)) return;
      this.acceptView(response);
      if (command === 'collect') {
        this.collectCurrent(); await this.flush();
        if (this.view?.images.some((image) => image.access === 'live-only')) {
          this.floating.setMessage('Canvas/ảnh nội bộ chỉ dịch được khi đang xem. Metadata được giữ lại; ảnh cũ không truy cập được sẽ báo lỗi riêng.');
        }
      }
      this.retryAfter = 0;
      await this.restoreCurrent(epoch);
    } catch (error) { this.showError(error); }
    finally {
      this.commandBusy = false;
      if (this.running) { this.floating.setBusy(false); this.scheduleSync(0); }
    }
  }

  async openEditor(binding?:RegionBinding,regionId?:string):Promise<void> {
    const selected=binding??this.tracker.currentImage();
    if(!selected)throw new Error('Chọn ảnh đã dịch trong vùng đang xem trước.');
    const live=this.liveObservations().find((item)=>bindingKey(item.observation.binding)===bindingKey(selected));
    if(!live)throw new Error('Ảnh đã thay đổi. Hãy chọn lại ảnh đang xem.');
    const epoch=this.epoch;
    const snapshot=await this.request<EditableRegionSnapshot>('chapter:regions',{observation:live.observation});
    const assertCurrent=():void=>{
      const current=this.tracker.bindingFor(live.candidate.element);
      if(!this.isCurrent(epoch)||!current||bindingKey(current)!==bindingKey(live.observation.binding)||!isCurrentCandidate(live.candidate)) throw new Error('Ảnh hoặc chương đã thay đổi; chưa áp dụng bản sửa cũ.');
    };
    assertCurrent();this.closeEditor(false);this.editing=live;this.tracker.setEditMode(true);
    const apply=(output:TranslationOutput):void=>{
      assertCurrent();
      for(const current of this.liveObservations())if(imageIdentity(this.chapterId,current.observation)===snapshot.imageId){
        if(this.tracker.applyRegions({...current.observation.binding,regions:output.regions}))this.applied.set(bindingKey(current.observation.binding),snapshot.imageId);
      }
    };
    const mutate=async(type:string,current:EditableRegionSnapshot,edits?:RegionEditsInput):Promise<EditableRegionSnapshot>=>{
      assertCurrent();
      const updated=await this.request<EditableRegionSnapshot>(type,{observation:live.observation,cacheKey:current.cacheKey,expectedRevision:current.revision,...(edits?{edits}:{})});
      assertCurrent();apply(updated.output);return updated;
    };
    this.editor=new RegionEditor({
      onPreview:(edits)=>apply(applyRegionEdits(snapshot.original,{...edits,revision:'preview',updatedAt:0})),
      onSave:(edits,current)=>mutate('chapter:save-regions',current,edits),
      onReset:(current)=>mutate('chapter:reset-regions',current),
      onReprocess:async(crop,current)=>{assertCurrent();const result=await this.request<TranslationOutput>('chapter:reprocess-region',{observation:live.observation,cacheKey:current.cacheKey,expectedRevision:current.revision,crop});assertCurrent();return result;},
      onClose:()=>this.closeEditor(true),
    });
    this.editor.open(snapshot,regionId);this.editor.setHidden(this.captureHidden);
  }

  private closeEditor(restore:boolean):void {
    if(this.editor)void this.request('chapter:cancel-reprocess').catch(()=>undefined);
    this.editor?.destroy();this.editor=undefined;this.editing=undefined;this.tracker.setEditMode(false);
    if(restore)this.invalidateTranslations();
  }

  /** Used before popup Finish/Translate too, so the last discovered frame is checkpointed. */
  async flush(): Promise<void> {
    if (!this.running) return;
    this.checkNavigation(); this.collectCurrent();
    if (this.flushing) return this.flushing;
    const epoch = this.epoch, collector = this.collector;
    const operation = (async (): Promise<void> => {
      let sendEndHint = collector.collecting && this.endObserved() && this.view?.session.endObserved !== true;
      while (this.isCurrent(epoch) && (collector.pendingCount > 0 || sendEndHint)) {
        const batch = collector.drain(50);
        sendEndHint = false;
        try {
          const response = await this.request<ChapterView>('chapter:observe', { observations: batch, endObserved: this.endObserved() });
          if (!this.isCurrent(epoch)) return;
          this.acceptView(response);
        } catch (error) { if (this.isCurrent(epoch)) collector.requeue(batch); throw error; }
      }
    })();
    this.flushing = operation;
    try { await operation; }
    finally { if (this.flushing === operation) this.flushing = undefined; }
  }

  private async request<T>(type: string, extra: Readonly<Record<string, unknown>> = {}): Promise<T> {
    return await this.transport({ type, url: this.url, documentToken: this.tracker.documentToken, ...extra }) as T;
  }

  private async attach(): Promise<void> {
    if (this.view || !this.running) return;
    if (this.attaching) return this.attaching;
    const epoch = this.epoch;
    const operation = (async (): Promise<void> => {
      const response = await this.request<ChapterView>('chapter:attach');
      if (this.isCurrent(epoch)) this.acceptView(response);
    })();
    this.attaching = operation;
    try { await operation; }
    finally { if (this.attaching === operation) this.attaching = undefined; }
  }

  private acceptView(view: ChapterView): void {
    if (!view?.session || view.session.id !== this.chapterId || !Array.isArray(view.images)) return;
    if (view.session.incarnation && this.retiredSessions.has(view.session.incarnation)) return;
    if (this.view && view.session.incarnation !== this.view.session.incarnation) this.resetTranslationsForClear();
    if (this.view && view.session.createdAt < this.view.session.createdAt) return;
    if (this.view && view.session.createdAt > this.view.session.createdAt) this.resetTranslationsForClear();
    if (this.view && view.session.revision < this.view.session.revision) return;
    const oldResults=new Map(this.view?.images.map((image)=>[image.id,image.resultRevision])??[]);
    const changedResults=new Set(view.images.filter((image)=>oldResults.has(image.id)&&oldResults.get(image.id)!==image.resultRevision).map((image)=>image.id));
    for(const [key,imageId]of this.applied)if(changedResults.has(imageId)){
      this.applied.delete(key);this.attempted.delete(key);
      const current=this.tracker.bindings().find((item)=>bindingKey(item.binding)===key);
      if(current)this.tracker.applyRegions({...current.binding,regions:[]});
    }
    const oldProfile = this.view?.session.profile?.key ?? '';
    const profile = view.session.profile?.key ?? '';
    if (this.view && oldProfile !== profile) {
      this.applied.clear(); this.attempted.clear(); this.tracker.clearRegions();
    }
    this.view = view;
    if (view.session.status === 'collecting') this.collector.begin();
    else this.collector.finish();
    this.tracker.setOverlayOptions({ visible: view.session.options.overlayVisible, background: view.session.options.overlayBackground });
    this.floating.update(view); this.updateAvailability();
    const marker = `${profile}:${view.progress.completed}:${view.images.map((image)=>image.resultRevision??'').join('|')}`;
    if (this.completionMarker !== marker) { this.completionMarker = marker; this.attempted.clear(); }
  }

  private scheduleSync(delay: number): void {
    if (!this.running || document.hidden) return;
    if (this.commandBusy) { this.syncAgain = true; return; }
    if (this.syncing) { this.syncAgain = true; return; }
    if (this.syncTimer !== undefined) {
      if (delay !== 0) return;
      clearTimeout(this.syncTimer);
    }
    this.syncTimer = window.setTimeout(() => {
      this.syncTimer = undefined;
      const operation = this.synchronize(); this.syncing = operation;
      void operation.finally(() => {
        if (this.syncing === operation) this.syncing = undefined;
        if (this.syncAgain) { this.syncAgain = false; this.scheduleSync(120); }
      });
    }, delay);
  }

  private async synchronize(): Promise<void> {
    this.checkNavigation();
    if (this.commandBusy) { this.syncAgain = true; return; }
    if (!this.running || (!this.view && this.tracker.candidates().length === 0) || Date.now() < this.retryAfter) return;
    const epoch = this.epoch;
    try {
      await this.attach();
      if (!this.isCurrent(epoch)) return;
      const response = await this.request<ChapterView>('chapter:status');
      if (!this.isCurrent(epoch)) return;
      this.acceptView(response); this.collectCurrent();
      await this.flush();
      if (!this.isCurrent(epoch)) return;
      await this.restoreCurrent(epoch);
    } catch (error) {
      if (!this.isCurrent(epoch)) return;
      this.showError(error); this.retryAfter = Date.now() + 5000;
      if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => { this.retryTimer = undefined; this.scheduleSync(0); }, 5000);
    }
  }

  private liveObservations(): LiveObservation[] {
    const result: LiveObservation[] = [];
    for (const { candidate, binding } of this.tracker.bindings()) {
      if (!isCurrentCandidate(candidate) || candidate.source.length > 16_000 || candidate.sourceKey.length > 30_000) continue;
      let fingerprint: string | undefined;
      const element = candidate.element;
      if (element instanceof HTMLCanvasElement) fingerprint = this.canvasFingerprint(element);
      const labels = [element.getAttribute('data-page'), element.getAttribute('data-page-number'),
        element.getAttribute('aria-label'), element instanceof HTMLImageElement ? element.alt : null];
      for (let parent = element.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
        labels.push(parent.getAttribute('data-page'), parent.getAttribute('data-page-number'));
      }
      const pageOrdinal = pageOrdinalFromLabels(labels);
      result.push({ candidate, observation: {
        source: candidate.source, sourceKey: candidate.sourceKey, naturalWidth: candidate.naturalWidth, naturalHeight: candidate.naturalHeight,
        method: candidate.method, binding, documentToken: this.tracker.documentToken,
        ...(pageOrdinal === undefined ? {} : { pageOrdinal }), ...(fingerprint ? { fingerprint } : {}),
      } });
    }
    return result;
  }

  private canvasFingerprint(element: HTMLCanvasElement): string | undefined {
    const sample = document.createElement('canvas'); sample.width = sample.height = 32;
    try {
      const context = sample.getContext('2d', { willReadFrequently: true });
      if (!context) return undefined;
      context.drawImage(element, 0, 0, 32, 32);
      return sampledPixelFingerprint(element.width, element.height, context.getImageData(0, 0, 32, 32).data);
    } catch { return undefined; }
    finally { sample.width = sample.height = 0; }
  }

  private collectCurrent(): void {
    if (this.collector.collecting) this.collector.observe(this.liveObservations().map((item) => item.observation));
  }

  private async restoreCurrent(epoch: number): Promise<void> {
    if (!this.view?.session.profile || this.view.progress.completed === 0 || !this.isCurrent(epoch)) return;
    const marker = this.completionMarker;
    const pending = this.liveObservations().filter(({ candidate, observation }) => {
      const rect = candidate.element.getBoundingClientRect();
      if (rect.bottom < -600 || rect.top > innerHeight + 600 || rect.right < -600 || rect.left > innerWidth + 600) return false;
      const key = bindingKey(observation.binding);
      return !this.applied.has(key) && this.attempted.get(key) !== marker;
    });
    for (let offset = 0; offset < pending.length && this.isCurrent(epoch); offset += 12) {
      const batch = pending.slice(offset, offset + 12);
      const restored = await this.request<readonly ChapterRestoration[]>('chapter:restore', { observations: batch.map((item) => item.observation) });
      if (!this.isCurrent(epoch) || marker !== this.completionMarker || !Array.isArray(restored)) return;
      for (const { observation } of batch) {
        const key = bindingKey(observation.binding);
        this.attempted.set(key, marker);
        const match = restored.find((item) => item.sourceKey === observation.sourceKey && Array.isArray(item.output?.regions));
        if (match && this.tracker.applyRegions({ ...observation.binding, regions: match.output.regions })) this.applied.set(key, match.imageId);
      }
    }
  }

  private pruneBindings(): void {
    if(this.editing){const binding=this.tracker.bindingFor(this.editing.candidate.element);if(!binding||bindingKey(binding)!==bindingKey(this.editing.observation.binding)||!isCurrentCandidate(this.editing.candidate))this.closeEditor(false);}
    const current = new Set(this.tracker.bindings().map(({ binding }) => bindingKey(binding)));
    for (const key of this.applied.keys()) if (!current.has(key)) this.applied.delete(key);
    for (const key of this.attempted.keys()) if (!current.has(key)) this.attempted.delete(key);
  }

  private endObserved(): boolean {
    const scroller = document.scrollingElement;
    if (scroller && hasReachedScrollEnd(scroller)) return true;
    const checked = new Set<HTMLElement>();
    for (const candidate of this.tracker.candidates()) {
      for (let parent = candidate.element.parentElement; parent && !checked.has(parent); parent = parent.parentElement) {
        checked.add(parent);
        if (hasReachedScrollEnd(parent) && /^(auto|scroll)$/.test(getComputedStyle(parent).overflowY)) return true;
      }
    }
    return false;
  }

  private updateAvailability(): void {
    this.floating.setAvailable(!this.captureHidden && (this.tracker.candidates().length > 0 || Boolean(this.view?.images.length)));
  }
  private showError(error: unknown): void {
    if (this.running) this.floating.setMessage(error instanceof Error ? error.message : 'Chưa đồng bộ được chương. Hãy mở lại popup và thử lại.', true);
  }
  private isCurrent(epoch: number): boolean { return this.running && epoch === this.epoch && chapterIdentity(location.href).id === this.chapterId; }

  private resetTranslationsForClear(): void {
    this.closeEditor(false);
    if (this.view?.session.incarnation) this.retiredSessions.add(this.view.session.incarnation);
    if (this.retiredSessions.size > 64) this.retiredSessions.delete(this.retiredSessions.values().next().value!);
    this.epoch++; this.view = undefined; this.attaching = undefined; this.flushing = undefined;
    this.collector = new ChapterCollector(this.chapterId); this.completionMarker = '';
    this.applied.clear(); this.attempted.clear(); this.tracker.clearRegions();
  }
  private checkNavigation(): void {
    const identity = chapterIdentity(location.href);
    if (identity.id === this.chapterId) return;
    this.closeEditor(false);
    this.epoch++; this.url = identity.url; this.chapterId = identity.id;
    this.collector = new ChapterCollector(identity.id); this.view = undefined;
    this.attaching = undefined; this.flushing = undefined; this.completionMarker = ''; this.retryAfter = 0;
    this.applied.clear(); this.attempted.clear(); this.tracker.clearRegions();
    this.floating.update(undefined); this.scheduleSync(0);
  }
  private scheduleNavigationCheck(): void {
    if (!this.running || document.hidden || this.navigationFrame !== undefined) return;
    // No layout reads/scans: a URL guard hides the previous chapter before asynchronous replies can apply.
    this.navigationFrame = requestAnimationFrame(() => {
      this.navigationFrame = undefined; this.checkNavigation(); this.scheduleNavigationCheck();
    });
  }
  private readonly onNavigation = (): void => { this.checkNavigation(); this.scheduleSync(0); };
  private readonly onVisibility = (): void => {
    if (document.hidden) {
      if (this.navigationFrame !== undefined) cancelAnimationFrame(this.navigationFrame);
      this.navigationFrame = undefined;
    } else { this.scheduleNavigationCheck(); this.scheduleSync(0); }
  };
  private readonly onScroll = (): void => {
    if (this.collector.collecting || (this.view?.progress.completed && this.applied.size < this.tracker.candidates().length)) this.scheduleSync(220);
  };
  private readonly onInteraction = (): void => {
    if (!this.collector.collecting || !this.tracker.candidates().some((candidate) => candidate.method === 'canvas') || this.interactionFrame !== undefined) return;
    this.interactionFrame = requestAnimationFrame(() => {
      this.interactionFrame = requestAnimationFrame(() => {
        this.interactionFrame = undefined; this.collectCurrent(); this.scheduleSync(80);
      });
    });
  };
}
