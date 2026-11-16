import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { assertAligned, frames, recordMetrics } from './helpers';

async function start(page: Page, count = 3, mode = ''): Promise<void> {
  await page.goto(`/chapter-content.html?chapter=A&count=${count}${mode ? `&mode=${mode}` : ''}`);
  await page.evaluate(async () => window.fixtureReady);
  await page.addScriptTag({ path: resolve('work/chapter-content-harness.js') });
  await expect(page.locator('[data-mtp-ui=chapter]')).toBeVisible();
}
async function collect(page: Page, count: number): Promise<void> {
  await page.evaluate(() => window.chapterContentHarness.controller.command('collect'));
  await expect.poll(() => page.evaluate(() => window.chapterContentHarness.controller.currentView()?.progress.total)).toBe(count);
}
async function translate(page: Page, count: number): Promise<void> {
  await page.evaluate(() => window.chapterContentHarness.controller.command('finish'));
  await page.evaluate(() => window.chapterContentHarness.controller.command('translate'));
  await page.evaluate(() => window.chapterContentHarness.waitForProcessing());
  await expect.poll(() => page.evaluate(() => window.chapterContentHarness.controller.currentView()?.progress.completed)).toBe(count);
}

test('50-image collection, full scroll and reverse scroll keep cached regions without repeated translation', async ({ page }, info) => {
  test.setTimeout(90_000);
  await start(page, 50);
  const original = await page.locator('#reader').evaluate((reader) => ({ html: reader.innerHTML, height: document.documentElement.scrollHeight }));
  await page.locator('[data-mtp-ui=chapter] .launcher').click();
  await expect.poll(() => page.evaluate(() => window.chapterContentHarness.controller.currentView()?.progress.total)).toBe(50);
  expect(await page.evaluate(() => window.chapterContentHarness.stats().providerCalls)).toBe(0);
  await page.locator('#page-49').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.chapterContentHarness.controller.flush());
  const collected = await page.evaluate(() => window.chapterContentHarness.view());
  expect(collected.images).toHaveLength(50);
  expect(collected.session.completeConfirmed).toBe(false);
  await translate(page, 50);
  const errors = [];
  for (const index of [...Array.from({ length: 50 }, (_, index) => index), 49, 40, 30, 20, 10, 0]) {
    await page.locator(`#page-${index}`).scrollIntoViewIfNeeded();
    errors.push(await assertAligned(page, `page-${index}`));
  }
  expect(await page.evaluate(() => window.chapterContentHarness.stats().providerCalls)).toBe(50);
  await expect(page.locator('[data-mtp-root]')).toHaveCount(1);
  expect(await page.locator('#reader').evaluate((reader) => reader.innerHTML)).toBe(original.html);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(original.height);
  await recordMetrics(info, { images: 50, scrollSamples: errors.length, maxErrorCssPx: Math.max(...errors), provider: 'mock chapter transport, not Gemini HTTP', repeatedTranslations: 0 });
});

test('late lazy image is retained after it is removed from the DOM', async ({ page }) => {
  await start(page); await collect(page, 3);
  await page.evaluate(async () => window.chapterFixture.add(3));
  await expect.poll(() => page.evaluate(() => window.chapterContentHarness.controller.currentView()?.progress.total)).toBe(4);
  await page.locator('#page-3').evaluate((image) => image.remove());
  await frames(page);
  await page.evaluate(() => window.chapterContentHarness.controller.flush());
  expect((await page.evaluate(() => window.chapterContentHarness.view())).images).toHaveLength(4);
  expect(await page.evaluate(() => window.chapterContentHarness.stats().providerCalls)).toBe(0);
});

test('DOM destruction and recreation restores the right regions from persistent cache', async ({ page }, info) => {
  await start(page); await collect(page, 3); await translate(page, 3);
  await page.locator('#page-0').scrollIntoViewIfNeeded(); await assertAligned(page, 'page-0');
  const previous = await page.evaluate(() => window.chapterContentHarness.tracker.bindingFor(document.querySelector('#page-0')!)!);
  await page.evaluate(async () => window.chapterFixture.remount(0));
  await expect.poll(() => page.evaluate(() => window.chapterContentHarness.tracker.bindingFor(document.querySelector('#page-0')!)?.instanceId)).not.toBe(previous.instanceId);
  const error = await assertAligned(page, 'page-0');
  expect(await page.evaluate(() => window.chapterContentHarness.stats().providerCalls)).toBe(3);
  await recordMetrics(info, { maxErrorCssPx: error, restoration: 'new DOM instance, same cached source' });
});

test('two DOM elements sharing one URL reuse one result and get separate overlay instances', async ({ page }) => {
  await start(page);
  await page.locator('#page-0').evaluate((image) => { const twin = image.cloneNode(true) as HTMLImageElement; twin.id = 'page-twin'; image.after(twin); });
  await page.locator('#page-twin').evaluate(async (image: HTMLImageElement) => image.decode());
  await collect(page, 3); await translate(page, 3);
  for (const id of ['page-0', 'page-twin', 'page-0', 'page-twin']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded(); await assertAligned(page, id);
    await expect(page.locator(`[data-mtp-root] .layer[data-source-element="${id}"]`)).toHaveCount(1);
  }
  const ids = await page.evaluate(() => ['page-0', 'page-twin'].map((id) => window.chapterContentHarness.tracker.bindingFor(document.getElementById(id)!)!.instanceId));
  expect(new Set(ids).size).toBe(2);
  expect(await page.evaluate(() => window.chapterContentHarness.stats().providerCalls)).toBe(3);
});

