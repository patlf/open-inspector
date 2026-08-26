#!/usr/bin/env node
/**
 * Run the engine against real production sites and record what breaks.
 *
 * The premise, from the competitive research: reliability is the one thing in
 * this category that can be turned into a mechanical process rather than a
 * claim. Every failure this finds becomes a fixture; every fixture makes the
 * next change safer.
 *
 * It bundles the engine standalone and injects it into each page. No extension
 * is involved on purpose — the engine is the layer that meets pages nobody
 * wrote for us, and testing it directly keeps the failures attributable. The
 * extension shell has its own coverage in tests/e2e.
 *
 * The engine still makes no network requests. The browser fetches the pages,
 * which is what a browser is for.
 *
 *   pnpm sweep                     # the default site list
 *   pnpm sweep https://a.com ...   # specific URLs
 *   pnpm sweep --headed            # watch it work
 */

import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORT_DIR = join(ROOT, '.output/sweep');

/**
 * Sites chosen for the shapes they stress, not for popularity: utility-first
 * CSS, web components, CSS-in-JS, heavy typography, a docs site, and a plain
 * server-rendered page with no framework at all.
 */
const DEFAULT_SITES = [
  { url: 'https://tailwindcss.com/', why: 'utility-first CSS, thousands of atomic rules' },
  { url: 'https://github.com/', why: 'web components, Primer design system' },
  { url: 'https://stripe.com/', why: 'gradients, custom typography' },
  { url: 'https://developer.mozilla.org/en-US/', why: 'CSS custom properties, docs layout' },
  { url: 'https://news.ycombinator.com/', why: 'table layout, no framework, tiny CSS' },
  { url: 'https://www.smashingmagazine.com/', why: 'editorial layout, many webfonts' },
  { url: 'https://vercel.com/', why: 'Next.js, CSS Modules, dark theme' },
  { url: 'https://en.wikipedia.org/wiki/Cascading_Style_Sheets', why: 'long document, legacy CSS' },
  { url: 'https://svelte.dev/', why: 'scoped component styles' },
  { url: 'https://web.dev/', why: 'web components plus modern CSS' },
  { url: 'https://www.bbc.co.uk/news', why: 'news grid, many images, GEL design system' },
  { url: 'https://www.apple.com/', why: 'image-heavy, srcset, scroll effects' },
];

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const urls = args.filter((arg) => !arg.startsWith('--'));
const sites =
  urls.length > 0 ? urls.map((url) => ({ url, why: 'supplied on the command line' })) : DEFAULT_SITES;

/** Bundle the probe plus the whole engine into one injectable IIFE. */
async function bundleProbe() {
  const result = await build({
    entryPoints: [join(ROOT, 'scripts/sweep/probe.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    write: false,
    logLevel: 'silent',
  });

  const output = result.outputFiles?.[0];
  if (!output) throw new Error('esbuild produced no output for the sweep probe');
  return output.text;
}

async function sweepSite(context, site, probeSource) {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 160));
  });
  page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 160)));

  const result = {
    url: site.url,
    why: site.why,
    loaded: false,
    elementsProbed: 0,
    failures: [],
    suspicions: [],
    timings: {},
    stats: {},
    consoleErrors: [],
    pageErrors: [],
  };

  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // Let webfonts and late CSS land; the engine reads what the browser has.
    await page.waitForTimeout(2500);
    result.loaded = true;
  } catch (error) {
    result.failures.push({ stage: 'navigate', message: String(error).slice(0, 160) });
    await page.close().catch(() => undefined);
    return result;
  }

  try {
    /**
     * Injected by evaluation, not by `addScriptTag`.
     *
     * A script *tag* is subject to the page's Content Security Policy, and
     * sites like GitHub, Stripe and MDN forbid inline scripts outright — the
     * harness would report failures the real product never hits. A content
     * script runs in an isolated world that CSP does not govern, and CDP
     * evaluation has the same exemption, so this matches production behaviour.
     */
    await page.evaluate(probeSource);
    Object.assign(result, await page.evaluate('window.__openInspectorSweep.run()'));
  } catch (error) {
    result.failures.push({ stage: 'probe', message: String(error).slice(0, 300) });
  }

  // Errors the page logs itself are not ours; kept only as context.
  result.consoleErrors = consoleErrors.slice(0, 3);
  result.pageErrors = pageErrors.slice(0, 3);

  await page.close().catch(() => undefined);
  return result;
}

function verdict(result) {
  if (!result.loaded) return 'did not load';
  if (result.failures.length > 0) return `${result.failures.length} error(s)`;
  if (result.suspicions.length > 0) return `${result.suspicions.length} suspicion(s)`;
  return 'clean';
}

async function main() {
  console.log('\n  Bundling the engine…');
  const probeSource = await bundleProbe();
  console.log(`  Probe bundle: ${(probeSource.length / 1024).toFixed(0)} KB\n`);

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: !headed,
    viewport: { width: 1440, height: 900 },
  });

  const results = [];

  for (const site of sites) {
    process.stdout.write(`  ${site.url.padEnd(52)}`);
    const result = await sweepSite(context, site, probeSource);
    results.push(result);

    const slowest = Math.max(
      result.timings?.palette ?? 0,
      result.timings?.styleIndex ?? 0,
      result.timings?.assets ?? 0,
    );
    console.log(
      `${verdict(result).padEnd(16)} ${String(result.elementsProbed).padStart(3)} els  ${String(slowest).padStart(5)}ms`,
    );

    for (const finding of [...result.failures, ...result.suspicions].slice(0, 5)) {
      const where = finding.selector ? ` (${finding.selector})` : '';
      console.log(`      ${finding.stage}${where}: ${finding.message}`);
    }
  }

  await context.close();

  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, 'report.json');
  writeFileSync(reportPath, JSON.stringify({ results }, null, 2));

  const errored = results.filter((result) => result.failures.length > 0);
  const suspicious = results.filter(
    (result) => result.failures.length === 0 && result.suspicions.length > 0,
  );
  const probed = results.reduce((total, result) => total + result.elementsProbed, 0);

  console.log(`\n  ${probed} elements probed across ${results.length} sites`);
  console.log(`  ${errored.length} with errors, ${suspicious.length} with suspicions only`);
  console.log(`  Full report: ${reportPath}\n`);

  // A sweep that finds nothing is either very good news or a broken harness.
  if (probed === 0) process.exitCode = 1;
}

await main();
