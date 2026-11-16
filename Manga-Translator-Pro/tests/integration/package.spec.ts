import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertAligned, frames, recordMetrics } from './helpers';

test('production manifest declares MV3, minimal permissions and existing entrypoints', async () => {
  const root = resolve('.output/chrome-mv3');
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')) as chrome.runtime.ManifestV3;
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions?.sort()).toEqual(['activeTab', 'offscreen', 'scripting', 'storage']);
  expect(manifest.host_permissions).toEqual(['https://generativelanguage.googleapis.com/*']);
  expect(manifest.optional_host_permissions?.sort()).toEqual(['http://*/*', 'https://*/*']);
  expect(manifest.content_scripts ?? []).toEqual([]);
  for (const path of [manifest.background!.service_worker!, manifest.options_ui!.page, manifest.action!.default_popup!, 'offscreen.html', 'content-scripts/tracking.js']) {
    expect((await stat(resolve(root, path))).isFile()).toBe(true);
  }
  expect(manifest.options_ui!.open_in_tab).toBe(true);
});

test('built Tracking Lab runs in browser, uses local assets and renders no duplicate overlays', async ({ page }, info) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/options.html');
  await page.getByRole('button', { name: 'Bật vùng chữ giả lập' }).click();
  const errorsPx = [await assertAligned(page, 'demo-a')];
  await page.getByRole('button', { name: 'Thêm / bỏ khoảng trống' }).click();
  await frames(page);
  errorsPx.push(await assertAligned(page, 'demo-a'));
  await page.getByRole('button', { name: 'Thêm / bỏ khoảng trống' }).click();
  await page.getByRole('button', { name: 'Thêm ảnh mới' }).click();
  await expect(page.locator('#demo-added-1')).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, 330));
  await frames(page);
  errorsPx.push(await assertAligned(page, 'demo-a'));
  await expect(page.locator('[data-mtp-root]')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('tracking-lab.png') });
  await info.attach('tracking-lab', { path: info.outputPath('tracking-lab.png'), contentType: 'image/png' });
  expect(errors).toEqual([]);
  expect(requests.every((url) => new URL(url).hostname === '127.0.0.1')).toBe(true);
  await recordMetrics(info, { maxErrorCssPx: Math.max(...errorsPx), externalRequests: 0, mode: 'production bundle served over HTTP, not installed extension' });
});
