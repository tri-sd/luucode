import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const executablePath = process.env['CHROMIUM_PATH']
  ?? (existsSync('/usr/lib/chromium/chromium') ? '/usr/lib/chromium/chromium'
    : existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

export default defineConfig({
  testDir: './tests/integration',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalSetup: './tests/integration/global-setup.ts',
  reporter: [['list'], ['json', { outputFile: 'test-results/integration-results.json' }]],
  use: {
    browserName: 'chromium', headless: true, baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1200, height: 900 },
    launchOptions: { ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run fixtures', url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: !process.env['CI'], timeout: 15_000,
  },
});
