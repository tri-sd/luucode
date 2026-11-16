import { expect, test, type Page } from '@playwright/test';
import { frames, recordMetrics } from './helpers';

const output = { coordinateSystem: 'normalized_1000', sourceLanguage: 'en', regions: [
  { id: 'dialogue-1', sourceText: 'SOURCE', translatedText: 'Bản dịch kiểm thử chương', bbox: [150,120,260,460] },
] };
const envelope = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] };
async function open(page: Page): Promise<void> {
  await page.goto('/chapter-pipeline.html');
  await page.locator('#page-a').evaluate(async (image: HTMLImageElement) => image.decode());
  await page.addScriptTag({ path: 'work/chapter-pipeline-harness.js' });
  await expect.poll(() => page.evaluate(() => window.chapterPipeline.view().then((view) => view.images.length))).toBe(0);
}
async function mock(page: Page, fail?: (request: number) => number | undefined) {
  const state = { requests: 0, active: 0, maxActive: 0, prompts: [] as string[] };
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    state.requests++; const index = state.requests; state.active++; state.maxActive = Math.max(state.maxActive, state.active);
    state.prompts.push(route.request().postDataJSON().contents[0].parts[0].text as string);
    await new Promise((done) => setTimeout(done, 8));
    const status = fail?.(index) ?? 200;
    await route.fulfill({ status, json: status === 200 ? envelope : {}, headers: status === 429 ? { 'Retry-After': '0.01' } : {} }).catch(() => undefined);
    state.active--;
  });
  return state;
}
async function translate(page: Page) {
  await page.evaluate(() => window.chapterPipeline.command('finish'));
  await page.evaluate(() => window.chapterPipeline.command('translate'));
  return page.evaluate(() => window.chapterPipeline.wait());
}

test('50 pages: metadata collection sends no Gemini, queue persists results, renderer restores after reload', async ({ page }, info) => {
  const provider = await mock(page); await open(page);
  await page.evaluate(() => window.chapterPipeline.collect(50));
  expect(provider.requests).toBe(0);
  const start = performance.now();
  const completed = await translate(page);
  expect(completed.progress.completed).toBe(50); expect(provider.requests).toBe(50); expect(provider.maxActive).toBeLessThanOrEqual(2);
  expect(provider.prompts.some((prompt) => prompt.includes('Bản dịch kiểm thử chương'))).toBe(true);
  await expect(page.locator('[data-mtp-root] .region').first()).toContainText('Bản dịch kiểm thử chương');
  const translationMs = performance.now() - start;
  await page.reload();
  await page.locator('#page-a').evaluate(async (image: HTMLImageElement) => image.decode());
  await page.addScriptTag({ path: 'work/chapter-pipeline-harness.js' });
  await expect(page.locator('[data-mtp-root] [data-source-element="page-a"] .region')).toContainText('Bản dịch kiểm thử chương');
  expect(provider.requests).toBe(50);
  await page.evaluate(() => window.scrollTo(0, 580)); await frames(page);
  const error = await page.evaluate(() => {
    const image = document.querySelector('#page-b')!.getBoundingClientRect();
    const region = document.querySelector('[data-mtp-root]')!.shadowRoot!.querySelector('[data-source-element="page-b"] .region')!.getBoundingClientRect();
    return Math.max(Math.abs(region.x-image.x-image.width*.12),Math.abs(region.y-image.y-image.height*.15));
  });
  expect(error).toBeLessThanOrEqual(2);
  await recordMetrics(info, { images: 50, mockProviderRequests: provider.requests, maxConcurrentRequests: provider.maxActive, mockPipelineMs: translationMs, maxErrorCssPx: error, realGemini: false });
});

test('100-image benchmark keeps metadata and releases image bitmaps between bounded requests', async ({ page }, info) => {
  test.setTimeout(60_000);
  const provider = await mock(page); await open(page);
  const collectStart = performance.now();
  await page.evaluate(() => window.chapterPipeline.collect(100));
  const collectionMs = performance.now() - collectStart;
  const start = performance.now(); const view = await translate(page); const pipelineMs = performance.now() - start;
  expect(view.progress.completed).toBe(100); expect(provider.requests).toBe(100); expect(provider.maxActive).toBeLessThanOrEqual(2);
  const stats = await page.evaluate(() => window.chapterPipeline.stats());
  await recordMetrics(info, { images: 100, collectionMs, mockPipelineMs: pipelineMs, metadataBytes: stats.persistedBytes,
    mockProviderRequests: provider.requests, maxConcurrentRequests: provider.maxActive, realGemini: false, bitmapRetention: 'none in IndexedDB; decode at most 2 queue images' });
});

