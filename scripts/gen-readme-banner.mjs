#!/usr/bin/env node
/**
 * The banner at the top of the README.
 *
 * Generated from the site's own tokens and a real panel screenshot, in both
 * themes, so it cannot drift from the product or from the website. GitHub
 * honours `<picture>` with `prefers-color-scheme`, so the reader gets the one
 * that matches the page they are on.
 */
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'docs/media');
mkdirSync(OUT, { recursive: true });

const THEMES = {
  light: {
    bg: '#ffffff', raised: '#f4f6f7', ink: '#14181c', soft: '#3d474e',
    mute: '#60696f', rule: '#d5dbde', accent: '#b8451f',
    good: '#376b4c', goodWash: 'rgba(63,125,88,0.14)', goodEdge: '#3f7d58',
    shot: 'panel-styles.png',
  },
  dark: {
    bg: '#14181c', raised: '#1b2126', ink: '#e6eaec', soft: '#b3bcc2',
    mute: '#8d979e', rule: '#2b343a', accent: '#e4743f',
    good: '#6aab84', goodWash: 'rgba(106,171,132,0.15)', goodEdge: '#6aab84',
    shot: 'panel-styles-dark.png',
  },
};

const browser = await chromium.launch();

for (const [name, t] of Object.entries(THEMES)) {
  const shot = readFileSync(join(ROOT, 'apps/site/public/shots', t.shot)).toString('base64');
  const logo = readFileSync(join(ROOT, 'apps/site/public/logo.svg')).toString('base64');

  const html = `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0}
    html,body{width:1280px;height:440px}
    body{
      background:${t.bg};color:${t.ink};overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      display:grid;grid-template-columns:1fr 420px;align-items:center;
      padding:0 0 0 64px;gap:40px;
    }
    .left{display:flex;flex-direction:column;gap:20px;max-width:600px}
    .brand{display:flex;align-items:center;gap:11px;font-family:ui-monospace,'SF Mono',Menlo,monospace;
      font-size:16px;font-weight:600;letter-spacing:-.02em}
    .brand img{display:block;width:26px;height:26px}
    h1{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:41px;line-height:1.1;
      letter-spacing:-.035em;font-weight:600}
    h1 em{font-style:normal;color:${t.accent}}
    p{font-size:17px;line-height:1.5;color:${t.soft};max-width:46ch}
    .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
    .chip{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:11.5px;letter-spacing:.03em;
      padding:6px 10px;border-radius:5px;border:1px solid ${t.rule};color:${t.mute}}
    .chip.good{color:${t.good};border-color:${t.goodEdge};background:${t.goodWash}}
    .shot{position:relative;height:100%;overflow:hidden}
    .shot img{position:absolute;top:52px;left:0;width:400px;
      border:1px solid ${t.rule};border-radius:10px 0 0 10px;
      box-shadow:-20px 0 70px -28px rgba(0,0,0,${name === 'dark' ? '0.9' : '0.45'})}
  </style>
  <div class="left">
    <div class="brand"><img src="data:image/svg+xml;base64,${logo}" alt="">Open Inspector</div>
    <h1>Inspect any page.<br><em>No site access requested.</em></h1>
    <p>Layout, styles, colour, type, assets and design tokens — from an extension that asks for nothing and sends nothing.</p>
    <div class="chips">
      <span class="chip good">0 host permissions</span>
      <span class="chip good">0 network requests</span>
      <span class="chip">Free &amp; MIT</span>
    </div>
  </div>
  <div class="shot"><img src="data:image/png;base64,${shot}" alt=""></div>`;

  const page = await browser.newPage({ viewport: { width: 1280, height: 440 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `banner-${name}.png`) });
  await page.close();
  console.warn(`  banner-${name}.png  1280x440 @2x`);
}

await browser.close();
console.warn('\n  README banner written to docs/media\n');
