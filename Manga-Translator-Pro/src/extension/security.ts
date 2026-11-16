import { TranslationError } from '../translation/errors';
import type { ImageSelection } from '../translation/types';
import { objectValue } from '../translation/schema';

export function isTrustedUi(sender: { id?: string | undefined; url?: string | undefined }, runtimeId: string): boolean {
  if (sender.id !== runtimeId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.hostname === runtimeId
      && ['/options.html', '/popup.html'].includes(url.pathname);
  } catch { return false; }
}

export function isOffscreenSender(sender: { id?: string | undefined; url?: string | undefined }, runtimeId: string): boolean {
  return sender.id === runtimeId && sender.url === `chrome-extension://${runtimeId}/offscreen.html`;
}

export function isBackgroundSender(sender: { id?: string | undefined; url?: string | undefined; tab?: unknown }, runtimeId: string): boolean {
  return sender.id === runtimeId && !sender.tab
    && (sender.url === undefined || sender.url === `chrome-extension://${runtimeId}/background.js`);
}

export function validateSelection(input: unknown): ImageSelection {
  const value = objectValue(input);
  if (!value || typeof value['instanceId'] !== 'string' || !/^image-\d+$/.test(value['instanceId'])
    || typeof value['documentToken'] !== 'string' || value['documentToken'].length < 16 || value['documentToken'].length > 100
    || typeof value['generation'] !== 'number' || !Number.isInteger(value['generation']) || value['generation'] < 1
    || typeof value['sourceKey'] !== 'string' || value['sourceKey'].length > 30_000
    || typeof value['source'] !== 'string' || value['source'].length > 16_000
    || (value['captureTicket'] !== undefined && (typeof value['captureTicket'] !== 'string' || !/^[a-f0-9]{32}$/.test(value['captureTicket'])))
    || typeof value['naturalWidth'] !== 'number' || typeof value['naturalHeight'] !== 'number'
    || ![value['naturalWidth'], value['naturalHeight']].every((n) => Number.isFinite(n) && n > 0)) throw new TranslationError('NO_IMAGE');
  return {
    ...(typeof value['captureTicket'] === 'string' && /^[a-f0-9]{32}$/.test(value['captureTicket']) ? { captureTicket: value['captureTicket'] } : {}),
    ...(value['method'] === 'canvas' || value['method'] === 'background' || value['method'] === 'picture' || value['method'] === 'img' ? { method: value['method'] } : {}),
    requiresCapture: value['requiresCapture'] === true || value['method'] === 'canvas' || !/^https?:/.test(value['source']),
    instanceId: value['instanceId'], generation: value['generation'], sourceKey: value['sourceKey'], documentToken: value['documentToken'],
    source: value['source'], naturalWidth: value['naturalWidth'], naturalHeight: value['naturalHeight'],
  };
}
