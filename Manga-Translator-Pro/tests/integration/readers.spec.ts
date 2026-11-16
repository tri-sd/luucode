import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { assertAligned, frames, recordMetrics } from './helpers';

async function reader(page: Page, mode = 'fixed'): Promise<void> {
  await page.goto(`/readers.html?mode=${mode}`);
  await page.waitForFunction(() => (window as unknown as { fixtureReady: boolean }).fixtureReady);
  await page.addScriptTag({ path: resolve('work/browser-harness.js') });
  await page.evaluate(() => window.testTracker.start());
}

test('fixed page reader at 50% selects the displayed page', async ({ page }, info) => {
  await reader(page);
  await expect.poll(() => page.evaluate(() => window.testTracker.currentImage()?.source)).toContain('FIXED');
  const errors = [];
  for (const scroll of [0, 250, 70, 500, 0]) {
    await page.evaluate((top) => window.scrollTo(0, top), scroll);
    await frames(page);
    errors.push(await assertAligned(page, 'page'));
  }
  await expect(page.locator('[data-mtp-root] .layer')).toHaveCount(1);
  await recordMetrics(info, { maxErrorCssPx: Math.max(...errors), siteScale: 0.5 });
});

for (const mode of ['canvas', 'tainted', 'background', 'picture'] as const) {
  test(`${mode} discovers a visible surface in a fixed reader`, async ({ page }, info) => {
    await reader(page, mode);
    await expect.poll(() => page.evaluate(() => window.testTracker.currentImage()?.method)).toBe(mode === 'tainted' ? 'canvas' : mode);
    if (mode === 'canvas' || mode === 'tainted') expect(await page.evaluate(() => window.testTracker.currentImage()?.requiresCapture)).toBe(true);
    const error = await assertAligned(page, 'page');
    await expect(page.locator('[data-mtp-root] .layer')).toHaveCount(1);
    if (mode === 'tainted') {
      const tainted = await page.locator('#page').evaluate((canvas: HTMLCanvasElement) => {
        try { canvas.getContext('2d')!.getImageData(0,0,1,1); return false; } catch { return true; }
      });
      expect(tainted).toBe(true);
    }
    await recordMetrics(info, { maxErrorCssPx: error, method: mode });
  });
}

test('deferred lazy image becomes selectable once loaded without duplicate overlays', async ({ page }) => {
  await reader(page, 'lazy');
  expect(await page.evaluate(() => window.testTracker.currentImage())).toBeNull();
  expect(await page.evaluate(() => window.testTracker.debugDetection().entries.find((row) => row.element === 'img#page')?.reason)).toContain('lazy');
  await page.locator('#page').evaluate(async (image: HTMLImageElement) => { image.src = image.dataset['src']!; await image.decode(); });
  await expect.poll(() => page.evaluate(() => window.testTracker.currentImage()?.source)).toContain('LAZY');
  await assertAligned(page, 'page');
  await expect(page.locator('[data-mtp-root] .layer')).toHaveCount(1);
});

test('long-strip lazy pages track after scrolling in both directions', async ({ page }, info) => {
  await reader(page, 'long-strip');
  const errors = [];
  for (const id of ['page', 'strip-0', 'strip-2', 'strip-1', 'page']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await page.locator(`#${id}`).evaluate(async (image: HTMLImageElement) => image.decode());
    await frames(page);
    errors.push(await assertAligned(page, id));
    expect(await page.evaluate(() => window.testTracker.currentImage())).not.toBeNull();
  }
  await recordMetrics(info, { maxErrorCssPx: Math.max(...errors), stripSamples: errors.length });
});

test('overlapping inactive slide is rejected by rendered visibility, not DOM order', async ({ page }) => {
  await reader(page);
  await page.locator('#inactive').evaluate((image: HTMLImageElement) => { image.style.visibility = 'visible'; image.style.zIndex = '-1'; });
  await frames(page);
  expect(await page.evaluate(() => window.testTracker.currentImage()?.source)).toContain('FIXED');
  const report = await page.evaluate(() => window.testTracker.debugDetection());
  expect(report.domImages).toBe(2);
  expect(report.valid).toBe(2);
  expect(report.visible).toBe(1);
  expect(report.entries.find((row) => row.element === 'img#inactive')?.reason).toContain('che khuất');
});

test('picture source changes immediately reject stale results', async ({ page }) => {
  await reader(page, 'picture');
  await expect.poll(() => page.evaluate(() => window.testTracker.currentImage()?.source)).toContain('PICTURE');
  const original = await page.evaluate(() => window.testTracker.currentImage()!);
  const accepted = await page.evaluate((selection) => {
    document.querySelector('source')!.srcset = '/panel.svg?id=PICTURE2 1x';
    return window.testTracker.applyRegions({ ...selection, regions: [] });
  }, original);
  expect(accepted).toBe(false);
  await expect.poll(() => page.evaluate(() => window.testTracker.currentImage()?.source)).toContain('PICTURE2');
});

