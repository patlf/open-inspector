import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run the real packaged extension in a real browser.
 *
 * Two constraints shape this config:
 *
 * 1. Extensions need a persistent context, which each test creates for itself
 *    in `tests/e2e/fixtures.ts`. There is no `use.browserName` here because
 *    nothing launches a shared browser.
 * 2. Extension contexts are expensive — a fresh profile directory and a
 *    service-worker boot each — so these run with limited parallelism.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: process.env['CI'] ? 1 : 2,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Serves the fixture page at /e2e.html. Reused if you already have it up.
  webServer: {
    command: 'pnpm --filter @open-inspector/playground dev',
    url: 'http://localhost:5178/e2e.html',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
