import { testWithHostAccess as test, expect, FIXTURE_URL, activeTabId, toggleInspector } from './fixtures.js';

/**
 * The panel holds itself to the standard it grades other pages against.
 *
 * The Color tab reports WCAG AA pass/fail on whatever you point it at, so the
 * panel failing AA itself is not a cosmetic issue — it undermines the feature.
 * When this was first measured, 13 of 28 text styles failed in light and 14 in
 * dark, most of them from a single muted token that had been tuned against one
 * background and then painted on three.
 *
 * Measured in the browser rather than from the token table on purpose:
 * translucent fills, inherited colours and opacity compose, and only the real
 * cascade knows the result.
 */

/** Measure every distinct text/background pair the panel actually paints. */
const MEASURE = `
(() => {
  const shadow = document.querySelector('open-inspector-panel').shadowRoot;

  function srgb(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum({ r, g, b }) { return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b); }
  function parse(s) {
    const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  }
  function over(fg, bg) {
    const a = fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function ratio(a, b) {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }
  function effectiveBg(el) {
    let node = el;
    let acc = null;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (acc.a >= 1) return acc; }
      node = node.parentElement ?? (node.getRootNode() instanceof ShadowRoot ? node.getRootNode().host : null);
    }
    return acc ?? { r: 255, g: 255, b: 255, a: 1 };
  }

  const seen = new Map();
  for (const el of shadow.querySelectorAll('*')) {
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!text) continue;

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    // Hover-reveal controls are measured as revealed; opacity 0 is not a
    // contrast failure, it is a hidden control.
    const opacity = el.classList.contains('copy') ? 1 : Number(style.opacity);
    let fg = parse(style.color);
    if (!fg) continue;
    fg = { ...fg, a: fg.a * opacity };

    const bg = effectiveBg(el);
    const r = ratio(over(fg, bg), bg);
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;

    const key = el.className + '|' + style.color + '|' + style.opacity + '|' + Math.round(size);
    if (seen.has(key)) continue;
    seen.set(key, {
      cls: String(el.className).slice(0, 34) || el.tagName.toLowerCase(),
      sample: (el.textContent || '').trim().slice(0, 22),
      px: size, ratio: Number(r.toFixed(2)), need, pass: r >= need,
    });
  }
  return [...seen.values()].sort((a, b) => a.ratio - b.ratio);
})()
`;

for (const scheme of ['light', 'dark'] as const) {
  test(`contrast audit: ${scheme}`, async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: '#plain-button:hover { background: rgb(0,128,0) !important; }' });

    const tabId = await activeTabId(serviceWorker);
    await toggleInspector(serviceWorker, tabId);
    await page.waitForTimeout(200);

    const box = await page.locator('#plain-button').boundingBox();
    await page.mouse.move(box!.x + 5, box!.y + 5);
    await page.waitForTimeout(100);
    await page.mouse.click(box!.x + 5, box!.y + 5);
    await page.waitForTimeout(500);

    const rows = (await page.evaluate(MEASURE)) as Array<{
      cls: string; sample: string; px: number; ratio: number; need: number; pass: boolean;
    }>;

    const failing = rows.filter((row) => !row.pass);

    /**
     * The report goes in the assertion message, not to stdout.
     *
     * A passing run should say nothing at all, and a failing one needs the
     * measurements right where the failure is read — which class, at what
     * size, how far short.
     */
    const report = failing
      .map(
        (row) =>
          `  ${String(row.ratio).padStart(6)}:1 (needs ${row.need})  ` +
          `${String(row.px).padStart(4)}px  ${row.cls.padEnd(34)} "${row.sample}"`,
      )
      .join('\n');

    // Guard against a silently empty measurement passing the assertion below.
    expect(rows.length, 'the panel should paint more than 20 distinct text styles').toBeGreaterThan(
      20,
    );
    expect(
      failing,
      `${failing.length} of ${rows.length} text styles fail WCAG AA in ${scheme}:\n${report}`,
    ).toEqual([]);
  });
}
