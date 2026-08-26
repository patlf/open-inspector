#!/usr/bin/env node
/**
 * No image on the site may be stretched.
 *
 * `width` and `height` attributes on an `<img>` are presentational hints, and
 * the browser uses them as the real dimensions unless CSS says otherwise. Set
 * a fluid `width` in CSS and forget `height: auto`, and the height stays
 * pinned at the attribute value while the width scales — the image distorts,
 * and it is exactly the sort of thing that survives several reviews because it
 * looks almost right. Comparing each rendered ratio against its natural one
 * catches it in a way that looking does not.
 *
 * Requires the dev server: `pnpm site:dev` in another terminal, or set
 * SITE_ORIGIN to check a deployed site.
 */
import { chromium } from '@playwright/test';

const ORIGIN = process.env['SITE_ORIGIN'] ?? 'http://localhost:8788';

/** Widths worth checking: every breakpoint, plus either side of each. */
const WIDTHS = [390, 640, 940, 1024, 1200, 1280, 1440, 1680, 1920];

const browser = await chromium.launch();
let stretched = 0;

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });

  // Lazy-loaded images below the fold have no natural size until they arrive.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const pending = [...document.images].filter((img) => !img.complete);
        if (pending.length === 0) return resolve();
        let left = pending.length;
        pending.forEach((img) =>
          img.addEventListener('load', () => {
            if (--left === 0) resolve();
          }),
        );
        setTimeout(resolve, 3000);
      }),
  );

  const rows = await page.evaluate(() =>
    [...document.images]
      .filter((img) => img.naturalWidth && img.getBoundingClientRect().width)
      .map((img) => {
        const rect = img.getBoundingClientRect();
        return {
          src: img.currentSrc.split('/').pop(),
          natural: Number((img.naturalWidth / img.naturalHeight).toFixed(3)),
          rendered: Number((rect.width / rect.height).toFixed(3)),
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
        };
      }),
  );

  // A pixel of rounding on a fractional layout is not a distortion.
  const off = rows.filter((row) => Math.abs(row.natural - row.rendered) > 0.01);
  stretched += off.length;

  console.warn(
    `  ${off.length === 0 ? 'ok  ' : 'FAIL'} ${String(width).padStart(5)}px  ${rows.length} images`,
  );
  for (const row of off) {
    console.warn(
      `        ${row.src} rendered ${row.size} at ${row.rendered}, natural ${row.natural}`,
    );
  }

  await page.close();
}

await browser.close();
console.warn(
  stretched === 0
    ? '\n  Every image keeps its aspect ratio\n'
    : `\n  ${stretched} stretched\n`,
);
process.exit(stretched > 0 ? 1 : 0);
