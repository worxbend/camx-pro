import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/integration/web',
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: 'http://127.0.0.1:4179',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'node tests/integration/server.mjs',
    url: 'http://127.0.0.1:4179/camx-pro/',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
