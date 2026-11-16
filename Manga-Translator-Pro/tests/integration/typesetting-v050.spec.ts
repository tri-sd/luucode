import { expect, test } from '@playwright/test';
import { assertAligned, frames, recordMetrics, startTracker } from './helpers';

const region = { id: 'mock-1', text: 'Bản dịch tiếng Việt giữ đúng vùng thoại.', box: { x: .12, y: .15, width: .34, height: .11 },
  polygon: [{ x: .12, y: .15 }, { x: .46, y: .15 }, { x: .43, y: .26 }, { x: .12, y: .26 }],
  ocrConfidence: .92, positionConfidence: .95, kind: 'dialogue' as const, direction: 'vertical' as const };

// Production geometry/renderer, synthetic source and known normalized region; no OCR score is inferred.
test('polygon-clipped dark typesetting stays source-normalized while scrolling and resizing', async ({ page }, info) => {
  await startTracker(page);
  await page.evaluate((value) => {
    const binding = window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!;
    window.testTracker.setOverlayOptions({ background: 'dark' });
    window.testTracker.applyRegions({ ...binding, regions: [value] });
  }, region);
  const overlay = page.locator('[data-mtp-root] [data-source-element="page-a"] .region');
  await expect(overlay).toHaveCSS('background-color', 'rgb(23, 25, 28)');
  await expect(overlay).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(overlay).toHaveCSS('clip-path', /polygon\(/);
  await expect(overlay).toHaveAttribute('data-source-direction', 'vertical');
  const errors = [];
  for (const top of [0, 150, 300, 70, 0]) {
    await page.evaluate((value) => window.scrollTo(0, value), top); await frames(page);
    errors.push(await assertAligned(page, 'page-a'));
  }
  for (const width of [700, 1300, 1000]) {
    await page.setViewportSize({ width, height: 900 }); await frames(page); errors.push(await assertAligned(page, 'page-a'));
  }
  await expect(overlay).toHaveAttribute('data-ocr-confidence', '0.92');
  await recordMetrics(info, { maxErrorCssPx: Math.max(...errors), polygon: true, sourceLanguageDirection: 'vertical', renderer: 'dark fast fill, not inpainting' });
});

test('adaptive fill uses safe estimated background and preserves a conservative fallback for textured regions', async ({ page }) => {
  await startTracker(page);
  await page.evaluate((value) => {
    const binding = window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!;
    window.testTracker.setOverlayOptions({ background: 'adaptive' });
    window.testTracker.applyRegions({ ...binding, regions: [{ ...value, backgroundColor: '#202028', backgroundVariance: .01 }] });
  }, region);
  const overlay = page.locator('[data-mtp-root] [data-source-element="page-a"] .region');
  await expect(overlay).toHaveCSS('background-color', 'rgb(32, 32, 40)');
  await expect(overlay).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.evaluate((value) => {
    const binding = window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!;
    window.testTracker.applyRegions({ ...binding, regions: [{ ...value, backgroundColor: '#202028', backgroundVariance: .8 }] });
  }, region);
  await expect(overlay).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.evaluate(() => window.testTracker.setOverlayOptions({ background: 'original' }));
  await expect(overlay).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('uncertain location is hidden until edit mode; own editable overlay does not occlude the image', async ({ page }) => {
  await startTracker(page);
  await page.evaluate(() => {
    const selections: unknown[] = [];
    window.testTracker.subscribeRegionSelection((selection) => selections.push(selection));
    Object.assign(window, { typesettingSelections: selections });
    const binding = window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!;
    window.testTracker.applyRegions({ ...binding, regions: [{ id: 'uncertain', text: 'Vị trí cần xác minh', box: { x: 0, y: 0, width: 1, height: 1 }, positionConfidence: .2, ocrConfidence: .99 }] });
  });
  const overlay = page.locator('[data-mtp-root] [data-source-element="page-a"] .region');
  await expect(overlay).toHaveCount(0);
  await page.evaluate(() => window.testTracker.setEditMode(true));
  await expect(overlay).toHaveCount(1); await frames(page, 12);
  await expect(overlay).toHaveCount(1);
  expect(await page.evaluate(() => window.testTracker.currentImage()?.source)).toContain('id=A');
  await overlay.evaluate((node) => (node as HTMLDivElement).click());
  expect(await page.evaluate(() => (window as unknown as { typesettingSelections: unknown[] }).typesettingSelections.length)).toBe(0);
  await overlay.click({ position: { x: 50, y: 50 } });
  expect(await page.evaluate(() => (window as unknown as { typesettingSelections: { regionId: string }[] }).typesettingSelections[0]?.regionId)).toBe('uncertain');
  await page.evaluate(() => {
    const binding = window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!;
    window.testTracker.applyRegions({ ...binding, regions: [{ id: 'uncertain', text: 'Đã sửa thủ công', box: { x: 0, y: 0, width: 1, height: 1 }, positionConfidence: .2, edited: true }] });
    window.testTracker.setEditMode(false);
  });
  await expect(overlay).toHaveText('Đã sửa thủ công');
  await expect(overlay).toHaveCSS('pointer-events', 'none');
});

test('polygon projection uses CSS pixels without multiplying devicePixelRatio twice', async ({ browser }, info) => {
  const errors = [];
  for (const dpr of [1.25, 1.5, 2]) {
    const context = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1100, height: 900 }, baseURL: 'http://127.0.0.1:4173' });
    const page = await context.newPage();
    try {
      await startTracker(page);
      await page.evaluate((value) => {
        const binding = window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!;
        window.testTracker.applyRegions({ ...binding, regions: [value] });
      }, region);
      await frames(page); errors.push(await assertAligned(page, 'page-a'));
    } finally { await context.close(); }
  }
  await recordMetrics(info, { maxErrorCssPx: Math.max(...errors), devicePixelRatios: [1.25, 1.5, 2], polygon: true });
});

test('unreadably small fitted text is flagged separately from geometric overflow', async ({ page }) => {
  await startTracker(page);
  await page.evaluate(() => {
    const binding = window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!;
    window.testTracker.applyRegions({ ...binding, regions: [{ id: 'tiny', text: 'Văn bản dài cần người đọc biên tập để dễ đọc. '.repeat(20), box: { x: .12, y: .15, width: .2, height: .04 } }] });
  });
  const overlay = page.locator('[data-mtp-root] [data-source-element="page-a"] .region');
  await expect(overlay).toHaveAttribute('data-fit-state', 'small-text');
  expect(await overlay.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeLessThan(8);
  const bounds = await overlay.boundingBox();
  expect(bounds?.width).toBeLessThan(200);
});