test('different URLs for identical bytes share a single Gemini request', async ({ page }) => {
  const provider = await mock(page); await open(page);
  await page.evaluate(() => window.chapterPipeline.closeClient());
  await page.evaluate(() => window.chapterPipeline.sources(['/panel.svg?id=SAME&width=400&height=640&alias=1', '/panel.svg?id=SAME&width=400&height=640&alias=2']));
  const view = await translate(page);
  expect(view.progress.completed).toBe(2); expect(provider.requests).toBe(1);
  expect(view.images[0]!.cacheKey).toBe(view.images[1]!.cacheKey);
});

test('429 is retried with cooldown and remaining images complete independently', async ({ page }) => {
  const provider = await mock(page, (count) => count === 1 ? 429 : undefined); await open(page);
  await page.evaluate(() => window.chapterPipeline.collect(6));
  const view = await translate(page);
  expect(view.progress.completed).toBe(6); expect(view.progress.failed).toBe(0); expect(provider.requests).toBe(7);
  expect(view.images.some((image) => image.attempts === 2)).toBe(true);
});

test('35 images finish as 30 completed and 5 failed, retry sends only failed images', async ({ page }) => {
  let failuresEnabled = true;
  const provider = await mock(page, (count) => failuresEnabled && count % 7 === 0 ? 400 : undefined); await open(page);
  await page.evaluate(() => window.chapterPipeline.collect(35));
  const view = await translate(page);
  expect(view.progress.completed).toBe(30); expect(view.progress.failed).toBe(5); expect(provider.requests).toBe(35);
  failuresEnabled = false;
  await page.evaluate(() => window.chapterPipeline.command('retry'));
  const retried = await page.evaluate(() => window.chapterPipeline.wait());
  expect(retried.progress.completed).toBe(35); expect(provider.requests).toBe(40);
});

test('recreating the service adapter and closing its UI leaves the live executor queue intact', async ({ page }) => {
  const provider = await mock(page); await open(page);
  await page.evaluate(() => window.chapterPipeline.collect(12));
  await page.evaluate(() => window.chapterPipeline.command('finish'));
  await page.evaluate(() => window.chapterPipeline.command('translate'));
  await page.evaluate(() => window.chapterPipeline.restartService());
  await page.evaluate(() => window.chapterPipeline.closeClient());
  const view = await page.evaluate(() => window.chapterPipeline.wait());
  expect(view.progress.completed).toBe(12); expect(provider.requests).toBe(12);
  await page.evaluate(() => window.chapterPipeline.reopenClient());
  await expect(page.locator('[data-mtp-root] [data-source-element="page-a"] .region')).toContainText('Bản dịch kiểm thử chương');
});

test('recreated executor resumes checkpoints without sending completed images again', async ({ page }) => {
  const provider = await mock(page); await open(page);
  await page.evaluate(() => window.chapterPipeline.collect(15));
  await page.evaluate(() => window.chapterPipeline.command('finish'));
  await page.evaluate(() => window.chapterPipeline.command('translate'));
  await expect.poll(() => page.evaluate(() => window.chapterPipeline.stats().then((stats) => stats.completed))).toBeGreaterThanOrEqual(2);
  const done = await page.evaluate(() => window.chapterPipeline.stats().then((stats) => stats.attempts.filter((item) => item.state === 'COMPLETED')));
  await page.evaluate(() => window.chapterPipeline.restartExecutor());
  await page.evaluate(() => window.chapterPipeline.command('resume'));
  const view = await page.evaluate(() => window.chapterPipeline.wait());
  expect(view.progress.completed).toBe(15);
  for (const previous of done) expect(view.images.find((image) => image.id === previous.id)?.attempts).toBe(previous.attempts);
  expect(provider.maxActive).toBeLessThanOrEqual(2);
});
