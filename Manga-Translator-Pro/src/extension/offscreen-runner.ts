import { browser } from 'wxt/browser';

let creating: Promise<void> | undefined;

export async function ensureOffscreen(): Promise<void> {
  if (creating) return creating;
  creating = (async () => {
    const contexts = await browser.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [browser.runtime.getURL('/offscreen.html')],
    });
    if (contexts.length === 0) await browser.offscreen.createDocument({
      url: 'offscreen.html', reasons: [browser.offscreen.Reason.BLOBS],
      justification: 'Decode source image blobs, crop image tiles and run user-requested Gemini Vision translation.',
    });
  })();
  try { await creating; } finally { creating = undefined; }
}
