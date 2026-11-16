import { browser } from 'wxt/browser';
import { objectValue } from '../translation/schema';

export function hasExtensionRuntime(): boolean {
  return Boolean(browser?.runtime?.id);
}

export async function rpc<T>(request: Record<string, unknown>): Promise<T> {
  if (!hasExtensionRuntime()) throw new Error('Hãy mở trang này từ Tùy chọn của extension đã cài.');
  const reply = objectValue(await browser.runtime.sendMessage(request));
  if (reply?.['ok'] !== true) {
    const error = objectValue(reply?.['error']);
    throw new Error(typeof error?.['message'] === 'string' ? error['message'] : 'Không liên lạc được với extension.');
  }
  return reply['data'] as T;
}

export function showError(element: HTMLElement, error: unknown): void {
  element.textContent = error instanceof Error ? error.message : 'Tác vụ không hoàn tất.';
  element.dataset['state'] = 'error';
}
