import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { isTrackingMessage, type TrackingReply } from '../core/messages';
import { CaptureSession } from '../tracking/capture-session';
import { validateSelection } from '../extension/security';
import { ChapterContentController } from '../chapter/content-controller';
import { RegionTracker } from '../tracking/region-tracker';
import { objectValue } from '../translation/schema';
import type { RegionResult } from '../core/types';

declare global {
  interface Window { __MTP_PHASE1_TRACKER__?: RegionTracker }
}

export default defineContentScript({
  // Only injected after the user invokes the action/shortcut (activeTab).
  // Declaring matches here would make WXT request permanent host permissions.
  registration: 'runtime',
  main(context) {
    // executeScript may run twice after simultaneous user actions; one controller owns the page.
    if (window.__MTP_PHASE1_TRACKER__) return;
    const tracker = new RegionTracker({ initialRegions: 'empty' });
    window.__MTP_PHASE1_TRACKER__ = tracker;
    const capture = new CaptureSession(tracker);
    const transport = async (request: Readonly<Record<string, unknown>>): Promise<unknown> => {
      const response = objectValue(await browser.runtime.sendMessage(request));
      if (response?.['ok'] !== true) throw new Error(String(objectValue(response?.['error'])?.['message'] ?? 'Chưa đồng bộ được chương.'));
      return response['data'];
    };
    let chapter = new ChapterContentController(tracker, transport);
    chapter.start();
    let captureUiTimer: number | undefined;
    const hideChapterForCapture = (hidden: boolean): void => {
      if (captureUiTimer !== undefined) clearTimeout(captureUiTimer);
      chapter.setCaptureHidden(hidden);
      captureUiTimer = hidden ? window.setTimeout(() => { chapter.setCaptureHidden(false); }, 5500) : undefined;
    };
    const listener: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message: unknown, sender, reply) => {
      if (sender.id !== browser.runtime.id) return;
      const request = objectValue(message);
      if (request?.['type'] === 'mtp:chapter-action' && (request['command']==='edit'||request['command']==='quick-translate')) {
        void chapter.command(request['command']).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;
      }
      if (request?.['type'] === 'mtp:chapter-context') {
        reply({ url: location.href, documentToken: tracker.documentToken }); return;
      }
      if (request?.['type'] === 'mtp:chapter-flush') {
        void chapter.flush().then(() => reply({ ok: true }), () => reply({ ok: false })); return true;
      }
      if (request?.['type'] === 'mtp:chapter-changed' || request?.['type'] === 'mtp:chapter-invalidate') {
        if (!request['chapterId'] || request['chapterId'] === chapter.currentView()?.session.id) {
          if (request['type'] === 'mtp:chapter-invalidate') chapter.invalidateTranslations(request['reset'] === true);
          else chapter.refresh();
        }
        reply({ ok: true }); return;
      }
      if (request?.['type'] === 'mtp:selection') {
        tracker.start();
        tracker.refresh();
        reply({ ok: true, selection: tracker.currentImage(), status: tracker.status() });
        return;
      }
      if (request?.['type'] === 'mtp:debug') {
        tracker.start(); reply({ ok: true, report: tracker.debugDetection() }); return;
      }
      if (request?.['type'] === 'mtp:capture-prepare') {
        try {
          const selected = validateSelection(request['selection']);
          hideChapterForCapture(true);
          void capture.prepare(selected).then((result) => reply({ ok: true, ...result }), () => { hideChapterForCapture(false); reply({ ok: false }); });
          return true;
        } catch { reply({ ok: false }); return; }
      }
      if (request?.['type'] === 'mtp:capture-finish') {
        hideChapterForCapture(false);
        reply({ ok: typeof request['ticket'] === 'string' && capture.finish(request['ticket']) }); return;
      }
      if (request?.['type'] === 'mtp:capture-cancel') { capture.reset(); hideChapterForCapture(false); reply({ ok: true }); return; }
      if (request?.['type'] === 'mtp:apply') {
        const result = objectValue(request['result']);
        if (!result || result['documentToken'] !== tracker.documentToken || !Array.isArray(result['regions'])) { reply({ ok: false }); return; }
        try {
          const selection = validateSelection(result);
          reply({ ok: capture.accepts(selection) && tracker.applyRegions(result as unknown as RegionResult) });
        } catch { reply({ ok: false }); }
        return;
      }
      if (!isTrackingMessage(message)) return;
      if (message.command === 'start' || (message.command === 'toggle' && !tracker.status().active)) tracker.start();
      else if (message.command === 'stop' || message.command === 'toggle') { capture.reset(); tracker.stop(); }
      reply({ ok: true, status: tracker.status() } satisfies TrackingReply);
    };
    browser.runtime.onMessage.addListener(listener);
    const onPageHide = (): void => { capture.reset(); hideChapterForCapture(false); chapter.stop(); tracker.stop(); };
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) { chapter = new ChapterContentController(tracker, transport); chapter.start(); }
    };
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    context.onInvalidated(() => {
      capture.reset(); hideChapterForCapture(false); chapter.stop(); tracker.stop();
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      browser.runtime.onMessage.removeListener(listener);
      delete window.__MTP_PHASE1_TRACKER__;
    });
  },
});
