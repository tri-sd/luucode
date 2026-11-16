import type { ChapterImageState, ChapterOptions, ChapterView } from '../chapter/types';

export type ChapterCommand = 'collect' | 'finish' | 'translate' | 'pause' | 'resume' | 'retry' | 'cancel' | 'clear' | 'visibility' | 'background' | 'settings' | 'options' | 'quick-translate' | 'edit';
export interface ChapterPanelAction { readonly command: ChapterCommand; readonly value?: unknown }
export interface ChapterPanelOptions {
  readonly onAction: (action: ChapterPanelAction) => void | Promise<void>;
  readonly trustedEventsOnly?: boolean;
}

export const chapterPanelCss = `
.mtp-chapter { color:#17384b; font:13px/1.5 Arial,"Segoe UI",sans-serif; }
.mtp-chapter * { box-sizing:border-box; }
.mtp-chapter [hidden] { display:none !important; }
.mtp-chapter h2 { margin:0 0 8px; font-size:16px; line-height:1.4; }
.mtp-chapter p { margin:0 0 9px; }
.mtp-chapter .chapter-hint { color:#536d7b; font-size:12px; }
.mtp-chapter .chapter-progress { display:block; width:100%; height:10px; accent-color:#17694f; margin:9px 0; }
.mtp-chapter .chapter-counts { font-size:12px; font-variant-numeric:tabular-nums; }
.mtp-chapter .chapter-actions { display:flex; gap:7px; flex-wrap:wrap; margin:10px 0; }
.mtp-chapter button,.mtp-chapter select,.mtp-chapter textarea { font:inherit; color:#17384b; border:1px solid #b5cbd6; border-radius:6px; background:white; }
.mtp-chapter button { cursor:pointer; padding:8px 10px; line-height:1.35; }
.mtp-chapter button.primary { background:#17694f; border-color:#17694f; color:white; font-weight:700; }
.mtp-chapter button.danger { color:#a12a35; }
.mtp-chapter button:disabled { opacity:.48; cursor:default; }
.mtp-chapter button:focus-visible,.mtp-chapter input:focus-visible,.mtp-chapter select:focus-visible,.mtp-chapter textarea:focus-visible { outline:3px solid #dca841; outline-offset:2px; }
.mtp-chapter .chapter-tools { display:flex; flex-wrap:wrap; gap:7px; align-items:center; margin:10px 0; }
.mtp-chapter .chapter-tools button { padding:6px 8px; font-size:12px; }
.mtp-chapter select { padding:6px; max-width:100%; }
.mtp-chapter details { margin:9px 0; border-top:1px solid #d7e2e8; padding-top:4px; }
.mtp-chapter summary { cursor:pointer; font-size:12px; font-weight:700; padding:7px 0; }
.mtp-chapter .chapter-images { max-height:170px; overflow:auto; list-style:none; margin:0; padding:0; }
.mtp-chapter .chapter-images li { border-bottom:1px solid #e0e8ed; padding:6px 0; font-size:11px; overflow-wrap:anywhere; }
.mtp-chapter .chapter-options { display:grid; gap:7px; }
.mtp-chapter .chapter-options label { display:grid; gap:4px; font-size:12px; }
.mtp-chapter textarea { width:100%; min-height:78px; padding:7px; resize:vertical; }
.mtp-chapter .chapter-message { margin-top:10px; color:#416275; font-size:12px; white-space:pre-wrap; overflow-wrap:anywhere; }
.mtp-chapter .chapter-message[data-error=true] { color:#a12a35; }
`;

const stateLabels: Record<ChapterImageState, string> = {
  DISCOVERED: 'Đã phát hiện', QUEUED: 'Đang chờ', FETCHING: 'Đang tải ảnh', OCR_PROCESSING: 'Đang nhận diện chữ',
  TRANSLATING: 'Đang dịch', RENDER_READY: 'Bản dịch sẵn sàng', COMPLETED: 'Hoàn thành', FAILED: 'Thất bại', CANCELLED: 'Đã hủy',
};

