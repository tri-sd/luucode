import type { ApiAction, Reply, Status, Command, Summary } from './types';

export class RequestError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}
async function unwrap<T>(promise: Promise<Reply<T>>): Promise<T> {
  const answer = await promise;
  if (!answer?.ok) throw new RequestError(answer?.error ?? 'Extension không phản hồi.', answer?.status);
  return answer.value;
}
export function api<T>(action: ApiAction, key?: string, payload?: unknown): Promise<T> {
  return unwrap(chrome.runtime.sendMessage({ type: 'api', action, key, payload }));
}
export function command(tabId: number, action: Command, value?: unknown): Promise<Status> {
  return unwrap(chrome.tabs.sendMessage(tabId, { type: 'command', action, value }));
}
export function fetchImage(url: string): Promise<string> {
  return unwrap(chrome.runtime.sendMessage({ type: 'image', url }));
}
export async function job(action: 'submit' | 'edit', payload: unknown, signal: AbortSignal,
                          progress: (phase: string) => void, key?: string): Promise<Summary> {
  let id: string | undefined;
  const abort = () => { if (id) void api('cancel', id).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    ({ id } = await api<{ id: string }>(action, key, payload));
    signal.throwIfAborted();
    for (;;) {
      const status = await api<{state: string; phase: string; result: {key: string} | null; error: string | null}>('job', id);
      signal.throwIfAborted();
      progress(status.phase);
      if (status.state === 'done' && status.result) {
        const result = await api<Summary>('result', status.result.key);
        signal.throwIfAborted();
        return result;
      }
      if (status.state === 'error' || status.state === 'cancelled') throw new RequestError(status.error ?? 'Tác vụ thất bại.');
      await new Promise<void>(resolve => setTimeout(resolve, 650));
      signal.throwIfAborted();
    }
  } catch (error) {
    abort();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
