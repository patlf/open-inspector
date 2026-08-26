#!/usr/bin/env node
/**
 * Capture the raw images the README uses.
 *
 * Capture only — framing is a separate pass through the polished-screenshots
 * renderer, so the shadow, backdrop and corner radius are identical across
 * every image in the file. Both themes for each, because GitHub honours
 * `<picture>` with `prefers-color-scheme` and a light screenshot on a dark
 * README is a white rectangle in the middle of the page.
 *
 * Requires the site dev server: `pnpm site:dev`.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RAW = join(ROOT, 'docs/media/raw');
const ORIGIN = process.env['SITE_ORIGIN'] ?? 'http://localhost:8788';

mkdirSync(RAW, { recursive: true });

const browser = await chromium.launch();

for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    colorScheme: theme,
    deviceScaleFactor: 2,
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // No stray hover states.
  await page.mouse.move(4, 880);
  await page.waitForTimeout(400);

  for (const [name, selector] of [
    ['permissions', '.asks'],
    ['steps', '.steps'],
    ['verify', '.checks'],
  ]) {
    const el = page.locator(selector);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await el.screenshot({ path: join(RAW, `${name}-${theme}.png`) });
    console.warn(`  ${name}-${theme}.png`);
  }

  await page.close();
}

await browser.close();
console.warn('\n  Raw README captures written to docs/media/raw\n');
