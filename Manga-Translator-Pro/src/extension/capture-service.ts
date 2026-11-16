import { validateCaptureGeometry, type CapturedImage } from '../translation/capture';
import { TranslationError } from '../translation/errors';
import { objectValue } from '../translation/schema';
import type { ImageSelection } from '../translation/types';
import { validateSelection } from './security';

interface CaptureTabs {
  get(tabId: number): Promise<{ active: boolean; windowId: number }>;
  query(query: { active: boolean; windowId: number }): Promise<{ id?: number | undefined }[]>;
  sendMessage(tabId: number, message: unknown, options: { frameId: number }): Promise<unknown>;
  captureVisibleTab(windowId: number, options: { format: 'png' }): Promise<string>;
}

/** Called only by the trusted Translate handler, never inspect/debug/timers. */
export async function captureVisibleImage(tabs: CaptureTabs, tabId: number, expected: ImageSelection): Promise<{ selection: ImageSelection; capture: CapturedImage }> {
  const tab = await tabs.get(tabId);
  const assertActive = async (): Promise<void> => {
    const [current] = await tabs.query({ active: true, windowId: tab.windowId });
    if (!tab.active || current?.id !== tabId) throw new TranslationError('STALE_IMAGE');
  };
  await assertActive();
  let ticket: string | undefined;
  let finished = false;
  try {
    const reply = objectValue(await tabs.sendMessage(tabId, { type: 'mtp:capture-prepare', selection: expected }, { frameId: 0 }));
    if (reply?.['ok'] !== true) throw new TranslationError('STALE_IMAGE');
    const selection = validateSelection(reply['selection']);
    ticket = selection.captureTicket;
    if (!ticket || selection.documentToken !== expected.documentToken || selection.instanceId !== expected.instanceId
      || selection.sourceKey !== expected.sourceKey || selection.generation !== expected.generation) throw new TranslationError('STALE_IMAGE');
    const geometry = validateCaptureGeometry(reply['geometry']);
    await assertActive();
    let dataUrl: string;
    try { dataUrl = await tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
    catch { throw new TranslationError('CAPTURE_FAILED'); }
    if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 32 * 1024 * 1024) throw new TranslationError('IMAGE_TOO_LARGE');
    await assertActive();
    const finish = objectValue(await tabs.sendMessage(tabId, { type: 'mtp:capture-finish', ticket }, { frameId: 0 }));
    if (finish?.['ok'] !== true) throw new TranslationError('STALE_IMAGE');
    finished = true;
    return { selection, capture: { dataUrl, geometry } };
  } finally {
    if (!finished) await tabs.sendMessage(tabId, { type: 'mtp:capture-cancel', ticket }, { frameId: 0 }).catch(() => undefined);
  }
}
