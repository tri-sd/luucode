import { expect, test } from '@playwright/test';
import { assertAligned, frames, recordMetrics, startTracker } from './helpers';

const translated = [{ id: 'persisted', text: 'Bản dịch đã lưu', box: { x: .12, y: .15, width: .34, height: .11 } }];

test('DOM replacement has a new render binding and accepts restored normalized results only for that binding', async ({ page }, info) => {
  await startTracker(page);
  const original = await page.evaluate(() => window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!);
  expect(await page.evaluate(({ binding, regions }) => window.testTracker.applyRegions({ ...binding, regions }), { binding: original, regions: translated })).toBe(true);
  await expect(page.locator('[data-mtp-root] [data-source-element="page-a"] .region')).toHaveText('Bản dịch đã lưu');
  await page.locator('#page-a').evaluate((image) => { const replacement = image.cloneNode() as HTMLImageElement; image.replaceWith(replacement); });
  await page.locator('#page-a').evaluate(async (image: HTMLImageElement) => image.decode());
  await expect.poll(() => page.evaluate(() => window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)?.instanceId)).not.toBe(original.instanceId);
  expect(await page.evaluate(({ binding, regions }) => window.testTracker.applyRegions({ ...binding, regions }), { binding: original, regions: translated })).toBe(false);
  const restored = await page.evaluate((regions) => {
    const binding = window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!;
    return window.testTracker.applyRegions({ ...binding, regions });
  }, translated);
  expect(restored).toBe(true);
  await expect(page.locator('[data-mtp-root] [data-source-element="page-a"] .region')).toHaveText('Bản dịch đã lưu');
  const error = await page.evaluate(() => {
    const source = document.querySelector('#page-a')!.getBoundingClientRect();
    const overlay = document.querySelector('[data-mtp-root]')!.shadowRoot!.querySelector('[data-source-element="page-a"] .region')!.getBoundingClientRect();
    return Math.max(Math.abs(overlay.x-source.x-source.width*.12), Math.abs(overlay.y-source.y-source.height*.15),
      Math.abs(overlay.width-source.width*.34), Math.abs(overlay.height-source.height*.11));
  });
  expect(error).toBeLessThanOrEqual(2);
  await recordMetrics(info, { maxErrorCssPx: error, restoration: 'caller-owned cached regions, new DOM binding' });
});

test('candidate subscription is initial, source-aware, unique and releases detached DOM snapshots', async ({ page }) => {
  await startTracker(page);
  await page.evaluate(() => {
    const counts: number[] = [];
    const unsubscribe = window.testTracker.subscribeImages((images) => { counts.push(images.length); });
    Object.assign(window, { candidateCounts: counts, unsubscribeCandidates: unsubscribe });
  });
  const initial = await page.evaluate(() => (window as unknown as { candidateCounts: number[] }).candidateCounts.length);
  expect(initial).toBe(1);
  await page.evaluate(() => window.testTracker.refresh());
  expect(await page.evaluate(() => (window as unknown as { candidateCounts: number[] }).candidateCounts.length)).toBe(1);
  await page.locator('#page-a').evaluate((image) => image.remove());
  await expect.poll(() => page.evaluate(() => (window as unknown as { candidateCounts: number[] }).candidateCounts.length)).toBe(2);
  expect(await page.evaluate(() => window.testTracker.bindings().some(({ candidate }) => candidate.element.id === 'page-a'))).toBe(false);
  await page.evaluate(() => window.testTracker.stop());
  expect(await page.evaluate(() => (window as unknown as { candidateCounts: number[] }).candidateCounts.at(-1))).toBe(0);
  await page.evaluate(() => (window as unknown as { unsubscribeCandidates: () => void }).unsubscribeCandidates());
  const before = await page.evaluate(() => (window as unknown as { candidateCounts: number[] }).candidateCounts.length);
  await page.evaluate(() => window.testTracker.start());
  expect(await page.evaluate(() => (window as unknown as { candidateCounts: number[] }).candidateCounts.length)).toBe(before);
});

