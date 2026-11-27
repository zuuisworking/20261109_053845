const { defineConfig, devices } = require('@playwright/test');

const frontendUrl = process.env.E2E_FRONTEND_URL || 'http://127.0.0.1:5173';
const backendUrl = process.env.E2E_BACKEND_URL || 'http://127.0.0.1:5000';
const mongoUri =
  process.env.MONGODB_URI_E2E || 'mongodb://127.0.0.1:27018/sigap_ulp_labuhan_e2e';

module.exports = defineConfig({
  testDir: './tests/e2e',
  globalSetup: require.resolve('./tests/e2e/global-setup.js'),
  globalTeardown: require.resolve('./tests/e2e/global-teardown.js'),
  timeout: 30000,
  expect: {
    timeout: 7000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
    },
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: frontendUrl,
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: [
    {
      command: 'node backend/src/server.js',
      url: `${backendUrl}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        NODE_ENV: 'test',
        PORT: '5000',
        MONGODB_URI: mongoUri,
        MONGODB_URI_E2E: mongoUri,
        SESSION_SECRET: 'e2e-session-secret-with-at-least-thirty-two-bytes',
        CLIENT_URL: frontendUrl,
        CLIENT_URLS: frontendUrl,
      },
    },
    {
      command: 'npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173',
      url: frontendUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        NODE_ENV: 'test',
      },
    },
  ],
});
