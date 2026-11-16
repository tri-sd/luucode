import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';
import { assertAligned, frames, recordMetrics } from './helpers';

let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let profile: string;

test.beforeAll(async () => {
  profile = await mkdtemp(resolve('work/chromium-profile-'));
  const executablePath = process.env['CHROMIUM_PATH'] ?? (existsSync('/usr/lib/chromium/chromium')
    ? '/usr/lib/chromium/chromium' : existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const extensionPath = resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext(profile, {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1200, height: 900 },
    args: ['--no-sandbox', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  const available = context.serviceWorkers()[0]
    ?? await context.waitForEvent('serviceworker', { timeout: 5_000 }).catch(() => undefined);
  if (!available) {
    // Never weaken or bypass a managed browser's extension policy to run tests.
    const policyText = await readFile('/etc/chromium/policies/managed/extensions.json', 'utf8').catch(() => null);
    const policy = policyText ? JSON.parse(policyText) as { ExtensionInstallBlocklist?: string[] } : null;
    test.skip(Boolean(policy?.ExtensionInstallBlocklist?.includes('*')),
      'Blocked by managed Chromium policy ExtensionInstallBlocklist=["*"]. Requires an authorized browser that permits this unpacked extension.');
    throw new Error('MV3 service worker did not start; inspect extension loading errors.');
  }
  worker = available;
  extensionId = new URL(worker.url()).hostname;
});

test.afterAll(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

test('production MV3 package loads with minimal permissions and includes its Tracking Lab', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions?.sort()).toEqual(['activeTab', 'offscreen', 'scripting', 'storage']);
  expect(manifest.host_permissions).toEqual(['https://generativelanguage.googleapis.com/*']);
  expect(manifest.content_scripts ?? []).toEqual([]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('button', { name: 'Bật vùng chữ giả lập' }).click();
  await expect(page.locator('[data-mtp-root] .layer[data-source-element="demo-a"]')).toHaveCount(1);
  await assertAligned(page, 'demo-a');
  await page.getByRole('button', { name: 'Thêm / bỏ khoảng trống' }).click();
  await frames(page);
  const error = await assertAligned(page, 'demo-a');
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('extension-tracking-lab.png'), fullPage: false });
  await info.attach('extension-tracking-lab', { path: info.outputPath('extension-tracking-lab.png'), contentType: 'image/png' });
  await recordMetrics(info, { browser: context.browser()?.version(), manifestVersion: 3, maxErrorCssPx: error });
  await page.close();
});

test('real tabs.setZoom at 80, 100, 125 and 150 percent preserves alignment', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('button', { name: 'Bật vùng chữ giả lập' }).click();
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]!.id!;
  });
  const errors: number[] = [];
  for (const zoom of [0.8, 1, 1.25, 1.5, 1]) {
    await worker.evaluate(async ({ id, factor }) => chrome.tabs.setZoom(id, factor), { id: tabId, factor: zoom });
    expect(await worker.evaluate(async (id) => chrome.tabs.getZoom(id), tabId)).toBeCloseTo(zoom, 2);
    await frames(page);
    errors.push(await assertAligned(page, 'demo-a'));
  }
  await recordMetrics(info, { browserZoomFactors: [0.8, 1, 1.25, 1.5, 1], maxErrorCssPx: Math.max(...errors) });
  await page.close();
});

test('packaged popup inspects the current image and does not translate without a configured key', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('#page-a').evaluate(async (image: HTMLImageElement) => image.decode());
  await page.bringToFront();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('#translate')).toBeDisabled();
  await expect(popup.locator('#config-summary')).toContainText('Chưa cấu hình');
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(0);
  await popup.close();
  await page.close();
});
