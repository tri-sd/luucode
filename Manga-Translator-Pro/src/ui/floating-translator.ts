import type { ChapterView } from '../chapter/types';
import { ChapterPanel, chapterPanelCss, type ChapterPanelAction, type ChapterPanelOptions } from './chapter-panel';
export type { ChapterPanelAction } from './chapter-panel';

const floatingCss = `
:host { all:initial; }
* { box-sizing:border-box; }
[hidden] { display:none !important; }
.floating-shell { position:relative; font:13px/1.5 Arial,"Segoe UI",sans-serif; color:#17384b; }
.floating-toolbar { position:relative; z-index:3; display:flex; align-items:center; gap:8px; padding:6px; border:1px solid #607c7e; border-radius:10px; background:#213d45; box-shadow:0 4px 18px #0003; max-width:calc(100vw - 16px); }
.launcher { display:block; border:0; border-radius:6px; padding:7px 8px; background:#17333d; color:#d7f5ed; cursor:grab; font:700 12px Arial,"Segoe UI",sans-serif; touch-action:none; white-space:nowrap; }
.launcher:active { cursor:grabbing; }
.image-count { color:#fff; font:600 12px Arial,"Segoe UI",sans-serif; white-space:nowrap; font-variant-numeric:tabular-nums; }
.quick-translate { border:1px solid #60c9ad; border-radius:7px; padding:8px 11px; background:#117058; color:#fff; cursor:pointer; font:700 12px Arial,"Segoe UI",sans-serif; white-space:nowrap; }
.quick-translate:disabled { opacity:.55; cursor:default; }
.launcher:focus-visible,.close-panel:focus-visible,.quick-translate:focus-visible,.toast-control:focus-visible { outline:3px solid #dca841; outline-offset:2px; }
.chapter-popover { position:absolute; z-index:2; right:0; bottom:52px; width:min(360px,calc(100vw - 24px)); max-height:calc(100vh - 100px); overflow:auto; border:1px solid #c4d8df; border-radius:12px; padding:17px; background:#f3f8fa; box-shadow:0 8px 32px #0004; }
.close-panel { display:block; margin:0 0 8px auto; border:0; padding:3px 6px; background:transparent; color:#536d7b; font:12px Arial,sans-serif; cursor:pointer; }
.progress-toast { position:fixed; z-index:1; right:18px; bottom:18px; width:min(330px,calc(100vw - 24px)); color:#e7f3f3; background:#142d36; border:1px solid #557780; border-radius:10px; box-shadow:0 5px 22px #0004; font:12px/1.45 Arial,"Segoe UI",sans-serif; overflow:hidden; }
.toast-content { padding:11px 12px 9px; }
.toast-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.toast-heading strong { color:#b7ecdd; font-size:12px; }
.toast-control { border:0; border-radius:4px; background:#24434d; color:#edf8f4; padding:3px 6px; font:11px Arial,sans-serif; cursor:pointer; }
.toast-title { font-weight:700; margin:5px 0 2px; }
.toast-detail { color:#c2d5d9; margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
.toast-actions { display:flex; gap:7px; margin-top:8px; }
.toast-progress { display:block; width:100%; height:5px; border:0; margin:0; accent-color:#32c998; }
.toast-progress::-webkit-progress-bar { background:#304e58; }
.toast-progress::-webkit-progress-value { background:#32c998; }
`;

/** Own-branded public controls. Website UI never receives API keys or starts paid work from synthetic events. */
export class FloatingTranslatorController {
  readonly host = document.createElement('div');
  private readonly shadow: ShadowRoot;
  private readonly panel: ChapterPanel;
  private readonly toolbar = document.createElement('div');
  private readonly launcher = document.createElement('button');
  private readonly count = document.createElement('span');
  private readonly quick = document.createElement('button');
  private readonly popover = document.createElement('div');
  private readonly toast = document.createElement('aside');
  private readonly toastTitle = document.createElement('p');
  private readonly toastDetail = document.createElement('p');
  private readonly toastProgress = document.createElement('progress');
  private readonly toastAction = document.createElement('button');
  private readonly abort = new AbortController();
  private view: ChapterView | undefined;
  private available = true;
  private open = false;
  private busy = false;
  private toastDismissed = false;
  private errorMessage = '';
  private drag: { pointerId: number; x: number; y: number; left: number; top: number; moved: boolean } | undefined;
  private suppressClick = false;
  private left: number | undefined;
  private top: number | undefined;