test('a chapter navigation during processing cannot display the previous chapter result', async ({ page }) => {
  await start(page, 8); await collect(page, 8);
  await page.evaluate(() => window.chapterContentHarness.setProviderDelay(50));
  await page.evaluate(() => window.chapterContentHarness.controller.command('finish'));
  await page.evaluate(() => window.chapterContentHarness.controller.command('translate'));
  const first = (await page.evaluate(() => window.chapterContentHarness.view())).session.id;
  await page.evaluate(async () => window.chapterFixture.navigate('B'));
  await expect.poll(() => page.evaluate(() => window.chapterContentHarness.controller.currentView()?.session.id)).not.toBe(first);
  await page.evaluate(() => window.chapterContentHarness.waitForProcessing());
  await frames(page);
  expect((await page.evaluate(() => window.chapterContentHarness.view())).session.url).toContain('chapter=B');
  expect((await page.evaluate(() => window.chapterContentHarness.view())).progress.total).toBe(0);
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(0);
});

test('refreshing a translated chapter restores IndexedDB results without invoking the provider', async ({ page }, info) => {
  await start(page); await collect(page, 3); await translate(page, 3);
  await page.reload(); await page.evaluate(async () => window.fixtureReady);
  await page.addScriptTag({ path: resolve('work/chapter-content-harness.js') });
  const error = await assertAligned(page, 'page-0');
  expect(await page.evaluate(() => window.chapterContentHarness.stats().providerCalls)).toBe(0);
  expect((await page.evaluate(() => window.chapterContentHarness.view())).progress.completed).toBe(3);
  await recordMetrics(info, { maxErrorCssPx: error, restoration: 'new page document, persisted IndexedDB, mocked service' });
});

test('controller and DOM runtime recreation preserves cached results and one floating controller', async ({ page }) => {
  await start(page); await collect(page, 3); await translate(page, 3);
  await page.evaluate(() => window.chapterContentHarness.recreateRuntime());
  await assertAligned(page, 'page-0');
  await expect(page.locator('[data-mtp-ui=chapter]')).toHaveCount(1);
  await expect(page.locator('[data-mtp-root]')).toHaveCount(1);
  expect(await page.evaluate(() => window.chapterContentHarness.stats().providerCalls)).toBe(3);
});

test('fixed reader page turns retain all seen URLs and restore the selected page', async ({ page }, info) => {
  await start(page, 1, 'fixed'); await collect(page, 1);
  for (const index of [1, 2, 3]) {
    await page.evaluate(async (value) => window.chapterFixture.turn(value), index);
    await expect.poll(() => page.evaluate(() => window.chapterContentHarness.controller.currentView()?.progress.total)).toBe(index + 1);
  }
  await translate(page, 4);
  const errors = [await assertAligned(page, 'page-0')];
  for (const index of [1, 3, 2, 1]) {
    await page.evaluate(async (value) => window.chapterFixture.turn(value), index);
    errors.push(await assertAligned(page, 'page-0'));
  }
  expect(await page.evaluate(() => window.chapterContentHarness.stats().providerCalls)).toBe(4);
  await expect(page.locator('[data-mtp-root] .layer')).toHaveCount(1);
  await recordMetrics(info, { maxErrorCssPx: Math.max(...errors), fixedPages: 4 });
});

test('resize and positive transforms keep source-normalized regions aligned', async ({ page }, info) => {
  await start(page); await collect(page, 3); await translate(page, 3);
  const errors = [];
  for (const width of [800, 1400, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#reader').evaluate((reader) => { reader.style.transformOrigin = 'top left'; reader.style.transform = 'translate3d(12px,8px,0) scale(.8)'; });
    await frames(page); errors.push(await assertAligned(page, 'page-0'));
  }
  await recordMetrics(info, { maxErrorCssPx: Math.max(...errors), viewportWidths: [800, 1400, 1200] });
});

test('hide/show and original-background mode preserve the cached translations', async ({ page }) => {
  await start(page); await collect(page, 3); await translate(page, 3);
  await assertAligned(page, 'page-0');
  await page.evaluate(() => window.chapterContentHarness.controller.command('visibility'));
  await expect(page.locator('[data-mtp-root]')).toHaveCSS('visibility', 'hidden');
  await page.evaluate(() => window.chapterContentHarness.controller.command('visibility'));
  await assertAligned(page, 'page-0');
  await page.evaluate(() => window.chapterContentHarness.controller.command('background', 'original'));
  await expect(page.locator('[data-mtp-root] .region').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await page.evaluate(() => window.chapterContentHarness.stats().providerCalls)).toBe(3);
});

test('external cache deletion accepts a fresh low revision and removes old overlays', async ({ page }) => {
  await start(page); await collect(page, 3); await translate(page, 3); await assertAligned(page, 'page-0');
  const revision = (await page.evaluate(() => window.chapterContentHarness.view())).session.revision;
  expect(revision).toBeGreaterThan(3);
  await page.evaluate(() => window.chapterContentHarness.clearExternal());
  await expect.poll(() => page.evaluate(() => window.chapterContentHarness.controller.currentView()?.progress.total)).toBe(0);
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(0);
  expect((await page.evaluate(() => window.chapterContentHarness.view())).session.revision).toBeLessThan(revision);
});

test('changing the translation profile hides incompatible cached output without provider calls', async ({ page }) => {
  await start(page); await collect(page, 3); await translate(page, 3); await assertAligned(page, 'page-0');
  await page.evaluate(() => window.chapterContentHarness.changeProfile());
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(0);
  expect(await page.evaluate(() => window.chapterContentHarness.stats().providerCalls)).toBe(3);
});