export class ChapterPanel {
  readonly element = document.createElement('section');
  private readonly heading = document.createElement('h2');
  private readonly hint = document.createElement('p');
  private readonly progress = document.createElement('progress');
  private readonly counts = document.createElement('p');
  private readonly actions = document.createElement('div');
  private readonly tools = document.createElement('div');
  private readonly message = document.createElement('p');
  private readonly imageList = document.createElement('ol');
  private readonly imagesSummary = document.createElement('summary');
  private readonly background = document.createElement('select');
  private readonly concurrency = document.createElement('select');
  private readonly attempts = document.createElement('select');
  private readonly quality = document.createElement('select');
  private readonly glossary = document.createElement('textarea');
  private readonly buttons = new Map<ChapterCommand, HTMLButtonElement>();
  private readonly imageRows = new Map<string, HTMLLIElement>();
  private view: ChapterView | undefined;
  private busy = false;
  private optionsKey = '';
  private imageOrderKey = '';

  constructor(private readonly options: ChapterPanelOptions) {
    this.element.className = 'mtp-chapter';
    this.element.setAttribute('aria-label', 'Dịch toàn bộ chương');
    this.heading.dataset['chapterHeading'] = '';
    this.hint.className = 'chapter-hint';
    this.progress.className = 'chapter-progress';
    this.progress.max = 100;
    this.progress.setAttribute('aria-label', 'Tiến độ dịch chương');
    this.counts.className = 'chapter-counts';
    this.counts.dataset['chapterCounts'] = '';
    this.counts.setAttribute('aria-live', 'polite');
    this.actions.className = 'chapter-actions';
    this.tools.className = 'chapter-tools';
    this.message.className = 'chapter-message';
    this.message.setAttribute('role', 'status');
    this.element.append(this.heading, this.hint, this.progress, this.counts, this.actions, this.tools);
    for (const [command, label, primary] of [
      ['collect', 'Bắt đầu thu thập', false], ['finish', 'Kết thúc thu thập', true], ['translate', 'Dịch toàn bộ', true],
      ['pause', 'Tạm dừng', false], ['resume', 'Tiếp tục', true], ['retry', 'Thử lại ảnh lỗi', false], ['cancel', 'Hủy', false],
    ] as const) this.addButton(command, label, primary, this.actions);
    this.addButton('visibility', 'Ẩn bản dịch', false, this.tools);
    this.background.setAttribute('aria-label', 'Nền bản dịch');
    this.background.append(new Option('Nền tối · chữ trắng', 'dark'), new Option('Nền sáng nhanh', 'mask'), new Option('Theo nền thoại', 'adaptive'), new Option('Giữ nền thoại gốc', 'original'));
    const unavailable = new Option('Phục hồi nền: chưa có engine', 'restoration'); unavailable.disabled = true; this.background.append(unavailable);
    this.background.addEventListener('change', (event) => {
      if (this.options.trustedEventsOnly && !event.isTrusted) { this.background.value = this.view?.session.options.overlayBackground ?? 'mask'; return; }
      this.dispatch({ command: 'background', value: this.background.value });
    });
    this.tools.append(this.background);
    this.addButton('edit', 'Sửa chữ/vùng', false, this.tools);
    this.addButton('settings', 'Cài đặt Gemini', false, this.tools);
    this.addButton('clear', 'Xóa cache chương', false, this.tools).classList.add('danger');
    const imageDetails = document.createElement('details');
    this.imagesSummary.textContent = 'Danh sách ảnh';
    this.imageList.className = 'chapter-images';
    imageDetails.append(this.imagesSummary, this.imageList);
    const optionDetails = document.createElement('details');
    const optionSummary = document.createElement('summary'); optionSummary.textContent = 'Tùy chọn dịch chương';
    const optionFields = document.createElement('div'); optionFields.className = 'chapter-options';
    this.concurrency.append(new Option('1 ảnh mỗi lần', '1'), new Option('Tối đa 2 ảnh cùng lúc', '2'));
    this.attempts.append(new Option('Không tự thử lại', '1'), new Option('Tối đa 2 lần', '2'), new Option('Tối đa 3 lần', '3'));
    this.quality.setAttribute('aria-label', 'Chế độ nhận diện chữ');
    this.quality.append(new Option('Tiêu chuẩn', 'standard'), new Option('Rà soát chữ · thêm request', 'review'));
    this.glossary.maxLength = 4000;
    this.glossary.placeholder = 'Ví dụ: Toxin = Độc; dùng anh/em cho cặp nhân vật chính.';
    for (const [label, input] of [['Chế độ nhận diện chữ', this.quality], ['Số ảnh xử lý đồng thời', this.concurrency], ['Giới hạn số lần xử lý mỗi ảnh', this.attempts], ['Tên nhân vật và cách xưng hô', this.glossary]] as const) {
      const field = document.createElement('label'); field.append(document.createTextNode(label), input); optionFields.append(field);
    }
    const note = document.createElement('p'); note.className = 'chapter-hint';
    note.textContent = 'Rà soát chữ và xử lý lại vùng khó có thể thêm request Gemini. Phủ nền nhanh không phải inpainting. Đổi model, ngôn ngữ hoặc bảng tên sẽ dùng bộ kết quả riêng.';
    const save = this.addButton('options', 'Lưu tùy chọn chương', false, optionFields);
    save.dataset['saveChapterOptions'] = '';
    optionFields.append(note);
    optionDetails.append(optionSummary, optionFields);
    this.element.append(imageDetails, optionDetails, this.message);
    this.update(undefined);
  }

