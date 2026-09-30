#!/usr/bin/env node
/**
 * Render the launch images: the Product Hunt gallery and the site's link
 * preview card.
 *
 * Generated for the same reason as the store promo tiles — a binary you cannot
 * diff is a small smell in a project whose pitch is auditability. Every slide
 * lives in one template, picked by `?s=`, and reuses the site's own panel
 * screenshots, so re-run `pnpm gen:shots` first if the panel has changed.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEMPLATE = join(ROOT, 'store/launch/src/launch.html');
const GALLERY = join(ROOT, 'store/launch');

mkdirSync(GALLERY, { recursive: true });

// Product Hunt's recommended gallery size, then the Open Graph standard.
const TARGETS = [
  ...['hero', 'permissions', 'layout', 'color', 'export', 'verify'].map((s, i) => ({
    slide: s,
    out: join(GALLERY, `ph-${i + 1}-${s}.png`),
    width: 1270,
    height: 760,
  })),
  { slide: 'og', out: join(ROOT, 'apps/site/public/og.png'), width: 1200, height: 630 },

];

const browser = await chromium.launch();

for (const target of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: target.width, height: target.height },
    deviceScaleFactor: 1,
  });
  await page.goto(`file://${TEMPLATE}?s=${target.slide}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: target.out });
  await page.close();
  console.log(`${target.out.slice(ROOT.length)}  ${target.width}×${target.height}`);
}

await browser.close();
