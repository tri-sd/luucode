import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import type { ChapterView } from '../../src/chapter/types';

function fixtureView(): ChapterView {
  return {
    session: { id: 'chapter-ui-test', url: 'https://reader.example/chapter/1', documentIds: ['document-ui-test'], createdAt: 1, updatedAt: 1,
      revision: 1, status: 'ready', endObserved: true, completeConfirmed: true, collectionNote: '',
      options: { concurrency: 2, maxAttempts: 3, glossary: '', overlayVisible: true, overlayBackground: 'mask' } },
    images: [1, 2].map((order) => ({ id: `image-${order}`, chapterId: 'chapter-ui-test', order, canonicalUrl: `https://cdn.example/${order}.png`, source: `https://cdn.example/${order}.png`,
      naturalWidth: 1000, naturalHeight: 1600, method: 'img', access: 'url', state: 'DISCOVERED', attempts: 0, priority: 0, updatedAt: 1 })),
    progress: { total: 2, discovered: 2, queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0, settled: 0, percent: 0 },
  };
}

test('floating translator collects without translation, drags without triggering a click and keeps layout', async ({ page }, info) => {
  const bundled = await build({
    stdin: { contents: `import { FloatingTranslatorController } from './src/ui/floating-translator';
      let view = ${JSON.stringify({ ...fixtureView(), session: { ...fixtureView().session, status: 'idle', completeConfirmed: false, endObserved: false } })};
      const actions = [];
      const ui = new FloatingTranslatorController({onAction: (action) => {
        actions.push(action);
        view = { ...view, session: { ...view.session, status: action.command === 'collect' ? 'collecting' : action.command === 'finish' ? 'ready' : view.session.status } };
        ui.update(view);
      }}); ui.update(view); Object.assign(window, {chapterUITest: {ui, actions}});`,
      resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', target: 'chrome120',
  });
  await page.goto('/tracking.html');
  const before = await page.locator('#page-a').boundingBox();
  await page.addScriptTag({ content: bundled.outputFiles[0]!.text });
  const launcher = page.locator('[data-mtp-ui] .launcher');
  await expect(launcher).toHaveText('🌐 Dịch truyện');
  await page.locator('[data-mtp-ui]').evaluate((host) => {
    const shadow = host.shadowRoot!;
    shadow.querySelector<HTMLButtonElement>('.launcher')!.click();
    for (const command of ['collect', 'finish', 'translate', 'clear']) shadow.querySelector<HTMLButtonElement>(`[data-chapter-command="${command}"]`)!.click();
    const background = shadow.querySelector<HTMLSelectElement>('[aria-label="Nền bản dịch"]')!;
    background.value = 'original'; background.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(await page.evaluate(() => (window as unknown as { chapterUITest: { actions: unknown[] } }).chapterUITest.actions)).toEqual([]);
  await expect(launcher).toHaveAttribute('aria-expanded', 'false');
  const box = await launcher.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x - 220, box!.y - 200, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as { chapterUITest: { actions: unknown[] } }).chapterUITest.actions)).toEqual([]);
  await launcher.click();
  await expect(page.locator('[data-mtp-ui] [data-chapter-heading]')).toContainText('Đang thu thập ảnh');
  await expect(page.locator('[data-mtp-ui] .chapter-hint').first()).toContainText('Cuộn đến cuối chương');
  await page.locator('[data-mtp-ui] [data-chapter-command="finish"]').click();
  await expect(page.locator('[data-mtp-ui] [data-chapter-heading]')).toContainText('Bắt đầu dịch toàn bộ chương?');
  await page.locator('[data-mtp-ui]').evaluate((host) => {
    for (const command of ['translate', 'clear']) host.shadowRoot!.querySelector<HTMLButtonElement>(`[data-chapter-command="${command}"]`)!.click();
  });
  const actions = await page.evaluate(() => (window as unknown as { chapterUITest: { actions: { command: string }[] } }).chapterUITest.actions);
  expect(actions.map((action) => action.command)).toEqual(['collect', 'finish']);
  expect(await page.locator('#page-a').boundingBox()).toEqual(before);
  await page.setViewportSize({ width: 390, height: 700 });
  await expect.poll(async () => {
    const bounds = await page.locator('[data-mtp-ui] .chapter-popover').boundingBox();
    return bounds ? bounds.x + bounds.width : Infinity;
  }).toBeLessThanOrEqual(390);
  const popover = await page.locator('[data-mtp-ui] .chapter-popover').boundingBox();
  expect(popover!.x).toBeGreaterThanOrEqual(0);
  expect(popover!.x + popover!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('floating-chapter-ui.png') });
  await info.attach('floating-chapter-ui', { path: info.outputPath('floating-chapter-ui.png'), contentType: 'image/png' });
  await page.evaluate(() => (window as unknown as { chapterUITest: { ui: { destroy(): void } } }).chapterUITest.ui.destroy());
  await expect(page.locator('[data-mtp-ui]')).toHaveCount(0);
});