  update(view: ChapterView | undefined): void {
    this.view = view;
    if (!view) {
      this.heading.textContent = 'Dịch toàn bộ chương';
      this.hint.textContent = 'Mở trang truyện rồi bắt đầu thu thập ảnh. Chưa gửi ảnh tới Gemini.';
      this.counts.textContent = '';
      this.progress.value = 0;
      for (const button of this.buttons.values()) button.disabled = true;
      this.background.disabled = true;
      return;
    }
    const { session, progress } = view;
    const collecting = session.status === 'collecting';
    const running = session.status === 'running';
    const ready = session.status === 'ready';
    const ended = session.status === 'completed';
    this.heading.textContent = collecting ? `📖 Đang thu thập ảnh: ${progress.total} ảnh`
      : running ? `Đang dịch: ${progress.settled}/${progress.total} ảnh`
        : ended ? progress.failed || progress.cancelled ? `Đã xử lý ${progress.settled}/${progress.total} ảnh` : `Đã dịch xong ${progress.completed}/${progress.total} ảnh`
          : session.status === 'paused' ? 'Đã tạm dừng dịch chương'
            : ready ? `Đã phát hiện ${progress.total} ảnh. Bắt đầu dịch toàn bộ chương?`
              : session.status === 'cancelled' ? 'Đã hủy hàng đợi dịch' : 'Dịch toàn bộ chương';
    this.hint.textContent = collecting
      ? session.endObserved ? 'Đã tới cuối vùng cuộn. Chưa thể xác nhận đã đủ ảnh; bạn có thể kết thúc thu thập thủ công.' : 'Cuộn đến cuối chương để thu thập tất cả ảnh truyện. Với reader từng trang, chuyển lần lượt qua các trang.'
      : ready ? 'Chỉ dịch những ảnh đã thu thập. Bạn có thể tiếp tục thu thập trước khi bắt đầu.'
        : running ? 'Kết quả từng ảnh xuất hiện ngay khi hoàn thành. Bạn có thể đóng bảng này và tiếp tục đọc.'
          : session.collectionNote || 'Thu thập không gọi Gemini. Bản dịch hợp lệ được lưu để khôi phục khi quay lại chương.';
    this.counts.textContent = `Đã phát hiện ${progress.total} ảnh · Hoàn thành: ${progress.completed} · Đang xử lý: ${progress.active} · Thất bại: ${progress.failed}`;
    this.progress.value = Math.max(0, Math.min(100, progress.percent));
    this.progress.setAttribute('aria-valuetext', `${progress.settled}/${progress.total} ảnh đã xử lý`);
    this.button('collect').textContent = progress.total > 0 ? 'Tiếp tục thu thập' : 'Bắt đầu thu thập';
    this.button('collect').hidden = collecting || running;
    this.button('finish').hidden = !collecting;
    this.button('translate').textContent = ended ? 'Dịch với cấu hình hiện tại' : 'Dịch toàn bộ';
    this.button('translate').hidden = collecting || running || session.status === 'paused';
    this.button('translate').disabled = this.busy || progress.total === 0;
    this.button('pause').hidden = !running;
    this.button('resume').hidden = session.status !== 'paused';
    this.button('retry').hidden = progress.failed === 0 || collecting || running;
    this.button('cancel').hidden = session.status === 'idle' || ended || session.status === 'cancelled';
    this.button('visibility').textContent = session.options.overlayVisible ? 'Ẩn bản dịch' : 'Hiện bản dịch';
    this.button('visibility').setAttribute('aria-pressed', String(session.options.overlayVisible));
    this.background.value = session.options.overlayBackground;
    this.imagesSummary.textContent = `Danh sách ảnh (${view.images.length})`;
    this.updateImages(view);
    const nextOptions = JSON.stringify(session.options);
    const active = this.element.getRootNode() instanceof ShadowRoot ? (this.element.getRootNode() as ShadowRoot).activeElement : document.activeElement;
    if (nextOptions !== this.optionsKey && ![this.concurrency, this.attempts, this.glossary, this.quality].some((input) => input === active)) {
      this.quality.value = session.options.qualityMode ?? 'standard';
      this.concurrency.value = String(session.options.concurrency);
      this.attempts.value = String(session.options.maxAttempts);
      this.glossary.value = session.options.glossary;
      this.optionsKey = nextOptions;
    }
    this.updateBusy();
  }

