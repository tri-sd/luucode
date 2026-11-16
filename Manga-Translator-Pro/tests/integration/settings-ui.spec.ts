import { expect, test } from '@playwright/test';

test('settings form uses password input, loads models and clears the entered key after saving', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { model: '', sourceLanguage: 'auto', timeoutSeconds: 90, rememberKey: false, hasKey: false };
    Object.defineProperty(window, 'chrome', { configurable: true, value: {
      runtime: {
        id: 'abcdefghijklmnopabcdefghijklmnop',
        async sendMessage(message: { type: string; settings?: Partial<typeof state>; apiKey?: string }) {
          if (message.type === 'ui:settings') return { ok: true, data: { ...state } };
          if (message.type === 'ui:models') return { ok: true, data: [{ id: 'gemini-vision-test', name: 'Gemini Vision Test' }] };
          if (message.type === 'ui:save') {
            Object.assign(state, message.settings, { hasKey: true }); return { ok: true, data: { ...state } };
          }
          if (message.type === 'ui:clear-key') { state.hasKey = false; return { ok: true, data: { ...state } }; }
          return { ok: false, error: { message: 'Unsupported test operation' } };
        },
      },
    } });
  });
  await page.goto('/options.html');
  await page.getByRole('button', { name: 'Cấu hình Gemini', exact: true }).click();
  const input = page.locator('#api-key');
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill('FAKE_UI_TEST_KEY_123456789');
  await page.getByRole('button', { name: 'Tải danh sách model' }).click();
  await expect(page.locator('#settings-status')).toContainText('Đã tải 1 model');
  await page.locator('#model-select').selectOption('gemini-vision-test');
  await page.locator('#source-language').selectOption('ja');
  await page.locator('#timeout').fill('60');
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
  await expect(page.locator('#settings-status')).toContainText('chỉ giữ trong phiên');
  await expect(input).toHaveValue('');
  expect(await page.locator('body').textContent()).not.toContain('FAKE_UI_TEST_KEY');
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.getByRole('button', { name: 'Xóa key đã lưu' }).click();
  await expect(page.locator('#settings-status')).toContainText('Chưa có API key');
});

test('popup shows missing configuration and does not submit automatic translation requests', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'chrome', { configurable: true, value: {
      runtime: {
        id: 'abcdefghijklmnopabcdefghijklmnop',
        async sendMessage(message: { type: string }) {
          if (message.type === 'ui:settings') return { ok: true, data: { hasKey: false, model: '', sourceLanguage: 'auto', timeoutSeconds: 90, rememberKey: false } };
          if (message.type === 'ui:inspect') return { ok: true, data: { tabId: 1, selection: null, job: null } };
          if (message.type === 'ui:job') return { ok: true, data: null };
          throw new Error('Unexpected automatic operation');
        },
      },
    } });
  });
  const external: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
  await page.goto('/popup.html');
  await expect(page.locator('#translate')).toBeDisabled();
  await expect(page.locator('#config-summary')).toContainText('Chưa cấu hình');
  await expect(page.locator('#image-summary')).toContainText('Chưa tìm thấy ảnh');
  expect(external).toEqual([]);
});

test('popup offers explicit capture for blob images without requesting CDN permissions', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'chrome', { configurable: true, value: {
      runtime: {
        id: 'abcdefghijklmnopabcdefghijklmnop',
        async sendMessage(message: { type: string; capture?: boolean }) {
          if (message.type === 'ui:translate') {
            if (!message.capture) throw new Error('Explicit capture flag missing');
            return { ok: true, data: { id: 'test-job', tabId: 1, phase: 'done', tile: 1, tiles: 1, createdAt: Date.now(), message: 'Dịch ảnh chụp thử nghiệm xong.' } };
          }
          if (message.type === 'ui:debug') return { ok: true, data: { domImages: 2, canvases: 0, backgrounds: 0, valid: 1, visible: 1, entries: [
            { nodeId: 1, element: 'img#page', method: 'img', source: 'blob: (ảnh nội bộ)', naturalWidth: 1000, naturalHeight: 1600, renderedWidth: 500, renderedHeight: 800, valid: true, reason: 'Đang hiển thị; có thể dịch.' },
            { nodeId: 2, element: 'img#pending', method: 'img', source: '(chưa có nguồn)', naturalWidth: 0, naturalHeight: 0, renderedWidth: 500, renderedHeight: 800, valid: false, reason: 'Đang lazy load.' },
          ] } };
          if (message.type === 'ui:settings') return { ok: true, data: { hasKey: true, model: 'gemini-vision-test', sourceLanguage: 'auto', timeoutSeconds: 90, rememberKey: false } };
          if (message.type === 'ui:inspect') return { ok: true, data: { tabId: 1, job: null, selection: {
            instanceId: 'image-1', generation: 1, sourceKey: 'x', documentToken: 'TEST_DOCUMENT_TOKEN_123',
            source: 'blob:https://example.test/synthetic', naturalWidth: 1000, naturalHeight: 1600,
          } } };
          if (message.type === 'ui:job') return { ok: true, data: null };
          throw new Error('Unexpected operation');
        },
      },
    } });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/popup.html');
  await expect(page.locator('#translate')).toBeEnabled();
  await page.locator('#translate').click();
  await expect(page.locator('#use-capture')).toBeChecked();
  await expect(page.locator('#use-capture')).toBeDisabled();
  await expect(page.locator('#translation-status')).toHaveText('Dịch ảnh chụp thử nghiệm xong.');
  await page.locator('#debug summary').click();
  await expect(page.locator('#debug-summary')).toContainText('DOM img: 2');
  await expect(page.locator('#debug-entries')).toContainText('lazy load');
  await expect(page.locator('#translate')).toBeEnabled();
  expect(errors).toEqual([]);
});
