#!/usr/bin/env node
/**
 * Hold the website to the standard the extension enforces on other pages.
 *
 * The product ships a page-wide contrast audit, so a marketing site that fails
 * WCAG AA would be the most embarrassing possible bug. Measured in a real
 * browser rather than from the token table, because opacity and translucent
 * fills compose and only the real cascade knows the result.
 *
 * Requires the dev server: `pnpm site:dev` in another terminal.
 */
import { chromium } from '@playwright/test';

const ORIGIN = process.env['SITE_ORIGIN'] ?? 'http://localhost:8788';

const MEASURE = `(() => {
  function srgb(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)}
  function lum(c){return 0.2126*srgb(c.r)+0.7152*srgb(c.g)+0.0722*srgb(c.b)}
  function parse(s){const m=s.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;
    const [r,g,b,a=1]=m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);return{r,g,b,a}}
  function over(f,b){const a=f.a;return{r:f.r*a+b.r*(1-a),g:f.g*a+b.g*(1-a),b:f.b*a+b.b*(1-a),a:1}}
  function ratio(a,b){const[x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05)}
  function bgOf(el){let n=el,acc=null;
    while(n){const c=parse(getComputedStyle(n).backgroundColor);
      if(c&&c.a>0){acc=acc?over(acc,c):c;if(acc.a>=1)return acc}
      n=n.parentElement}
    return acc??{r:255,g:255,b:255,a:1}}

  const seen=new Map();
  for(const el of document.querySelectorAll('*')){
    if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
    const st=getComputedStyle(el);
    if(st.display==='none'||st.visibility==='hidden')continue;
    let fg=parse(st.color); if(!fg)continue;
    fg={...fg,a:fg.a*Number(st.opacity)};
    const bg=bgOf(el);
    const r=ratio(over(fg,bg),bg);
    const size=parseFloat(st.fontSize), bold=Number(st.fontWeight)>=700;
    const need=(size>=24||(size>=18.66&&bold))?3:4.5;
    const key=el.className+'|'+st.color+'|'+Math.round(size);
    if(seen.has(key))continue;
    seen.set(key,{cls:String(el.className).slice(0,30)||el.tagName.toLowerCase(),
      sample:(el.textContent||'').trim().slice(0,20),px:size,
      ratio:Number(r.toFixed(2)),need,pass:r>=need});
  }
  return [...seen.values()].sort((a,b)=>a.ratio-b.ratio);
})()`;

const browser = await chromium.launch();
let failures = 0;

for (const path of ['/', '/privacy']) {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
    await page.goto(ORIGIN + path, { waitUntil: 'networkidle' });
    // Accordions closed hide half the copy; measure it open.
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
    await page.waitForTimeout(200);

    const rows = await page.evaluate(MEASURE);
    const bad = rows.filter((row) => !row.pass);
    failures += bad.length;

    console.warn(`  ${bad.length === 0 ? 'ok  ' : 'FAIL'} ${path} ${scheme.padEnd(6)} ${rows.length} styles`);
    for (const row of bad) {
      console.warn(
        `        ${String(row.ratio).padStart(6)}:1 (needs ${row.need}) ${String(row.px).padStart(6)}px  ` +
        `${row.cls.padEnd(30)} "${row.sample}"`,
      );
    }
    await page.close();
  }
}

await browser.close();
console.warn(failures === 0 ? '\n  Site contrast passes WCAG AA in both themes\n' : `\n  ${failures} failing\n`);
process.exit(failures > 0 ? 1 : 0);
