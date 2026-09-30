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
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEMPLATE = join(ROOT, 'store/launch/src/launch.html');
const GALLERY = join(ROOT, 'store/launch');

mkdirSync(GALLERY, { recursive: true });

// Product Hunt's recommended gallery size, in upload order.
const GALLERY_SLIDES = ['hero', 'permissions', 'styles', 'layout', 'color', 'type', 'export', 'verify'];

/*
 * The Web Store listing: the same feature slides at the store's exact
 * 1280×800, in the order the store shows them (the first appears in search).
 * No comparison slides — store policy is wary of them, so that argument stays
 * on Product Hunt and the website.
 */
const STORE_SLIDES = ['styles', 'layout', 'color', 'type', 'export'];

const TARGETS = [
  ...GALLERY_SLIDES.map((s, i) => ({
    slide: s,
    out: join(GALLERY, `ph-${i + 1}-${s}.png`),
    width: 1270,
    height: 760,
  })),
  { slide: 'og', out: join(ROOT, 'apps/site/public/og.png'), width: 1200, height: 630 },
  ...STORE_SLIDES.map((s, i) => ({
    slide: s,
    out: join(ROOT, 'store/screenshots', `0${i + 1}-${s}.png`),
    width: 1280,
    height: 800,
    // The store rejects any alpha channel, even a fully opaque one.
    opaque: true,
  })),
];

// The marquee promo tile, in the same style as everything around it.
TARGETS.push({
  slide: 'marquee',
  out: join(ROOT, 'store/promo/marquee-1400x560.png'),
  width: 1400,
  height: 560,
  opaque: true,
});

mkdirSync(join(ROOT, 'store/screenshots'), { recursive: true });

const browser = await chromium.launch();

for (const target of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: target.width, height: target.height },
    deviceScaleFactor: 1,
  });
  await page.goto(`file://${TEMPLATE}?s=${target.slide}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: target.out });
  if (target.opaque) {
    execFileSync('python3', [
      '-c',
      'import sys; from PIL import Image; Image.open(sys.argv[1]).convert("RGB").save(sys.argv[1])',
      target.out,
    ]);
  }
  await page.close();
  console.log(`${target.out.slice(ROOT.length)}  ${target.width}×${target.height}`);
}

await browser.close();
