import { browser } from 'wxt/browser';
import { imageOrigin } from '../../translation/image-pipeline';
import { isRunning } from '../../extension/jobs';
import { TranslationError } from '../../translation/errors';
import type { DetectionReport } from '../../core/types';
import type { ImageSelection, PublicJob, PublicSettings } from '../../translation/types';
import { ChapterPanel, chapterPanelCss, type ChapterPanelAction } from '../../ui/chapter-panel';
import type { ChapterView } from '../../chapter/types';
import { rpc, showError } from '../../ui/rpc';
import './style.css';

const translate = document.querySelector<HTMLButtonElement>('#translate')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
const status = document.querySelector<HTMLElement>('#translation-status')!;
const imageSummary = document.querySelector<HTMLElement>('#image-summary')!;
const captureOption = document.querySelector<HTMLInputElement>('#use-capture')!;
let current: { tabId: number; selection: ImageSelection | null; job: PublicJob | null } | undefined;
let settings: PublicSettings | undefined;
let submitting = false;
let fingerprint = '';

function renderJob(job: PublicJob | null): void {
  const running = job ? isRunning(job) : false;
  translate.disabled = submitting || running || !current?.selection || !settings?.hasKey || !settings.model;
  cancel.disabled = !running;
  if (!job) return;
  const next = `${job.id}:${job.phase}:${job.tile}:${job.message}`;
  if (fingerprint === next) return;
  fingerprint = next;
  status.textContent = job.message;
  status.dataset['state'] = job.phase === 'error' ? 'error' : 'ready';
  const result = document.querySelector<HTMLElement>('#result')!;
  result.hidden = job.phase !== 'done' || !job.output;
  if (!job.output) return;
  document.querySelector('#result-count')!.textContent = `${job.output.regions.length} vùng chữ · ${job.output.sourceLanguage} → vi`;
  document.querySelector('#json-output')!.textContent = JSON.stringify(job.output, null, 2);
  const transcript = document.querySelector('#transcript')!;
  transcript.replaceChildren();
  for (const region of job.output.regions) {
    const article = document.createElement('article');
    const source = document.createElement('p'); source.className = 'source'; source.textContent = region.sourceText;
    const translated = document.createElement('p'); translated.textContent = region.text;
    article.append(source, translated); transcript.append(article);
  }
}

async function inspect(): Promise<void> {
  try {
    current = await rpc({ type: 'ui:inspect' });
    if (!current) return;
    imageSummary.textContent = current.selection
      ? `${current.selection.naturalWidth} × ${current.selection.naturalHeight} · ${current.selection.method ?? 'img'} · ${new URL(current.selection.source).hostname || 'ảnh nội bộ'}`
      : new TranslationError('NO_IMAGE').message;
    const forced = current.selection?.requiresCapture === true || Boolean(current.selection && !/^https?:/.test(current.selection.source));
    captureOption.disabled = forced;
    if (forced) captureOption.checked = true;
    renderJob(current.job);
  } catch (error) { showError(imageSummary, error); translate.disabled = true; }
}

translate.addEventListener('click', () => {
  if (!current?.selection || !settings?.hasKey || !settings.model || submitting) return;
  const selected = current;
  const capture = captureOption.checked;
  let permission: Promise<boolean>;
  try {
    // The first asynchronous operation stays within the explicit user gesture.
    permission = capture ? Promise.resolve(true) : browser.permissions.request({ origins: [imageOrigin(selected.selection!.source)] });
  }
  catch (error) { showError(status, error); return; }
  submitting = true; translate.disabled = true;
  // Must be the first async operation in this user gesture; never ask from a background timer.
  void permission
    .then(async (granted) => {
      if (!granted) throw new TranslationError('IMAGE_ACCESS');
      const job = await rpc<PublicJob>({ type: 'ui:translate', tabId: selected.tabId, selection: selected.selection, capture });
      selected.job = job; renderJob(job);
    }).catch((error: unknown) => showError(status, error))
    .finally(() => { submitting = false; renderJob(current?.job ?? null); });
});
cancel.addEventListener('click', () => {
  if (current) void rpc({ type: 'ui:cancel', tabId: current.tabId }).then(() => inspect()).catch((error: unknown) => showError(status, error));
});
document.querySelector('#refresh')!.addEventListener('click', () => { void inspect(); });
async function debugDetection(): Promise<void> {
  const summary = document.querySelector<HTMLElement>('#debug-summary')!;
  try {
    const report = await rpc<DetectionReport>({ type: 'ui:debug' });
    summary.textContent = `DOM img: ${report.domImages} · canvas: ${report.canvases} · background: ${report.backgrounds} · hợp lệ: ${report.valid} · đang thấy: ${report.visible}`;
    const entries = document.querySelector('#debug-entries')!;
    entries.replaceChildren();
    for (const entry of report.entries) {
      const row = document.createElement('p');
      row.textContent = `${entry.element} [${entry.method}] — gốc ${entry.naturalWidth}×${entry.naturalHeight}; hiển thị ${entry.renderedWidth.toFixed(1)}×${entry.renderedHeight.toFixed(1)} CSS px. ${entry.reason} ${entry.source}`;
      entries.append(row);
    }
  } catch (error) { showError(summary, error); }
}
document.querySelector('#debug-refresh')!.addEventListener('click', () => { void debugDetection(); });
document.querySelector('#debug')!.addEventListener('toggle', () => {
  if (document.querySelector<HTMLDetailsElement>('#debug')!.open) void debugDetection();
});
document.querySelector('#configure')!.addEventListener('click', () => { void browser.runtime.openOptionsPage(); });
document.querySelector('#clear-overlay')!.addEventListener('click', () => {
  if (current) void rpc({ type: 'ui:clear-overlay', tabId: current.tabId }).catch((error: unknown) => showError(status, error));
});

