import { resolve } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

export async function startTracker(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#page-a').evaluate(async (node: HTMLImageElement) => node.decode());
  await page.addScriptTag({ path: resolve('work/browser-harness.js') });
  await page.evaluate(() => window.testTracker.start());
  await expect(page.locator('[data-mtp-root] .layer[data-source-element="page-a"]')).toHaveCount(1);
}

export async function frames(page: Page, count = 3): Promise<void> {
  await page.evaluate(async (amount) => {
    for (let index = 0; index < amount; index++) await new Promise<void>((done) => requestAnimationFrame(() => done()));
  }, count);
}

/** Oracle uses the fixture's unpadded, fill-sized image, not the tracking implementation. */
export async function alignmentError(page: Page, id: string): Promise<number> {
  return page.evaluate((sourceId) => {
    const source = document.getElementById(sourceId);
    const shadow = document.querySelector('[data-mtp-root]')?.shadowRoot;
    const layer = [...(shadow?.querySelectorAll<HTMLElement>('.layer') ?? [])]
      .find((item) => item.dataset['sourceElement'] === sourceId);
    const region = layer?.querySelector('[data-region-id="mock-1"]');
    if (!source || !region) return 1e6;
    const image = source.getBoundingClientRect();
    const box = region.getBoundingClientRect();
    return Math.max(
      Math.abs(box.x - image.x - image.width * 0.12),
      Math.abs(box.y - image.y - image.height * 0.15),
      Math.abs(box.width - image.width * 0.34),
      Math.abs(box.height - image.height * 0.11),
    );
  }, id);
}

export async function assertAligned(page: Page, id: string): Promise<number> {
  let measured = Infinity;
  await expect.poll(async () => { measured = await alignmentError(page, id); return measured; }).toBeLessThanOrEqual(2);
  return measured;
}

export async function recordMetrics(testInfo: TestInfo, values: Record<string, unknown>): Promise<void> {
  await testInfo.attach('tracking-metrics', { body: JSON.stringify(values, null, 2), contentType: 'application/json' });
}