  setBusy(busy: boolean): void { this.busy = busy; this.updateBusy(); }
  setMessage(message: string, error = false): void { this.message.textContent = message; this.message.dataset['error'] = String(error); }
  destroy(): void { this.imageRows.clear(); this.element.remove(); }

  private updateBusy(): void {
    if (!this.view) return;
    for (const [command, button] of this.buttons) button.disabled = this.busy
      || (command === 'translate' && this.view.progress.total === 0)
      || (command === 'options' && this.view.session.status === 'running')
      || (command === 'edit' && (this.view.progress.completed === 0 || this.view.session.status === 'running'));
    this.background.disabled = this.busy;
    for (const input of [this.concurrency, this.attempts, this.glossary, this.quality]) input.disabled = this.busy || this.view.session.status === 'running';
  }

  private updateImages(view: ChapterView): void {
    const ids = new Set(view.images.map((image) => image.id));
    for (const [id, row] of this.imageRows) if (!ids.has(id)) { row.remove(); this.imageRows.delete(id); }
    const orderKey = view.images.map((image) => image.id).join('|');
    const orderChanged = orderKey !== this.imageOrderKey;
    for (const image of view.images) {
      let row = this.imageRows.get(image.id);
      if (!row) { row = document.createElement('li'); this.imageRows.set(image.id, row); }
      const text = `${image.order}. ${stateLabels[image.state]} · ${image.naturalWidth}×${image.naturalHeight} · ${image.method}${image.access === 'live-only' ? ' · chỉ truy cập khi đang xem' : ''}${image.errorMessage ? ` — ${image.errorMessage}` : ''}`;
      if (row.textContent !== text) row.textContent = text;
      if (orderChanged) this.imageList.append(row);
    }
    this.imageOrderKey = orderKey;
  }

  private button(command: ChapterCommand): HTMLButtonElement { return this.buttons.get(command)!; }
  private addButton(command: ChapterCommand, label: string, primary: boolean, parent: HTMLElement): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.dataset['chapterCommand'] = command;
    if (primary) button.className = 'primary';
    button.addEventListener('click', (event) => {
      if (this.options.trustedEventsOnly && !event.isTrusted) return;
      let value: unknown;
      if (command === 'visibility') value = !this.view?.session.options.overlayVisible;
      if (command === 'options') value = { ...this.view?.session.options, concurrency: this.concurrency.value === '1' ? 1 : 2, maxAttempts: this.attempts.value === '1' ? 1 : this.attempts.value === '2' ? 2 : 3, glossary: this.glossary.value, qualityMode: this.quality.value === 'review' ? 'review' : 'standard' } satisfies Partial<ChapterOptions>;
      this.dispatch(value === undefined ? { command } : { command, value });
    });
    this.buttons.set(command, button); parent.append(button); return button;
  }
  private dispatch(action: ChapterPanelAction): void {
    if (this.busy || !this.view) return;
    // Invoke synchronously so extension permission requests retain the user's click gesture.
    try {
      const result = this.options.onAction(action);
      if (result) void result.catch((error: unknown) => this.setMessage(error instanceof Error ? error.message : 'Chưa hoàn tất thao tác.', true));
    } catch (error) { this.setMessage(error instanceof Error ? error.message : 'Chưa hoàn tất thao tác.', true); }
  }
}
