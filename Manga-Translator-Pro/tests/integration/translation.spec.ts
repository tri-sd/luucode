import { expect, test, type Page } from '@playwright/test';
import { frames, recordMetrics } from './helpers';

const valid = {
  coordinateSystem: 'normalized_1000', sourceLanguage: 'en',
  regions: [
    { id: 'dialogue-1', sourceText: "Let's begin!", translatedText: 'Chúng ta bắt đầu thôi!', bbox: [150, 120, 260, 460] },
    { id: 'dialogue-2', sourceText: 'Follow the image.', translatedText: 'Hãy theo dõi bức ảnh.', bbox: [570, 540, 690, 860] },
  ],
};
const envelope = (output: unknown) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] });

async function start(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#page-a').evaluate(async (image: HTMLImageElement) => image.decode());
  await page.addScriptTag({ path: 'work/translation-harness.js' });
  await page.evaluate(() => window.translationHarness.start());
  await expect.poll(() => page.evaluate(() => window.translationHarness.tracker.currentImage()?.source)).toContain('id=A');
}

test('mock Gemini: real image decode, JSON normalization, multiple Vietnamese overlays and unchanged tracking', async ({ page }, info) => {
  const providerRequests: { headers: Record<string, string>; body: string }[] = [];
  const imageKeys: (string | undefined)[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/panel.svg')) imageKeys.push(request.headers()['x-goog-api-key']);
  });
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    providerRequests.push({ headers: route.request().headers(), body: route.request().postData() ?? '' });
    await route.fulfill({ json: envelope(valid) });
  });
  await start(page);
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(0);
  const result = await page.evaluate(() => window.translationHarness.translate());
  expect(result.ok).toBe(true);
  const region = page.locator('[data-mtp-root] .layer[data-source-element="page-a"] .region').first();
  await expect(region).toContainText('Chúng ta bắt đầu thôi!');
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(2);
  expect(providerRequests).toHaveLength(1);
  expect(providerRequests[0]!.headers['x-goog-api-key']).toBe('FAKE_BROWSER_TEST_KEY_123456789');
  expect(providerRequests[0]!.body).not.toContain('FAKE_BROWSER_TEST_KEY');
  expect(JSON.parse(providerRequests[0]!.body).contents[0].parts[1].inlineData.mimeType).toBe('image/png');
  expect(imageKeys.every((key) => key === undefined)).toBe(true);
  const before = await page.locator('#page-a').boundingBox();
  await page.evaluate(() => window.scrollTo(0, 300));
  await frames(page);
  const error = await page.evaluate(() => {
    const image = document.querySelector('#page-a')!.getBoundingClientRect();
    const region = document.querySelector('[data-mtp-root]')!.shadowRoot!.querySelector('[data-source-element="page-a"] .region')!.getBoundingClientRect();
    return Math.max(Math.abs(region.x - image.x - image.width * 0.12), Math.abs(region.y - image.y - image.height * 0.15));
  });
  expect(error).toBeLessThanOrEqual(2);
  expect((await page.locator('#page-a').boundingBox())!.width).toBe(before!.width);
  await page.screenshot({ path: info.outputPath('mock-gemini-translation.png') });
  await info.attach('mock-gemini-translation', { path: info.outputPath('mock-gemini-translation.png'), contentType: 'image/png' });
  await recordMetrics(info, { mode: 'mock Gemini, real browser image/overlay pipeline', regions: 2, maxErrorCssPx: error });
});

for (const scenario of [
  { name: 'invalid JSON schema', body: envelope({ regions: [] }), code: 'INVALID_JSON' },
  { name: 'reversed coordinates', body: envelope({ ...valid, regions: [{ ...valid.regions[0], bbox: [300, 100, 100, 500] }] }), code: 'INVALID_COORDINATES' },
  { name: 'no text', body: envelope({ ...valid, regions: [] }), code: 'NO_TEXT' },
  { name: 'safety block', body: { promptFeedback: { blockReason: 'SAFETY' } }, code: 'SAFETY' },
  { name: 'quota', body: {}, code: 'QUOTA', status: 429 },
  { name: 'bad key', body: { error: { details: [{ reason: 'API_KEY_INVALID' }] } }, code: 'AUTH', status: 400 },
  { name: 'key permission restriction', body: { error: { details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }, code: 'PERMISSION', status: 403 },
]) {
  test(`mock Gemini: ${scenario.name} leaves no invented/partial overlay`, async ({ page }) => {
    await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({ json: scenario.body, status: scenario.status ?? 200 }));
    await start(page);
    const result = await page.evaluate(() => window.translationHarness.translate());
    expect(result).toMatchObject({ ok: false, code: scenario.code });
    expect(JSON.stringify(result)).not.toContain('FAKE_BROWSER_TEST_KEY');
    await expect(page.locator('[data-mtp-root] .region')).toHaveCount(0);
  });
}

