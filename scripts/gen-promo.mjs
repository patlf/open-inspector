#!/usr/bin/env node
/**
 * Render the Chrome Web Store promotional images.
 *
 * Generated rather than hand-designed for the same reason the icons are: a
 * binary you cannot diff is a small supply-chain smell in a project whose whole
 * pitch is auditability. Re-run it and compare.
 *
 * Both must be JPEG or 24-bit PNG with **no alpha channel**, at exactly the
 * sizes the store asks for. Playwright writes RGBA, so the last step strips the
 * channel — a fully-opaque alpha channel is still an alpha channel, and the
 * store rejects it.
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'store/promo');
// Resolved, because a relative path produces `file://store/...`, which names a
// host called "store" rather than a directory.
const SOURCE = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : null;

if (!SOURCE) {
  console.error('usage: gen-promo.mjs <directory containing promo-*.html>');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const TARGETS = [
  { name: 'small-tile-440x280', file: 'promo-small.html', width: 440, height: 280 },
  { name: 'marquee-1400x560', file: 'promo-marquee.html', width: 1400, height: 560 },
];

const browser = await chromium.launch();

for (const target of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: target.width, height: target.height },
    // A device pixel ratio above 1 would produce an image at twice the
    // requested size, which the store rejects outright.
    deviceScaleFactor: 1,
  });

  const html = join(SOURCE, target.file);
  await page.goto(`file://${isAbsolute(html) ? html : resolve(html)}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(300);

  const path = join(OUT, `${target.name}.png`);
  await page.screenshot({ path, omitBackground: false });
  await page.close();

  // RGBA -> RGB. Pillow ships with macOS python3 here; if it is missing the
  // image is still valid, just not in the format the store accepts.
  execFileSync('python3', [
    '-c',
    `from PIL import Image; im = Image.open(${JSON.stringify(path)}).convert('RGB'); im.save(${JSON.stringify(path)})`,
  ]);

  console.warn(`  ${target.name}  ${target.width}x${target.height}`);
}

await browser.close();
console.warn('\n  Promotional images written to store/promo\n');