for (const fit of ['contain', 'cover'] as const) {
  test(`fixed image object-fit ${fit} and object-position survive zoom/resize`, async ({ page }, info) => {
    await reader(page);
    await page.locator('#page').evaluate((image, value) => Object.assign(image.style, { width: '900px', height: '900px', objectFit: value, objectPosition: '25% 75%' }), fit);
    const errors = [];
    for (const width of [1200, 900, 1400]) {
      await page.setViewportSize({ width, height: 900 }); await frames(page);
      errors.push(await page.evaluate((value) => {
        const image = document.querySelector('#page')!.getBoundingClientRect();
        const region = document.querySelector('[data-mtp-root]')!.shadowRoot!.querySelector('[data-source-element="page"] [data-region-id="mock-1"]')!.getBoundingClientRect();
        const w = value === 'contain' ? image.height / 1.6 : image.width;
        const h = value === 'contain' ? image.height : image.width * 1.6;
        return Math.max(Math.abs(region.x - image.x - (image.width - w) * .25 - w * .12), Math.abs(region.y - image.y - (image.height - h) * .75 - h * .15),
          Math.abs(region.width - w * .34), Math.abs(region.height - h * .11));
      }, fit));
    }
    expect(Math.max(...errors)).toBeLessThanOrEqual(2);
    await recordMetrics(info, { maxErrorCssPx: Math.max(...errors), fit });
  });
}

test('CSS zoom and independent scale retain correct positions', async ({ page }, info) => {
  await reader(page);
  const errors = [];
  for (const zoom of ['.8', '1.25', '1']) {
    await page.locator('#zoom').evaluate((element, value) => { element.style.zoom = value; element.style.scale = '.9'; }, zoom);
    await frames(page); errors.push(await assertAligned(page, 'page'));
  }
  expect(Math.max(...errors)).toBeLessThanOrEqual(2);
  await recordMetrics(info, { maxErrorCssPx: Math.max(...errors) });
});

test('debug explains unsupported rotation and distinguishes DOM discovery from selection', async ({ page }) => {
  await reader(page);
  await page.locator('#zoom').evaluate((element) => { element.style.transform = 'rotate(3deg)'; });
  const report = await page.evaluate(() => window.testTracker.debugDetection());
  expect(report.domImages).toBe(2); expect(report.valid).toBe(2); expect(report.visible).toBe(0);
  expect(report.entries.find((row) => row.element === 'img#page')?.reason).toContain('Transform');
  expect(await page.evaluate(() => window.testTracker.currentImage())).toBeNull();
});

for (const dpr of [1, 1.25, 1.5, 2]) {
  test(`canvas screenshot crop and overlay use actual bitmap ratio at DPR ${dpr}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: dpr, baseURL: 'http://127.0.0.1:4173' });
    const page = await context.newPage();
    try {
      await reader(page, 'canvas');
      await page.locator('#scroller').evaluate((element) => { element.scrollTop = 250; });
      await frames(page);
      const prepared = await page.evaluate(async () => window.readerHarness.captureSession.prepare(window.testTracker.currentImage()!));
      const dataUrl = `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
      expect(await page.evaluate((ticket) => window.readerHarness.captureSession.finish(ticket!), prepared.selection.captureTicket)).toBe(true);
      const result = await page.evaluate((capture) => window.readerHarness.translateCapture(capture), { dataUrl, geometry: prepared.geometry });
      expect(result.regions).toHaveLength(1);
      await expect(page.locator('[data-mtp-root] [data-region-id$="capture-region"]')).toHaveCount(1);
      const error = await page.evaluate((geometry) => {
        const region = document.querySelector('[data-mtp-root]')!.shadowRoot!.querySelector('[data-region-id$="capture-region"]')!.getBoundingClientRect();
        return Math.max(Math.abs(region.x - geometry.clip.x - geometry.clip.width * .2), Math.abs(region.y - geometry.clip.y - geometry.clip.height * .25),
          Math.abs(region.width - geometry.clip.width * .3), Math.abs(region.height - geometry.clip.height * .1));
      }, prepared.geometry);
      expect(error).toBeLessThanOrEqual(2);
      const dimensions = await page.evaluate(() => window.sentImageDimensions);
      expect(dimensions[0]).toBeLessThan(1200 * dpr);
      expect(dimensions[1]).toBeLessThan(900 * dpr);
      await recordMetrics(info, { dpr, maxErrorCssPx: error, submittedImageDimensions: dimensions, viewport: [1200, 900] });
    } finally { await context.close(); }
  });
}

