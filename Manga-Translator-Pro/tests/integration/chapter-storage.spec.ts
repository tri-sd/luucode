import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function initialize(page: Page): Promise<void> {
  await page.goto('/');
  await page.addScriptTag({ path: resolve('work/chapter-storage-harness.js') });
}

test('real IndexedDB retains 50-image manifest and normalized translations across reload', async ({ page }, info) => {
  await initialize(page);
  const seeded = await page.evaluate(() => window.chapterStorage.seed());
  expect(seeded.view.images).toHaveLength(50);
  expect(seeded.view.progress).toMatchObject({ completed: 1, discovered: 49, total: 50 });
  await page.reload();
  await page.addScriptTag({ path: resolve('work/chapter-storage-harness.js') });
  const restored = await page.evaluate(() => window.chapterStorage.restore());
  expect(restored.view.session.id).toBe(seeded.view.session.id);
  expect(restored.view.images).toHaveLength(50);
  expect(restored.translation?.output.regions[0]).toMatchObject({ text: 'Chúng ta bắt đầu thôi.', box: { x: .12, y: .15, width: .34, height: .11 } });
  expect(restored.translation?.profile).toMatchObject({ model: 'gemini-mock', sourceLanguage: 'en', promptVersion: 'chapter-vision-v2' });
  await info.attach('registry-benchmark', { body: JSON.stringify({ imageCount: 50, collectAndPersistMs: seeded.durationMs, browser: 'Chromium; real IndexedDB; synthetic metadata; no Gemini calls' }), contentType: 'application/json' });
});

test('real Web Locks serialize chapter writes from independent extension-like contexts', async ({ page }) => {
  await initialize(page); await page.evaluate(() => window.chapterStorage.seed(1));
  expect(await page.evaluate(() => window.chapterStorage.hasWebLocks)).toBe(true);
  const other = await page.context().newPage();
  try {
    await initialize(other);
    await Promise.all([page.evaluate(() => window.chapterStorage.completeSlowly()), other.evaluate(() => window.chapterStorage.reobserve())]);
    const restored = await other.evaluate(() => window.chapterStorage.restore());
    expect(restored.view.images[0]).toMatchObject({ state: 'COMPLETED', attempts: 7, cacheKey: 'concurrent-checkpoint' });
  } finally { await other.close(); }
});

test('chapter deletion is atomic and preserves another chapter referencing shared translation', async ({ page }) => {
  await initialize(page); await page.evaluate(() => window.chapterStorage.seed(1));
  const result = await page.evaluate(() => window.chapterStorage.deleteIsolation());
  expect(result.deleted).toBeUndefined(); expect(result.oldImages).toEqual([]);
  expect(result.other.images).toHaveLength(1); expect(result.sharedTranslation?.output.regions).toHaveLength(1);
  expect(result.afterLastReference).toBeUndefined();
});

test('real IndexedDB excludes accidental credentials and bitmap fields', async ({ page }) => {
  await initialize(page);
  const result = await page.evaluate(() => window.chapterStorage.privateFieldProtection());
  expect(result).not.toContain('PRIVATE_FAKE_KEY_MUST_NOT_STORE'); expect(result).not.toContain('bitmap');
});