test('chapter popup requests image origins only after Translate and keeps progress public', async ({ page }) => {
  const view = fixtureView();
  await page.addInitScript((initial) => {
    let chapter = initial;
    const calls: { type: string; origins?: string[]; command?: string }[] = [];
    Object.assign(window, { chapterUICalls: calls });
    Object.defineProperty(window, 'chrome', { configurable: true, value: {
      permissions: { async request(input: { origins: string[] }) { calls.push({ type: 'permission', origins: input.origins }); return true; } },
      tabs: { async query() { return [{ id: 42, url: initial.session.url }]; } },
      runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', async sendMessage(message: { type: string; command?: string }) {
        calls.push({ type: message.type, ...(message.command ? { command: message.command } : {}) });
        if (message.type === 'ui:settings') return { ok: true, data: { hasKey: true, model: 'gemini-test', sourceLanguage: 'auto', timeoutSeconds: 90, rememberKey: false } };
        if (message.type === 'ui:inspect') return { ok: true, data: { tabId: 42, selection: null, job: null } };
        if (message.type === 'ui:job') return { ok: true, data: null };
        if (message.type === 'ui:chapter-inspect') return { ok: true, data: { tabId: 42, url: initial.session.url, documentToken: 'document-ui-test', view: chapter, origins: ['https://cdn.example/*'] } };
        if (message.type === 'ui:chapter-command') {
          chapter = { ...chapter, session: { ...chapter.session, status: message.command === 'pause' ? 'paused' : 'running' },
            progress: { ...chapter.progress, active: message.command === 'pause' ? 0 : 2, discovered: 0 } };
          return { ok: true, data: chapter };
        }
        return { ok: false, error: { message: 'Unexpected test operation' } };
      } },
    } });
  }, view);
  await page.goto('/popup.html');
  await expect(page.locator('#chapter-panel [data-chapter-heading]')).toContainText('Đã phát hiện 2 ảnh');
  const before = await page.evaluate(() => (window as unknown as { chapterUICalls: { type: string }[] }).chapterUICalls);
  expect(before.some((call) => call.type === 'permission' || call.type === 'ui:chapter-command' || call.type === 'ui:translate')).toBe(false);
  await page.locator('#chapter-panel [data-chapter-command="translate"]').click();
  await expect(page.locator('#chapter-panel [data-chapter-heading]')).toHaveText('Đang dịch: 0/2 ảnh');
  await expect(page.locator('#chapter-panel [data-chapter-counts]')).toContainText('Đang xử lý: 2');
  const after = await page.evaluate(() => (window as unknown as { chapterUICalls: { type: string; origins?: string[]; command?: string }[] }).chapterUICalls);
  const permissionIndex = after.findIndex((call) => call.type === 'permission');
  const translateIndex = after.findIndex((call) => call.type === 'ui:chapter-command' && call.command === 'translate');
  expect(permissionIndex).toBeLessThan(translateIndex);
  expect(after[permissionIndex]?.origins).toEqual(['https://cdn.example/*']);
  await page.locator('#chapter-panel [data-chapter-command="pause"]').click();
  await expect(page.locator('#chapter-panel [data-chapter-heading]')).toContainText('tạm dừng');
  await expect(page.locator('#chapter-panel [data-chapter-command="resume"]')).toBeVisible();
  expect(await page.locator('body').textContent()).not.toContain('apiKey');
});