test('overlay visibility preserves translated data and composes with capture hiding and original background', async ({ page }) => {
  await startTracker(page);
  await page.evaluate((regions) => {
    const binding = window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!;
    window.testTracker.applyRegions({ ...binding, regions });
    window.testTracker.setOverlayOptions({ visible: false });
  }, translated);
  await expect(page.locator('[data-mtp-root]')).toHaveCSS('visibility', 'hidden');
  await page.evaluate(() => { window.testTracker.hideOverlay(true); window.testTracker.setOverlayOptions({ visible: true, background: 'original' }); });
  await expect(page.locator('[data-mtp-root]')).toHaveCSS('visibility', 'hidden');
  await page.evaluate(() => window.testTracker.hideOverlay(false));
  const region = page.locator('[data-mtp-root] [data-source-element="page-a"] .region');
  await expect(region).toHaveText('Bản dịch đã lưu');
  await expect(region).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.evaluate(() => { window.testTracker.setOverlayOptions({ visible: false }); window.testTracker.hideOverlay(true); window.testTracker.hideOverlay(false); });
  await expect(page.locator('[data-mtp-root]')).toHaveCSS('visibility', 'hidden');
  await page.evaluate(() => window.testTracker.setOverlayOptions({ visible: true, background: 'mask' }));
  await expect(region).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.95)');
  await page.evaluate(() => window.testTracker.clearRegions());
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(0);
});

test('Vietnamese text shrinks to its source box without changing geometry or refitting on scroll', async ({ page }, info) => {
  await startTracker(page);
  const text = 'Chúng ta cần giữ nguyên tên nhân vật và cách xưng hô xuyên suốt chương truyện này. '.repeat(8);
  await page.evaluate((value) => {
    const binding = window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!;
    window.testTracker.applyRegions({ ...binding, regions: [{ id: 'mock-1', text: value, box: { x: .12, y: .15, width: .34, height: .11 } }] });
  }, text);
  const fits = async (): Promise<boolean> => page.evaluate(() => {
    const region = document.querySelector('[data-mtp-root]')?.shadowRoot?.querySelector<HTMLElement>('[data-source-element="page-a"] .region');
    const text = region?.querySelector<HTMLElement>('.text');
    return Boolean(region && text && text.scrollWidth <= region.clientWidth-6 && text.scrollHeight <= region.clientHeight-6);
  });
  await expect(page.locator('[data-mtp-root] [data-source-element="page-a"] .region')).toHaveCount(1);
  await page.locator('[data-mtp-root]').evaluate((root) => root.remove());
  await expect.poll(fits).toBe(true);
  const error = await assertAligned(page, 'page-a');
  const font = await page.locator('[data-mtp-root] [data-source-element="page-a"] .region').evaluate((region) => parseFloat(getComputedStyle(region).fontSize));
  expect(font).toBeLessThan(20);
  await frames(page, 10);
  await page.evaluate(() => {
    const region = document.querySelector('[data-mtp-root]')!.shadowRoot!.querySelector('[data-source-element="page-a"] .region')!;
    let fontWrites = 0;
    const observer = new MutationObserver((records) => { fontWrites += records.length; Object.assign(window, { fontWrites }); });
    observer.observe(region, { attributes: true, attributeFilter: ['style'] });
    Object.assign(window, { fitObserver: observer, fontWrites });
  });
  for (const top of [40, 80, 30, 0]) { await page.evaluate((y) => window.scrollTo(0,y), top); await frames(page); }
  expect(await page.evaluate(() => (window as unknown as { fontWrites: number }).fontWrites)).toBe(0);
  await page.evaluate(() => (window as unknown as { fitObserver: MutationObserver }).fitObserver.disconnect());
  await page.setViewportSize({ width: 650, height: 900 });
  await expect.poll(fits).toBe(true);
  await assertAligned(page, 'page-a');
  await recordMetrics(info, { maxErrorCssPx: error, fittedFontCssPx: font, fontWritesDuringScroll: 0 });
});

test('applying identical cached regions twice preserves the mounted overlay without flicker or duplicate layers', async ({ page }) => {
  await startTracker(page);
  await page.evaluate((regions) => {
    const binding = window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!;
    window.testTracker.applyRegions({ ...binding, regions });
  }, translated);
  await expect(page.locator('[data-mtp-root] [data-source-element="page-a"] .region')).toHaveText('Bản dịch đã lưu');
  const sameNode = await page.evaluate((regions) => {
    const binding = window.testTracker.bindingFor(document.querySelector<HTMLElement>('#page-a')!)!;
    const shadow = document.querySelector('[data-mtp-root]')!.shadowRoot!;
    const before = shadow.querySelector('[data-source-element="page-a"] .region');
    window.testTracker.applyRegions({ ...binding, regions: structuredClone(regions) });
    return before === shadow.querySelector('[data-source-element="page-a"] .region');
  }, translated);
  expect(sameNode).toBe(true);
  await expect(page.locator('[data-mtp-root] [data-source-element="page-a"]')).toHaveCount(1);
});