test('capture rejects movement, redraws and page-turn input, then restores the overlay', async ({ page }) => {
  await reader(page, 'canvas');
  const prepared = await page.evaluate(async () => window.readerHarness.captureSession.prepare(window.testTracker.currentImage()!));
  await page.locator('#zoom').evaluate((element) => { element.style.transform = 'translate3d(3px,0,0) scale(.5)'; });
  expect(await page.evaluate((ticket) => window.readerHarness.captureSession.finish(ticket!), prepared.selection.captureTicket)).toBe(false);
  await expect(page.locator('[data-mtp-root]')).toHaveCSS('visibility', 'visible');
  const second = await page.evaluate(async () => window.readerHarness.captureSession.prepare(window.testTracker.currentImage()!));
  expect(await page.evaluate((ticket) => window.readerHarness.captureSession.finish(ticket!), second.selection.captureTicket)).toBe(true);
  await page.locator('#page').evaluate((canvas: HTMLCanvasElement) => { const context = canvas.getContext('2d')!; context.fillStyle = 'red'; context.fillRect(0,0,1000,1600); });
  expect(await page.evaluate((selection) => window.readerHarness.captureSession.accepts(selection), second.selection)).toBe(false);
  const third = await page.evaluate(async () => window.readerHarness.captureSession.prepare(window.testTracker.currentImage()!));
  expect(await page.evaluate((ticket) => window.readerHarness.captureSession.finish(ticket!), third.selection.captureTicket)).toBe(true);
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate((selection) => window.readerHarness.captureSession.accepts(selection), third.selection)).toBe(false);
});

test('Comix-style img/picture DOM inside fixed Swiper container is selected and translates', async ({ page }, info) => {
  await page.goto('/comix-reader.html');
  await page.locator('#page').evaluate(async (image: HTMLImageElement) => image.decode());
  await page.addScriptTag({ path: resolve('work/translation-harness.js') });
  await page.evaluate(() => window.translationHarness.start());
  await expect.poll(() => page.evaluate(() => window.translationHarness.tracker.currentImage()?.source)).toContain('COMIX-STRUCTURE');
  await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({ json: {
    candidates: [{ content: { parts: [{ text: JSON.stringify({ coordinateSystem: 'normalized_1000', sourceLanguage: 'en', regions: [
      { id: 'real-1', sourceText: 'SYNTHETIC SOURCE', translatedText: 'Bản dịch thử nghiệm', bbox: [150,120,260,460] },
    ] }) }] }, finishReason: 'STOP' }],
  } }));
  const result = await page.evaluate(() => window.translationHarness.translate());
  expect(result.ok).toBe(true);
  await expect(page.locator('[data-mtp-root] .region')).toHaveText('Bản dịch thử nghiệm');
  const error = await page.evaluate(() => {
    const image = document.querySelector('#page')!.getBoundingClientRect();
    const region = document.querySelector('[data-mtp-root]')!.shadowRoot!.querySelector('.region')!.getBoundingClientRect();
    return Math.max(Math.abs(region.x-image.x-image.width*.12),Math.abs(region.y-image.y-image.height*.15),
      Math.abs(region.width-image.width*.34),Math.abs(region.height-image.height*.11));
  });
  expect(error).toBeLessThanOrEqual(2);
  await page.screenshot({ path: 'work/phase030/comix-fixture-translated.png' });
  await recordMetrics(info, { maxErrorCssPx: error, provider: 'mocked Gemini HTTP response', site: 'local structural fixture' });
});

test('root CSS zoom compensates overlay CSS units', async ({ page }, info) => {
  await reader(page);
  const errors = [];
  for (const zoom of ['.8', '1.25', '1.5', '1']) {
    await page.locator('html').evaluate((element, value) => { element.style.zoom = value; }, zoom);
    await frames(page); errors.push(await assertAligned(page, 'page'));
  }
  await recordMetrics(info, { maxErrorCssPx: Math.max(...errors), cssZoom: ['.8', '1.25', '1.5', '1'] });
});

test('background cover and position map to the source rather than the element bounds', async ({ page }, info) => {
  await reader(page, 'background');
  await expect.poll(() => page.evaluate(() => window.testTracker.currentImage()?.method)).toBe('background');
  await page.locator('#page').evaluate((element) => Object.assign(element.style, { width: '600px', height: '600px', backgroundSize: 'cover', backgroundPosition: '25% 75%' }));
  await frames(page);
  const error = await page.evaluate(() => {
    const image = document.querySelector('#page')!.getBoundingClientRect();
    const region = document.querySelector('[data-mtp-root]')!.shadowRoot!.querySelector('[data-source-element="page"] [data-region-id="mock-1"]')!.getBoundingClientRect();
    const paintedHeight = image.width * 1.6;
    return Math.max(Math.abs(region.x-image.x-image.width*.12), Math.abs(region.y-image.y-(image.height-paintedHeight)*.75-paintedHeight*.15),
      Math.abs(region.width-image.width*.34),Math.abs(region.height-paintedHeight*.11));
  });
  expect(error).toBeLessThanOrEqual(2);
  await recordMetrics(info, { maxErrorCssPx: error });
});

test('pinch zoom is explicitly rejected instead of placing an inaccurate overlay', async ({ page }) => {
  await reader(page);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await frames(page);
  expect(await page.evaluate(() => window.testTracker.currentImage())).toBeNull();
  expect(await page.evaluate(() => window.testTracker.debugDetection().entries.find((entry) => entry.element === 'img#page')?.reason)).toContain('Pinch zoom');
  await expect(page.locator('[data-mtp-root] .layer')).toHaveCount(0);
  await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await assertAligned(page, 'page');
  await session.detach();
});