void rpc<PublicSettings>({ type: 'ui:settings' }).then((value) => {
  settings = value;
  document.querySelector('#config-summary')!.textContent = value.hasKey && value.model
    ? `${value.model} · nguồn ${value.sourceLanguage} → vi` : 'Chưa cấu hình key/model. Mở Cấu hình Gemini để bắt đầu.';
  renderJob(current?.job ?? null);
}).catch((error: unknown) => showError(status, error));
void inspect();
let polling = false;
const interval = window.setInterval(() => {
  if (!current || polling || submitting) return;
  polling = true;
  void rpc<PublicJob | null>({ type: 'ui:job', tabId: current.tabId }).then((job) => {
    if (current) current.job = job; renderJob(job);
  }).catch((error: unknown) => showError(status, error)).finally(() => { polling = false; });
}, 750);
window.addEventListener('pagehide', () => window.clearInterval(interval), { once: true });


interface ChapterInspection {
  readonly tabId: number;
  readonly url: string;
  readonly documentToken: string;
  readonly view: ChapterView;
  readonly origins: readonly string[];
}
const chapterStyle = document.createElement('style'); chapterStyle.textContent = chapterPanelCss; document.head.append(chapterStyle);
let chapter: ChapterInspection | undefined;
let chapterBusy = false;
let chapterPolling = false;
let pageOrigin: string | undefined;
const chapterAccess = document.querySelector<HTMLElement>('#chapter-access')!;
const enableSite = document.querySelector<HTMLButtonElement>('#enable-site')!;
const chapterPanel = new ChapterPanel({ onAction: chapterAction });
document.querySelector('#chapter-panel')!.append(chapterPanel.element);

function originPattern(url: string): string | undefined {
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? `${parsed.origin}/*` : undefined; }
  catch { return undefined; }
}

async function inspectChapter(): Promise<void> {
  if (chapterPolling) return;
  chapterPolling = true;
  try {
    const result = await rpc<ChapterInspection>({ type: 'ui:chapter-inspect' });
    if (!result?.view) return;
    chapter = result;
    pageOrigin = originPattern(result.url);
    chapterPanel.update(result.view);
    chapterAccess.textContent = 'Thu thập ảnh rồi bấm Dịch AI trên trang hoặc Dịch toàn bộ tại đây. Có thể đóng popup khi hàng đợi chạy.';
    enableSite.disabled = !pageOrigin;
  } catch (error) {
    if (!chapter) chapterPanel.setMessage(error instanceof Error ? error.message : 'Chưa tìm thấy chương truyện.', true);
  } finally { chapterPolling = false; }
}

function chapterAction(action: ChapterPanelAction): Promise<void> | void {
  if (!chapter || chapterBusy) return;
  const selected = chapter;
  let permission: Promise<boolean>;
  try {
    permission = ['translate', 'quick-translate', 'resume', 'retry'].includes(action.command) && selected.origins.length > 0
      ? browser.permissions.request({ origins: [...selected.origins] }) : Promise.resolve(true);
  } catch (error) { chapterPanel.setMessage(error instanceof Error ? error.message : 'Không xin được quyền miền ảnh.', true); return; }
  chapterBusy = true; chapterPanel.setBusy(true); chapterPanel.setMessage('');
  return permission.then(async (granted) => {
    if (!granted) throw new TranslationError('IMAGE_ACCESS');
    const view = await rpc<ChapterView>({ type: 'ui:chapter-command', tabId: selected.tabId, command: action.command,
      ...(action.value === undefined ? {} : { value: action.value }) });
    chapter = { ...selected, view };
    chapterPanel.update(view);
    // Newly collected images can belong to another CDN; refresh permissions metadata before a future click.
    await inspectChapter();
  }).catch((error: unknown) => chapterPanel.setMessage(error instanceof Error ? error.message : 'Chưa hoàn tất thao tác chương.', true))
    .finally(() => { chapterBusy = false; chapterPanel.setBusy(false); });
}

enableSite.addEventListener('click', () => {
  const origin = pageOrigin;
  if (!origin || chapterBusy) { chapterAccess.textContent = 'Mở website truyện HTTP/HTTPS rồi mở lại popup để cấp quyền.'; return; }
  // Request directly from this click; do not await tab queries or RPC first.
  const permission = browser.permissions.request({ origins: [origin] });
  enableSite.disabled = true;
  void permission.then(async (granted) => {
    if (!granted) throw new Error('Chưa cấp quyền chạy trên website này.');
    await rpc({ type: 'ui:enable-site', ...(chapter ? { tabId: chapter.tabId } : {}), origin });
    chapterAccess.textContent = 'Đã bật tự nhận diện và nút nổi cho website này. Tải lại trang nếu cần.';
    await inspectChapter();
  }).catch((error: unknown) => showError(chapterAccess, error)).finally(() => { enableSite.disabled = false; });
});
document.querySelector('#chapter-refresh')!.addEventListener('click', () => { void inspectChapter(); });
// activeTab exposes the current URL when the user opens the action. This never grants host access.
if (typeof browser.tabs?.query === 'function') void browser.tabs.query({ active: true, currentWindow: true })
  .then(([tab]) => { if (!pageOrigin && tab?.url) pageOrigin = originPattern(tab.url); })
  .catch(() => undefined);
void inspectChapter();
const chapterInterval = window.setInterval(() => {
  if (!chapter || chapterBusy || document.hidden) return;
  void inspectChapter();
}, 1200);
window.addEventListener('pagehide', () => { clearInterval(chapterInterval); chapterPanel.destroy(); }, { once: true });
