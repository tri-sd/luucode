import { browser } from 'wxt/browser';
import { ChapterService, chapterOrigins, type ChapterExecutorRequest } from '../chapter/chapter-service';
import { canonicalChapterUrl, chapterIdentity } from '../chapter/identity';
import { IndexedDBCache } from '../chapter/indexeddb-cache';
import { isNormalizedBox } from '../core/geometry';
import type { NormalizedBox } from '../core/types';
import { parseObservations, dispatchChapterRpc, type ChapterRpcContext } from '../chapter/rpc';
import { throwIfAborted, TranslationError } from '../translation/errors';
import { objectValue } from '../translation/schema';
import type { CredentialStore } from './credentials';
import { ensureOffscreen } from './offscreen-runner';

interface Options {
  readonly credentials: CredentialStore;
  readonly activeTab: () => Promise<number>;
  readonly ensureTab: (tabId: number) => Promise<unknown>;
}

/** Bridges authenticated UI/content messages to trusted chapter persistence. */
export class ChapterBackground {
  private readonly store = new IndexedDBCache();
  private readonly changedIds = new Set<string>();
  private registrations: Promise<unknown> = Promise.resolve();
  private readonly cropPreparations = new Map<string, AbortController>();
  private notifyTimer: ReturnType<typeof setTimeout> | undefined;
  readonly service: ChapterService;
  constructor(private readonly options: Options) {
    this.service = new ChapterService({ store: this.store,
      privateConfig: () => options.credentials.privateConfig(),
      permitted: async (origins) => origins.length === 0 || browser.permissions.contains({ origins: [...origins] }),
      execute: (request) => this.execute(request),
      changed: (chapterId) => this.changed(chapterId),
      settings: () => browser.runtime.openOptionsPage(),
      permissionHint: async () => { if (typeof browser.action.openPopup === 'function') await browser.action.openPopup(); },
      alive: async () => (await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [browser.runtime.getURL('/offscreen.html')] })).length > 0,
    });
  }

  syncReaderScripts(): Promise<void> {
    const operation = this.registrations.catch(() => undefined).then(() => this.registerReaderScripts());
    this.registrations = operation.catch(() => undefined);
    return operation;
  }

  private async registerReaderScripts(): Promise<void> {
    await this.options.credentials.protect();
    const granted = await browser.permissions.getAll();
    const matches = (granted.origins ?? []).filter((origin) => /^https?:\/\//.test(origin) && origin !== 'https://generativelanguage.googleapis.com/*').sort();
    const id = 'mtp-auto-reader';
    const existing = (await browser.scripting.getRegisteredContentScripts({ ids: [id] }))[0];
    if (!matches.length) { if (existing) await browser.scripting.unregisterContentScripts({ ids: [id] }); return; }
    if (existing && JSON.stringify([...existing.matches ?? []].sort()) === JSON.stringify(matches)) return;
    const script = { id, matches, js: ['content-scripts/tracking.js'], runAt: 'document_idle' as const, allFrames: false, persistAcrossSessions: true };
    if (existing) await browser.scripting.updateContentScripts([script]);
    else await browser.scripting.registerContentScripts([script]);
  }

  async context(tabId: number, claimed?: Record<string, unknown>): Promise<ChapterRpcContext> {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url || !/^https?:\/\//.test(tab.url)) throw new TranslationError('NO_IMAGE');
    const response = objectValue(await browser.tabs.sendMessage(tabId, { type: 'mtp:chapter-context' }, { frameId: 0 }));
    if (!response || typeof response['url'] !== 'string' || typeof response['documentToken'] !== 'string'
      || !/^[a-f0-9]{32}$/.test(response['documentToken']) || canonicalChapterUrl(response['url']) !== canonicalChapterUrl(tab.url)
      || (claimed && (claimed['documentToken'] !== response['documentToken'] || typeof claimed['url'] !== 'string'
        || canonicalChapterUrl(claimed['url']) !== canonicalChapterUrl(tab.url)))) throw new TranslationError('STALE_IMAGE');
    return { url: response['url'], documentToken: response['documentToken'] };
  }

  async content(tabId: number, message: Record<string, unknown>): Promise<unknown> {
    const context = await this.context(tabId, message);
    if (message['type'] === 'chapter:cancel-reprocess') {
      await this.cancelRegionReprocess(chapterIdentity(context.url).id);
      return true;
    }
    if (message['type'] === 'chapter:reprocess-region') {
      const [observation] = parseObservations([message['observation']],context.documentToken,1);
      if (!objectValue(message['crop']) || !isNormalizedBox(message['crop'] as NormalizedBox)) throw new TranslationError('INVALID_COORDINATES');
      const chapterId = chapterIdentity(context.url).id;
      if (this.cropPreparations.has(chapterId)) throw new TranslationError('BUSY');
      const controller = new AbortController();
      this.cropPreparations.set(chapterId, controller);
      try {
        const snapshot = await this.service.regionSnapshot(context.url,context.documentToken,observation!);
        throwIfAborted(controller.signal);
        if (snapshot.cacheKey !== message['cacheKey'] || snapshot.revision !== message['expectedRevision']) throw new TranslationError('STALE_IMAGE');
        const config = await this.options.credentials.privateConfig();
        throwIfAborted(controller.signal);
        if (!config.apiKey || !config.settings.model) throw new TranslationError('CONFIG');
        if (!await browser.permissions.contains({origins:[`${new URL(observation!.source).origin}/*`]})) throw new TranslationError('CHAPTER_ACCESS');
        throwIfAborted(controller.signal);
        await ensureOffscreen();
        throwIfAborted(controller.signal);
        const response = objectValue(await browser.runtime.sendMessage({type:'offscreen:region-reprocess',request:{chapterId,imageId:snapshot.imageId,
          cacheKey:snapshot.cacheKey,expectedRevision:snapshot.revision,crop:message['crop'],...config}}));
        throwIfAborted(controller.signal);
        if (response?.['ok'] !== true) {
          const code = objectValue(response?.['error'])?.['code'];
          const allowed = ['KEY_FORMAT','AUTH','PERMISSION','API_DISABLED','KEY_BLOCKED','QUOTA','MODEL','NETWORK','TIMEOUT',
            'INVALID_JSON','INVALID_COORDINATES','SAFETY','NO_TEXT','CANCELLED','IMAGE_ACCESS','IMAGE_TOO_LARGE','UNSUPPORTED_IMAGE',
            'STALE_IMAGE','CAPTURE_FAILED','NO_IMAGE','CONFIG','BUSY','INTERNAL','CHAPTER_ACCESS','COLLECTION_REQUIRED','LIVE_ONLY','CACHE_STORAGE'] as const;
          throw new TranslationError(allowed.find((item)=>item===code)??'INTERNAL');
        }
        await this.context(tabId,message);
        throwIfAborted(controller.signal);
        return response['data'];
      } finally {
        if (this.cropPreparations.get(chapterId) === controller) this.cropPreparations.delete(chapterId);
      }
    }
    const result = await dispatchChapterRpc(this.service, context, message);
    if (message['type'] === 'chapter:save-regions' || message['type'] === 'chapter:reset-regions') await this.invalidate(chapterIdentity(context.url).id);
    if (message['type'] === 'chapter:command' && ['clear', 'options'].includes(String(message['command']))) {
      await this.invalidate(chapterIdentity(context.url).id, message['command'] === 'clear');
    }
    return result;
  }

  async ui(message: Record<string, unknown>): Promise<unknown> {
    switch (message['type']) {
      case 'ui:chapter-inspect': {
        const tabId = await this.options.activeTab();
        await this.options.ensureTab(tabId);
        const context = await this.context(tabId);
        const view = await this.service.attach(context.url, context.documentToken);
        return { tabId, ...context, view, origins: chapterOrigins(view) };
      }
      case 'ui:chapter-command': {
        const tabId = message['tabId'];
        if (typeof tabId !== 'number' || typeof message['command'] !== 'string') throw new TranslationError('NO_IMAGE');
        await this.options.ensureTab(tabId);
        if (message['command'] === 'edit' || message['command'] === 'quick-translate') {
          await browser.tabs.sendMessage(tabId,{type:'mtp:chapter-action',command:message['command']},{frameId:0});
          const current = await this.context(tabId); return this.service.attach(current.url,current.documentToken);
        }
        // Flush the last metadata batch before Finish/Translate and before releasing the collecting state.
        if (['finish', 'translate'].includes(message['command'])) await browser.tabs.sendMessage(tabId, { type: 'mtp:chapter-flush' }, { frameId: 0 });
        const context = await this.context(tabId);
        const view = await this.service.command(context.url, context.documentToken, message['command'], message['value']);
        if (['clear', 'options'].includes(message['command'])) await this.invalidate(view.session.id, message['command'] === 'clear');
        return view;
      }
      case 'ui:enable-site': {
        const tabId = typeof message['tabId'] === 'number' ? message['tabId'] : await this.options.activeTab();
        const tab = await browser.tabs.get(tabId);
        if (!tab.url || !/^https?:\/\//.test(tab.url)) throw new TranslationError('NO_IMAGE');
        const origin = `${new URL(tab.url).origin}/*`;
        if (!await browser.permissions.contains({ origins: [origin] })) throw new TranslationError('CHAPTER_ACCESS');
        await this.syncReaderScripts(); await this.options.ensureTab(tabId); return true;
      }
      case 'ui:enable-sites': await this.syncReaderScripts(); return true;
      default: throw new TranslationError('CONFIG');
    }
  }

  changed(chapterId: string): void {
    if (!/^chapter-[a-f0-9]{64}$/.test(chapterId)) return;
    this.changedIds.add(chapterId);
    if (this.notifyTimer !== undefined) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      const ids = [...this.changedIds]; this.changedIds.clear();
      void browser.tabs.query({}).then((tabs) => Promise.allSettled(tabs.filter((tab) => tab.id !== undefined).flatMap((tab) =>
        ids.map((id) => browser.tabs.sendMessage(tab.id!, { type: 'mtp:chapter-changed', chapterId: id }, { frameId: 0 }))))).catch(() => undefined);
    }, 200);
  }

  async invalidate(chapterId?: string, reset = false): Promise<void> {
    const tabs = await browser.tabs.query({});
    await Promise.allSettled(tabs.filter((tab) => tab.id !== undefined).map((tab) => browser.tabs.sendMessage(tab.id!, {
      type: 'mtp:chapter-invalidate', ...(chapterId ? { chapterId } : {}), reset,
    }, { frameId: 0 })));
  }

  private async execute(request: ChapterExecutorRequest): Promise<void> {
    if (request.command === 'pause' || request.command === 'cancel') await this.cancelRegionReprocess(request.chapterId);
    await ensureOffscreen();
    const response = objectValue(await browser.runtime.sendMessage({ type: 'offscreen:chapter-command', request }));
    if (response?.['ok'] === true) return;
    const code = objectValue(response?.['error'])?.['code'];
    throw new TranslationError(code === 'BUSY' ? 'BUSY' : code === 'CONFIG' ? 'CONFIG' : 'INTERNAL');
  }

  private async cancelRegionReprocess(chapterId: string): Promise<void> {
    this.cropPreparations.get(chapterId)?.abort();
    await browser.runtime.sendMessage({ type: 'offscreen:region-cancel', chapterId }).catch(() => undefined);
  }
}
