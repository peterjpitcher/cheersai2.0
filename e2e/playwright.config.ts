import type { PlaywrightTestConfig } from '@playwright/test';

const port = 3010;

const config: PlaywrightTestConfig = {
  webServer: {
    command: `bash -lc 'PORT=${port} npm run build && PORT=${port} npm run start'`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  testDir: './tests',
  reporter: [['list'], ['html', { outputFolder: 'e2e-report', open: 'never' }]],
};

export default config;

