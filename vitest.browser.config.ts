import { defineConfig } from 'vitest/config';

/**
 * Unit tests that need a real engine.
 *
 * happy-dom has no layout, no real cascade and no canvas text measurement, so
 * the code that reads those — the panel's collectors, the cascade checked
 * against what the browser actually computed, rendered-font detection — was
 * either untested or tested against fakes. These run the same Vitest API in
 * headless Chromium through Playwright. Named `*.browser.test.ts` so the fast
 * suite (vitest.config.ts) skips them.
 */
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  test: {
    include: ['packages/*/src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      name: 'chromium',
      headless: true,
      screenshotFailures: false,
    },
  },
});