  constructor(private readonly options: ChapterPanelOptions) {
    this.host.setAttribute('data-mtp-ui', 'chapter');
    const style: Record<string, string> = {
      all: 'initial', position: 'fixed', right: '18px', top: '88px', left: 'auto', bottom: 'auto',
      display: 'none', width: 'max-content', height: 'max-content', 'z-index': '2147483647',
      'pointer-events': 'auto', contain: 'style', margin: '0', padding: '0', border: '0', opacity: '1', visibility: 'visible',
    };
    for (const [name, value] of Object.entries(style)) this.host.style.setProperty(name, value, 'important');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const css = document.createElement('style'); css.textContent = floatingCss + chapterPanelCss;
    const shell = document.createElement('div'); shell.className = 'floating-shell';
    this.toolbar.className = 'floating-toolbar'; this.toolbar.setAttribute('aria-label', 'Manga Translator Pro');
    this.launcher.className = 'launcher'; this.launcher.type = 'button'; this.launcher.textContent = '🌐 Dịch truyện';
    this.launcher.setAttribute('aria-expanded', 'false');
    this.launcher.setAttribute('aria-label', 'Dịch truyện. Có thể kéo để di chuyển.');
    this.count.className = 'image-count'; this.count.dataset['imageCount'] = ''; this.count.textContent = '0 ảnh';
    this.quick.className = 'quick-translate'; this.quick.type = 'button'; this.quick.dataset['quickTranslate'] = ''; this.quick.textContent = 'Thu thập';
    this.toolbar.append(this.launcher, this.count, this.quick);
    this.popover.className = 'chapter-popover'; this.popover.hidden = true;
    const close = document.createElement('button'); close.className = 'close-panel'; close.type = 'button'; close.textContent = 'Thu gọn ×';
    close.addEventListener('click', (event) => { if (event.isTrusted) this.setOpen(false); }, { signal: this.abort.signal });
    this.panel = new ChapterPanel({ trustedEventsOnly: true, onAction: (action) => this.options.onAction(action) });
    this.popover.append(close, this.panel.element);
    this.createToast();
    shell.append(this.popover, this.toolbar, this.toast); this.shadow.append(css, shell);
    document.documentElement.append(this.host);
    this.launcher.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      if (this.suppressClick) { this.suppressClick = false; return; }
      this.setOpen(!this.open);
      if (this.open && this.view?.session.status === 'idle' && !this.busy) this.dispatch({ command: 'collect' });
    }, { signal: this.abort.signal });
    this.quick.addEventListener('click', (event) => {
      if (!event.isTrusted || this.busy || !this.view) return;
      const command = this.view.session.status === 'paused' ? 'resume'
        : this.view.session.status === 'idle' || this.view.progress.total === 0 ? 'collect' : 'quick-translate';
      this.dispatch({ command });
    }, { signal: this.abort.signal });
    this.launcher.addEventListener('pointerdown', this.onPointerDown, { signal: this.abort.signal });
    this.launcher.addEventListener('pointermove', this.onPointerMove, { signal: this.abort.signal });
    this.launcher.addEventListener('pointerup', this.onPointerUp, { signal: this.abort.signal });
    this.launcher.addEventListener('pointercancel', this.onPointerUp, { signal: this.abort.signal });
    window.addEventListener('resize', this.onResize, { signal: this.abort.signal });
  }

  update(view: ChapterView | undefined): void {
    const previous = this.view;
    if (view && (previous?.session.id !== view.session.id || previous.session.incarnation !== view.session.incarnation
      || (view.session.status === 'running' && previous.session.status !== 'running'))) this.toastDismissed = false;
    this.view = view; this.panel.update(view);
    this.count.textContent = `${view?.progress.total ?? 0} ảnh`;
    this.quick.textContent = view?.session.status === 'running' ? 'Đang dịch…'
      : view?.session.status === 'paused' ? 'Tiếp tục'
        : !view || view.session.status === 'idle' || view.progress.total === 0 ? 'Thu thập' : 'Dịch AI';
    this.quick.disabled = this.busy || !view || view.session.status === 'running';
    this.updateToast(); this.updateVisibility();
    if (this.left !== undefined && this.top !== undefined) this.move(this.left, this.top);
    else this.positionPopover();
  }
  setMessage(message: string, error = false): void {
    this.panel.setMessage(message, error);
    this.errorMessage = error ? message : '';
    if (error && message) this.toastDismissed = false;
    this.updateToast();
  }
  setBusy(busy: boolean): void {
    this.busy = busy; this.panel.setBusy(busy);
    this.quick.disabled = busy || !this.view || this.view.session.status === 'running';
    this.toastAction.disabled = busy;
  }
  setAvailable(available: boolean): void { this.available = available; this.updateVisibility(); }
  destroy(): void { this.abort.abort(); this.panel.destroy(); this.host.remove(); }

  private createToast(): void {
    this.toast.className = 'progress-toast'; this.toast.dataset['chapterToast'] = ''; this.toast.hidden = true;
    this.toast.setAttribute('aria-label', 'Tiến trình Manga Translator Pro');
    const content = document.createElement('div'); content.className = 'toast-content';
    const heading = document.createElement('div'); heading.className = 'toast-heading';
    const brand = document.createElement('strong'); brand.textContent = 'MANGA TRANSLATOR PRO';
    const dismiss = document.createElement('button'); dismiss.className = 'toast-control'; dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', 'Ẩn thông báo tiến trình');
    dismiss.addEventListener('click', (event) => { if (event.isTrusted) { this.toastDismissed = true; this.updateToast(); } }, { signal: this.abort.signal });
    heading.append(brand, dismiss);
    this.toastTitle.className = 'toast-title'; this.toastTitle.dataset['toastTitle'] = '';
    this.toastDetail.className = 'toast-detail'; this.toastDetail.setAttribute('role', 'status');
    const actions = document.createElement('div'); actions.className = 'toast-actions';
    this.toastAction.className = 'toast-control'; this.toastAction.type = 'button'; this.toastAction.dataset['toastAction'] = '';
    this.toastAction.addEventListener('click', (event) => {
      if (!event.isTrusted || !this.view || this.busy) return;
      this.dispatch({ command: this.view.session.status === 'running' ? 'pause' : 'resume' });
    }, { signal: this.abort.signal });
    const details = document.createElement('button'); details.className = 'toast-control'; details.type = 'button'; details.textContent = 'Chi tiết';
    details.addEventListener('click', (event) => { if (event.isTrusted) this.setOpen(true); }, { signal: this.abort.signal });
    actions.append(this.toastAction, details);
    content.append(heading, this.toastTitle, this.toastDetail, actions);
    this.toastProgress.className = 'toast-progress'; this.toastProgress.max = 100; this.toastProgress.setAttribute('aria-label', 'Tiến độ xử lý chương');
    this.toast.append(content, this.toastProgress);
  }
  private updateToast(): void {
    const view = this.view;
    if (!view) { this.toast.hidden = true; return; }
    const { session, progress } = view;
    const state = session.status;
    this.toast.hidden = this.toastDismissed || (!this.errorMessage && !['running', 'paused', 'completed', 'cancelled'].includes(state));
    this.toastTitle.textContent = this.errorMessage ? 'Chưa hoàn tất thao tác'
      : state === 'running' ? `Đang dịch ${progress.settled}/${progress.total} ảnh`
        : state === 'paused' ? 'Đã tạm dừng'
          : state === 'cancelled' ? 'Đã hủy hàng đợi'
            : progress.failed || progress.cancelled ? `Đã xử lý ${progress.settled}/${progress.total} ảnh` : `Đã dịch xong ${progress.completed}/${progress.total} ảnh`;
    this.toastDetail.textContent = this.errorMessage || `Hoàn thành ${progress.completed} · Đang xử lý ${progress.active} · Lỗi ${progress.failed}${progress.cancelled ? ` · Đã hủy ${progress.cancelled}` : ''}`;
    this.toastProgress.value = Math.max(0, Math.min(100, progress.percent));
    this.toastProgress.setAttribute('aria-valuetext', `${progress.settled}/${progress.total} ảnh đã xử lý`);
    this.toastAction.textContent = state === 'running' ? 'Tạm dừng' : 'Tiếp tục';
    this.toastAction.hidden = !['running', 'paused'].includes(state);
  }
  private dispatch(action: ChapterPanelAction): void {
    try {
      const result = this.options.onAction(action);
      if (result) void result.catch((error: unknown) => this.setMessage(error instanceof Error ? error.message : 'Chưa hoàn tất thao tác.', true));
    } catch (error) { this.setMessage(error instanceof Error ? error.message : 'Chưa hoàn tất thao tác.', true); }
  }
  private setOpen(open: boolean): void {
    this.open = open; this.popover.hidden = !open; this.launcher.setAttribute('aria-expanded', String(open));
    this.positionPopover();
  }
  private updateVisibility(): void { this.host.style.setProperty('display', this.available && this.view ? 'block' : 'none', 'important'); }
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!event.isTrusted || event.button !== 0) return;
    const rect = this.host.getBoundingClientRect();
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    this.launcher.setPointerCapture(event.pointerId);
  };
  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!event.isTrusted || !this.drag || this.drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
    if (!this.drag.moved && Math.hypot(dx, dy) < 5) return;
    this.drag.moved = true; this.move(this.drag.left + dx, this.drag.top + dy);
  };
  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!event.isTrusted || !this.drag || this.drag.pointerId !== event.pointerId) return;
    this.suppressClick = this.drag.moved; this.drag = undefined;
    if (this.launcher.hasPointerCapture(event.pointerId)) this.launcher.releasePointerCapture(event.pointerId);
  };
  private readonly onResize = (): void => {
    if (this.left !== undefined && this.top !== undefined) this.move(this.left, this.top);
    else this.positionPopover();
  };
  private move(left: number, top: number): void {
    const rect = this.toolbar.getBoundingClientRect();
    this.left = Math.max(8, Math.min(left, innerWidth - rect.width - 8));
    this.top = Math.max(8, Math.min(top, innerHeight - rect.height - 8));
    this.host.style.setProperty('left', `${this.left}px`, 'important');
    this.host.style.setProperty('top', `${this.top}px`, 'important');
    this.host.style.setProperty('right', 'auto', 'important'); this.host.style.setProperty('bottom', 'auto', 'important');
    this.positionPopover();
  }
  private positionPopover(): void {
    const rect = this.host.getBoundingClientRect();
    const panelWidth = Math.min(360, innerWidth - 24);
    const left = Math.max(12 - rect.left, Math.min(0, innerWidth - 12 - rect.left - panelWidth));
    this.popover.style.left = `${left}px`; this.popover.style.right = 'auto';
    const below = rect.top < innerHeight / 2;
    this.popover.style.top = below ? `${rect.height + 9}px` : 'auto';
    this.popover.style.bottom = below ? 'auto' : `${rect.height + 9}px`;
    this.popover.style.maxHeight = `${Math.max(120, below ? innerHeight - rect.bottom - 24 : rect.top - 24)}px`;
  }
}
