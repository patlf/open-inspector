#!/usr/bin/env node
/**
 * Put the panel screenshots on a backdrop.
 *
 * Kept separate from `gen-site-shots.mjs`, and reading from raw captures rather
 * than from the published files, because framing is not idempotent: run it twice
 * over its own output and you get a backdrop on a backdrop. Capture writes raw,
 * this writes framed, and re-running either is safe.
 *
 * The backdrops are the site's own tokens, not a stock gradient. This product is
 * an instrument, and the page says so; a saturated mesh behind the panel would
 * be a campaign surface pretending to be a tool. Each is a shallow ramp between
 * --bg and --sunk, which reads as the surface the panel is resting on rather
 * than as an effect applied to it.
 *
 * `--pad "N N 0"` is the load-bearing argument. Backdrop on three sides and none
 * on the fourth is what keeps the panel bleeding off the bottom of its tile — a
 * panel is far taller than it is wide, and containing the whole thing would mean
 * shrinking the type past reading. The bottom corners square themselves off when
 * an edge has no padding, which is what makes the bleed read as "continues"
 * rather than as a mistake.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveShotkit } from './shotkit.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RAW = join(ROOT, '.output/shots-raw');
const OUT = join(ROOT, 'apps/site/public/shots');
// Looked up at run time — see scripts/shotkit.mjs for why it is not a dependency.
const SHOTKIT = resolveShotkit();

if (!existsSync(RAW)) {
  console.error(`no raw captures in ${RAW} — run \`node scripts/gen-site-shots.mjs\` first`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

/**
 * Both ends stay close together on purpose.
 *
 * A backdrop that ramps hard turns into a thing you look at. These move about
 * one step of the palette from top-left to bottom-right, which is enough to read
 * as light falling across a surface and not enough to read as a gradient.
 */
const BACKDROP = {
  //          --bg #ffffff → just past --sunk #eaedef
  light: 'linear:#fbfcfd,#e4eaee',
  //          just above --raised #1b2126 → just above --bg #14181c
  dark: 'linear:#252d34,#171d22',
};

const files = readdirSync(RAW).filter((f) => f.endsWith('.png')).sort();
if (!files.length) {
  console.error(`no .png files in ${RAW}`);
  process.exit(1);
}

for (const file of files) {
  const dark = file.includes('-dark');
  execFileSync('node', [
    SHOTKIT, 'frame', join(RAW, file),
    '--out', join(OUT, file),
    // The captures are 3x, and the source is never resampled — this only tells
    // the renderer what a CSS pixel is worth so the padding comes out right.
    '--scale', '3',
    '--bg', dark ? BACKDROP.dark : BACKDROP.light,
    '--pad', '30 30 0',
    '--radius', '12',
    // `contact` rather than something taller: 30px of backdrop cannot hold a
    // shadow that reaches 64, and a shadow clipped by the canvas edge looks like
    // a rendering bug. Tight and dark is also the right register at this size —
    // the panel is resting on the surface, not hovering over it.
    '--shadow', 'contact',
    '--hairline', dark ? 'light' : 'dark',
  ], { stdio: 'inherit' });
}

console.warn(`\n  ${files.length} framed into apps/site/public/shots\n`);