test('mock Gemini: timeout aborts without rendering a partial response', async ({ page }) => {
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ json: envelope(valid) }).catch(() => undefined);
  });
  await start(page);
  expect(await page.evaluate(() => window.translationHarness.translate(40))).toMatchObject({ ok: false, code: 'TIMEOUT' });
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(0);
});

test('mock Gemini: source changed while the request is pending rejects the old result', async ({ page }) => {
  let called = false;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    called = true; await gate; await route.fulfill({ json: envelope(valid) });
  });
  await start(page);
  const pending = page.evaluate(() => window.translationHarness.translate());
  await expect.poll(() => called).toBe(true);
  await page.locator('#page-a').evaluate((image: HTMLImageElement) => { image.src = '/panel.svg?id=NEW'; });
  await page.locator('#page-a').evaluate(async (image: HTMLImageElement) => image.decode());
  finish();
  expect(await pending).toMatchObject({ ok: false, code: 'STALE_IMAGE' });
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(0);
});

test('mock Gemini: explicit cancel aborts the provider request', async ({ page }) => {
  let called = false;
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    called = true;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ json: envelope(valid) }).catch(() => undefined);
  });
  await start(page);
  const pending = page.evaluate(() => window.translationHarness.translate());
  await expect.poll(() => called).toBe(true);
  await page.evaluate(() => window.translationHarness.cancel());
  expect(await pending).toMatchObject({ ok: false, code: 'CANCELLED' });
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(0);
});

test('mock Gemini: long-image tiles are mapped to the full source without duplicates', async ({ page }) => {
  let requests = 0;
  await page.route('https://generativelanguage.googleapis.com/**', (route) => {
    requests++;
    return route.fulfill({ json: envelope({ ...valid, regions: [{ ...valid.regions[0], id: 'one', bbox: [150, 120, 260, 460] }] }) });
  });
  await start(page);
  await page.locator('#page-a').evaluate((image: HTMLImageElement) => { image.src = '/panel.svg?id=LONG&height=3600'; });
  await page.locator('#page-a').evaluate(async (image: HTMLImageElement) => image.decode());
  await frames(page);
  const result = await page.evaluate(() => window.translationHarness.translate());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(requests).toBe(2);
  expect(result.output.regions).toHaveLength(2);
  expect(result.output.regions[0]!.box.y).toBeCloseTo(2048 * 0.15 / 3600, 6);
  expect(result.output.regions[1]!.box.y).toBeCloseTo((1856 + 1744 * 0.15) / 3600, 6);
  expect(new Set(result.output.regions.map((region) => region.id)).size).toBe(2);
});

test('current-image selection follows the viewport without changing tracking geometry', async ({ page }) => {
  await start(page);
  await page.locator('#page-b').scrollIntoViewIfNeeded();
  await page.locator('#page-b').evaluate(async (image: HTMLImageElement) => image.decode());
  await frames(page);
  expect(await page.evaluate(() => window.translationHarness.tracker.currentImage()?.source)).toContain('id=B');
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(0);
});

test('image CDN failure never sends a Gemini request and does not invent an overlay', async ({ page }) => {
  let providerRequests = 0;
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => { providerRequests++; await route.fulfill({ json: envelope(valid) }); });
  await start(page);
  await page.route('**/panel.svg?id=A', (route) => route.fulfill({ status: 403, body: 'Access denied' }));
  expect(await page.evaluate(() => window.translationHarness.translate())).toMatchObject({ ok: false, code: 'IMAGE_ACCESS' });
  expect(providerRequests).toBe(0);
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(0);
});
