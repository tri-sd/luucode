import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ChapterBackground } from '../extension/chapter-background';
import { captureVisibleImage } from '../extension/capture-service';
import { CredentialStore } from '../extension/credentials';
import { isRunning, JobStore } from '../extension/jobs';
import { ensureOffscreen } from '../extension/offscreen-runner';
import { isOffscreenSender, isTrustedUi, validateSelection } from '../extension/security';
import { publicError, TranslationError } from '../translation/errors';
import { GeminiClient } from '../translation/gemini-client';
import { imageOrigin } from '../translation/image-pipeline';
import { objectValue } from '../translation/schema';
import { validateApiKey } from '../translation/settings';
import type { ImageSelection, PrivateJob, PublicJob, TranslationOutput } from '../translation/types';

export default defineBackground(() => {
  const credentials = new CredentialStore(browser.storage.local, browser.storage.session);
  const jobs = new JobStore(browser.storage.session);
  const chapters = new ChapterBackground({ credentials, activeTab, ensureTab: selection });
  let launching = false;
  let progressQueue: Promise<unknown> = Promise.resolve();
  void credentials.protect().then(() => chapters.syncReaderScripts()).catch(() => undefined);
  browser.permissions.onAdded.addListener(() => { void chapters.syncReaderScripts().catch(() => undefined); });
  browser.permissions.onRemoved.addListener(() => { void chapters.syncReaderScripts().catch(() => undefined); });

  async function badge(tabId: number, text: string, title: string, color = '#17674b'): Promise<void> {
    await Promise.allSettled([
      browser.action.setBadgeText({ tabId, text }), browser.action.setTitle({ tabId, title }),
      browser.action.setBadgeBackgroundColor({ tabId, color }),
    ]);
  }

  async function activeTab(): Promise<number> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !/^https?:\/\//.test(tab.url ?? '')) throw new TranslationError('NO_IMAGE');
    return tab.id;
  }

  async function selection(tabId: number): Promise<ImageSelection | null> {
    await credentials.protect();
    const message = { type: 'mtp:selection' };
    let response: unknown;
    try { response = await browser.tabs.sendMessage(tabId, message, { frameId: 0 }); }
    catch {
      try {
        await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/tracking.js'] });
        response = await browser.tabs.sendMessage(tabId, message, { frameId: 0 });
      } catch { throw new TranslationError('NO_IMAGE'); }
    }
    const result = objectValue(response);
    return result?.['selection'] ? validateSelection(result['selection']) : null;
  }

  async function start(tabId: number, expected: unknown, useCapture: boolean): Promise<PublicJob> {
    if (launching) throw new TranslationError('BUSY');
    launching = true;
    try {
      for (const old of (await jobs.all()).filter(isRunning)) {
        if (Date.now() - old.createdAt < 5 * 60_000 + 10_000) throw new TranslationError('BUSY');
        await jobs.update({ ...old, phase: 'error', errorCode: 'TIMEOUT', message: new TranslationError('TIMEOUT').message });
      }
      const config = await credentials.privateConfig();
      if (!config.apiKey || !config.settings.model) throw new TranslationError('CONFIG');
      let current = await selection(tabId);
      if (!current) throw new TranslationError('NO_IMAGE');
      const previous = validateSelection(expected);
      if (current.instanceId !== previous.instanceId || current.generation !== previous.generation
        || current.sourceKey !== previous.sourceKey || current.documentToken !== previous.documentToken) throw new TranslationError('STALE_IMAGE');
      const needsCapture = useCapture || current.requiresCapture === true;
      if (!needsCapture && !await browser.permissions.contains({ origins: [imageOrigin(current.source)] })) throw new TranslationError('IMAGE_ACCESS');
      await ensureOffscreen();
      const captured = needsCapture ? await captureVisibleImage(browser.tabs, tabId, current) : undefined;
      if (captured) current = captured.selection;
      const job: PublicJob = {
        id: crypto.randomUUID(), tabId, phase: 'preparing', tile: 0, tiles: 0,
        message: needsCapture ? 'Đang chuẩn bị vùng ảnh chụp…' : 'Đang tải và chuẩn bị ảnh gốc…', createdAt: Date.now(),
      };
      await jobs.update(job);
      try {
        const privateJob: PrivateJob = { ...(captured ? { capture: captured.capture } : {}), id: job.id, tabId, selection: current, settings: config.settings, apiKey: config.apiKey };
        const answer = objectValue(await browser.runtime.sendMessage({ type: 'offscreen:start', job: privateJob }));
        if (answer?.['ok'] !== true) throw new TranslationError(objectValue(answer?.['error'])?.['code'] === 'BUSY' ? 'BUSY' : 'INTERNAL');
      } catch (error) {
        const safe = publicError(error);
        await jobs.update({ ...job, phase: 'error', errorCode: safe.code, message: safe.message });
        throw error;
      }
      await badge(tabId, '…', 'Manga Translator Pro — đang dịch ảnh', '#245b9b');
      return job;
    } finally { launching = false; }
  }

  async function progress(message: Record<string, unknown>): Promise<void> {
    if (typeof message['id'] !== 'string') return;
    const job = (await jobs.all()).find((item) => item.id === message['id']);
    if (!job || !isRunning(job)) return;
    if (message['phase'] === 'translating') {
      const tile = message['tile'], tiles = message['tiles'];
      if (typeof tile !== 'number' || typeof tiles !== 'number' || tile < 1 || tiles > 12 || tile > tiles) return;
      await jobs.transition({ ...job, phase: 'translating', tile, tiles, message: `Gemini đang đọc và dịch phần ${tile}/${tiles}…` });
      return;
    }
    if (message['phase'] === 'error') {
      const incoming = objectValue(message['error']);
      const allowed = ['KEY_FORMAT', 'AUTH', 'PERMISSION', 'API_DISABLED', 'KEY_BLOCKED', 'QUOTA', 'MODEL', 'NETWORK', 'TIMEOUT', 'INVALID_JSON', 'INVALID_COORDINATES', 'SAFETY', 'NO_TEXT', 'CANCELLED', 'IMAGE_ACCESS', 'IMAGE_TOO_LARGE', 'UNSUPPORTED_IMAGE', 'STALE_IMAGE', 'CAPTURE_FAILED', 'NO_IMAGE', 'CONFIG', 'BUSY', 'INTERNAL'] as const;
      const code = allowed.find((item) => item === incoming?.['code']) ?? 'INTERNAL';
      const error = new TranslationError(code);
      await jobs.transition({ ...job, phase: code === 'CANCELLED' ? 'cancelled' : 'error', errorCode: code, message: error.message });
      await badge(job.tabId, '!', error.message, '#a12a35');
      return;
    }
    if (message['phase'] !== 'complete') return;
    try {
      const selected = validateSelection(message['selection']);
      const output = message['output'] as TranslationOutput;
      if (!output || !Array.isArray(output.regions) || JSON.stringify(output).length > 1_000_000) throw new TranslationError('INVALID_JSON');
      await jobs.transition({ ...job, phase: 'applying', message: 'Đang đặt bản dịch lên ảnh…' });
      const latest = await jobs.forTab(job.tabId);
      if (latest?.id !== job.id || !isRunning(latest)) return;
      const answer = objectValue(await browser.tabs.sendMessage(job.tabId, {
        type: 'mtp:apply', result: { ...selected, regions: output.regions },
      }, { frameId: 0 }));
      if (answer?.['ok'] !== true) throw new TranslationError('STALE_IMAGE');
      const after = await jobs.forTab(job.tabId);
      if (after?.id !== job.id || !isRunning(after)) {
        await browser.tabs.sendMessage(job.tabId, { type: 'mtp:apply', result: { ...selected, regions: [] } }, { frameId: 0 }).catch(() => undefined);
        return;
      }
      await jobs.transition({ ...job, phase: 'done', output, message: `Đã dịch ${output.regions.length} vùng chữ sang tiếng Việt.` });
      await badge(job.tabId, String(Math.min(99, output.regions.length)), 'Manga Translator Pro — bản dịch đã sẵn sàng');
    } catch (error) {
      const safe = publicError(error);
      const latest = await jobs.forTab(job.tabId);
      if (latest?.id !== job.id || !isRunning(latest)) return;
      await jobs.transition({ ...job, phase: 'error', errorCode: safe.code, message: safe.message });
      await badge(job.tabId, '!', safe.message, '#a12a35');
    }
  }

  async function ui(message: Record<string, unknown>): Promise<unknown> {
    switch (message['type']) {
      case 'ui:settings': return credentials.publicConfig();
      case 'ui:save': {
        const config = await credentials.save(message['settings'], message['apiKey']);
        await chapters.invalidate(); return config;
      }
      case 'ui:clear-key': await credentials.clearKey(); return credentials.publicConfig();
      case 'ui:models': {
        const config = await credentials.privateConfig();
        const key = typeof message['apiKey'] === 'string' && message['apiKey'] ? validateApiKey(message['apiKey']) : config.apiKey;
        if (!key) throw new TranslationError('CONFIG');
        return new GeminiClient().listModels(key);
      }
      case 'ui:inspect': {
        const tabId = await activeTab();
        return { tabId, selection: await selection(tabId), job: await jobs.forTab(tabId) };
      }
      case 'ui:debug': {
        const tabId = await activeTab();
        await selection(tabId);
        const answer = objectValue(await browser.tabs.sendMessage(tabId, { type: 'mtp:debug' }, { frameId: 0 }));
        return answer?.['report'];
      }
      case 'ui:job': {
        if (typeof message['tabId'] !== 'number') throw new TranslationError('NO_IMAGE');
        const job = await jobs.forTab(message['tabId']);
        if (job && isRunning(job) && Date.now() - job.createdAt > 5 * 60_000 + 10_000) {
          const expired: PublicJob = { ...job, phase: 'error', errorCode: 'TIMEOUT', message: new TranslationError('TIMEOUT').message };
          await jobs.update(expired); return expired;
        }
        return job;
      }
      case 'ui:translate': {
        if (typeof message['tabId'] !== 'number') throw new TranslationError('NO_IMAGE');
        return start(message['tabId'], message['selection'], message['capture'] === true);
      }
      case 'ui:cancel': {
        if (typeof message['tabId'] !== 'number') throw new TranslationError('NO_IMAGE');
        const job = await jobs.forTab(message['tabId']);
        if (job && isRunning(job)) {
          await jobs.transition({ ...job, phase: 'cancelled', errorCode: 'CANCELLED', message: new TranslationError('CANCELLED').message });
          await browser.runtime.sendMessage({ type: 'offscreen:cancel', id: job.id }).catch(() => undefined);
          await badge(job.tabId, '', 'Manga Translator Pro — đã hủy');
        }
        return true;
      }
      case 'ui:clear-overlay': {
        if (typeof message['tabId'] !== 'number') throw new TranslationError('NO_IMAGE');
        await browser.tabs.sendMessage(message['tabId'], { type: 'mtp:tracking', command: 'stop' }, { frameId: 0 });
        await badge(message['tabId'], '', 'Manga Translator Pro — đã xóa overlay'); return true;
      }
      default:
        if (String(message['type']).startsWith('ui:chapter-') || ['ui:enable-site', 'ui:enable-sites'].includes(String(message['type']))) return chapters.ui(message);
        throw new TranslationError('INTERNAL');
    }
  }

  browser.runtime.onMessage.addListener((raw: unknown, sender, reply) => {
    const message = objectValue(raw);
    if (!message || typeof message['type'] !== 'string') return;
    if (message['type'] === 'private:chapter-changed' && isOffscreenSender(sender, browser.runtime.id)) {
      if (typeof message['chapterId'] === 'string') chapters.changed(message['chapterId']);
      reply({ ok: true }); return;
    }
    if (message['type'].startsWith('chapter:') && sender.id === browser.runtime.id && sender.tab?.id !== undefined && sender.frameId === 0) {
      void chapters.content(sender.tab.id, message).then((data) => reply({ ok: true, data }), (error: unknown) => reply({ ok: false, error: publicError(error) }));
      return true;
    }
    if (message['type'] === 'private:progress' && isOffscreenSender(sender, browser.runtime.id)) {
      const operation = progressQueue.then(() => progress(message));
      progressQueue = operation.catch(() => undefined);
      void operation.then(() => reply({ ok: true }), () => reply({ ok: false }));
      return true;
    }
    if (!message['type'].startsWith('ui:') || !isTrustedUi(sender, browser.runtime.id)) return;
    void ui(message).then((data) => reply({ ok: true, data }), (error: unknown) => reply({ ok: false, error: publicError(error) }));
    return true;
  });

  browser.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-tracking') return;
    if (typeof browser.action.openPopup === 'function') void browser.action.openPopup().catch(() => browser.runtime.openOptionsPage());
    else void browser.runtime.openOptionsPage();
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading') void badge(tabId, '', 'Manga Translator Pro — dịch ảnh đang xem');
  });
});
