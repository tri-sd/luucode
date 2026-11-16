import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  imports: false,
  manifestVersion: 3,
  manifest: {
    name: 'Manga Translator Pro',
    minimum_chrome_version: '116',
    description: 'Nhận diện chữ và dịch manga sang tiếng Việt bằng Gemini API do bạn cấu hình.',
    permissions: ['activeTab', 'scripting', 'storage', 'offscreen'],
    host_permissions: ['https://generativelanguage.googleapis.com/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'Manga Translator Pro — dịch ảnh đang xem' },
    commands: {
      'toggle-tracking': {
        suggested_key: { default: 'Alt+Shift+M' },
        description: 'Mở bảng dịch ảnh đang xem',
      },
    },
  },
});
