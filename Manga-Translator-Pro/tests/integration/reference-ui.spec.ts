import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';
import type { ChapterView } from '../../src/chapter/types';

function view(): ChapterView {
  return { session: { id: 'chapter-reference-ui', url: 'https://reader.test/chapter-1', documentIds: ['document-reference-ui'],
    createdAt: 1, updatedAt: 1, revision: 1, status: 'idle', endObserved: false, completeConfirmed: false, collectionNote: '',
    options: { concurrency: 2, maxAttempts: 3, glossary: '', overlayVisible: true, overlayBackground: 'dark', qualityMode: 'standard' } },
    images: [1, 2].map((order) => ({ id: `image-${order}`, chapterId: 'chapter-reference-ui', order, canonicalUrl: `https://cdn.test/${order}.png`,
      source: `https://cdn.test/${order}.png`, naturalWidth: 1000, naturalHeight: 1600, method: 'img', access: 'url',
      state: 'DISCOVERED', attempts: 0, priority: 0, updatedAt: 1 })),
    progress: { total: 2, discovered: 2, queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0, settled: 0, percent: 0 } };
}

async function mount(page: Page): Promise<void> {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { FloatingTranslatorController } from './src/ui/floating-translator';
    let view = ${JSON.stringify(view())}; const actions=[];
    const ui = new FloatingTranslatorController({onAction(action) {
      actions.push(action);
      if(action.command==='collect') view={...view,session:{...view.session,status:'collecting'}};
      if(action.command==='quick-translate') view={...view,session:{...view.session,status:'running'},progress:{...view.progress,active:2}};
      ui.update(view);
    }});
    ui.update(view);
    Object.assign(window,{referenceUITest:{ui,actions,update(patch){view={...view,...patch,session:{...view.session,...patch.session},progress:{...view.progress,...patch.progress}};ui.update(view)}}});
  ` }, bundle: true, write: false, format: 'iife', target: 'chrome120' });
  await page.goto('/tracking.html');
  await page.addScriptTag({ content: result.outputFiles[0]!.text });
}

test('compact counter/action and independent progress require trusted clicks, never change reader layout', async ({ page }, info) => {
  await page.goto('/tracking.html'); const original = await page.locator('#page-a').boundingBox();
  await mount(page);
  await expect(page.locator('[data-image-count]')).toHaveText('2 ảnh');
  await expect(page.locator('[data-quick-translate]')).toHaveText('Thu thập');
  expect(await page.locator('#page-a').boundingBox()).toEqual(original);
  const toolbar = await page.locator('.floating-toolbar').boundingBox();
  expect(toolbar!.y).toBeLessThan(150);
  expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(1200);
  await page.locator('[data-quick-translate]').evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => (window as unknown as { referenceUITest: { actions: unknown[] } }).referenceUITest.actions)).toEqual([]);
  await page.locator('[data-quick-translate]').click();
  await expect(page.locator('[data-quick-translate]')).toHaveText('Dịch AI');
  await expect(page.locator('[data-chapter-toast]')).toBeHidden();
  await page.locator('[data-quick-translate]').click();
  await expect(page.locator('.chapter-popover')).toBeHidden();
  await expect(page.locator('[data-chapter-toast]')).toBeVisible();
  await expect(page.locator('[data-toast-title]')).toHaveText('Đang dịch 0/2 ảnh');
  await expect(page.locator('.toast-detail')).toContainText('Đang xử lý 2');
  await expect(page.locator('.toast-progress')).toHaveAttribute('aria-valuetext', '0/2 ảnh đã xử lý');
  const toast = await page.locator('[data-chapter-toast]').boundingBox();
  expect(toast!.y).toBeGreaterThan(650);
  const actions = await page.evaluate(() => (window as unknown as { referenceUITest: { actions: { command: string }[] } }).referenceUITest.actions);
  expect(actions.map((action) => action.command)).toEqual(['collect', 'quick-translate']);
  await page.screenshot({ path: info.outputPath('reference-like-controls.png') });
  await info.attach('reference-like-controls', { path: info.outputPath('reference-like-controls.png'), contentType: 'image/png' });
  await page.evaluate(() => (window as unknown as { referenceUITest: { ui: { setAvailable(value: boolean): void } } }).referenceUITest.ui.setAvailable(false));
  await expect(page.locator('.floating-toolbar')).toBeHidden();
  await expect(page.locator('[data-chapter-toast]')).toBeHidden();
});

test('dismissing progress never cancels work and reopening details retains real failure counts', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => (window as unknown as { referenceUITest: { update(patch: unknown): void } }).referenceUITest.update({ session: { status: 'running' }, progress: { active: 1, completed: 0, failed: 1, settled: 1, percent: 50 } }));
  await expect(page.locator('[data-toast-title]')).toHaveText('Đang dịch 1/2 ảnh');
  await expect(page.locator('.toast-detail')).toContainText('Lỗi 1');
  await page.getByRole('button', { name: 'Ẩn thông báo tiến trình' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('[data-chapter-toast]')).toBeVisible();
  await page.getByRole('button', { name: 'Ẩn thông báo tiến trình' }).click();
  await expect(page.locator('[data-chapter-toast]')).toBeHidden();
  await page.evaluate(() => (window as unknown as { referenceUITest: { update(patch: unknown): void } }).referenceUITest.update({ progress: { completed: 1, active: 0, settled: 2, percent: 100 } }));
  await expect(page.locator('[data-chapter-toast]')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { referenceUITest: { actions: unknown[] } }).referenceUITest.actions)).toEqual([]);
  await page.locator('.launcher').click();
  await expect(page.locator('[data-chapter-counts]')).toContainText('Thất bại: 1');
});

test('small viewport offers explicit edit, display modes and review without claiming an inpainting engine', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 }); await mount(page);
  await page.evaluate(() => (window as unknown as { referenceUITest: { update(patch: unknown): void } }).referenceUITest.update({ session: { status: 'completed' }, progress: { completed: 2, settled: 2, percent: 100 } }));
  await page.locator('.launcher').click();
  await expect(page.locator('[data-chapter-command="edit"]')).toBeEnabled();
  await expect(page.locator('[aria-label="Nền bản dịch"]')).toHaveValue('dark');
  await expect(page.locator('option[value="restoration"]')).toBeDisabled();
  await expect(page.locator('.chapter-popover')).toBeVisible();
  const bounds = await page.locator('.chapter-popover').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.locator('[data-chapter-command="edit"]').click();
  await page.getByText('Tùy chọn dịch chương', { exact: true }).click();
  await page.locator('[aria-label="Chế độ nhận diện chữ"]').selectOption('review');
  await page.locator('[data-save-chapter-options]').click();
  const actions = await page.evaluate(() => (window as unknown as { referenceUITest: { actions: { command: string; value?: { qualityMode?: string } }[] } }).referenceUITest.actions);
  expect(actions).toContainEqual({ command: 'edit' });
  expect(actions.find((action) => action.command === 'options')?.value?.qualityMode).toBe('review');
  expect(await page.locator('[data-chapter-toast]').textContent()).not.toContain('4–5 phút');
});
