import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testWithHostAccess as test, expect, FIXTURE_URL } from './fixtures.js';
import type { Page } from '@playwright/test';
import { PLAYGROUND, openInspector, openTab, panel, pin } from './support/panel.js';

/**
 * Getting things out of the panel: files saved from the Assets tab, and text
 * copied from the Export tab.
 *
 * The Export tab has no download button — every format is copy-only, by design
 * (sections.tsx `ExportSection`), so it is tested through the clipboard. The
 * Assets tab's `save` goes through the background worker, which clicks an
 * anchor in the page's main world (background.ts `saveInPage`): the only way
 * a content script can start a download Chrome will not silently drop.
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const EGRESS_URL = `${PLAYGROUND}/egress.html`;

/**
 * Hand the page back before saving, as a user reading the Assets tab would.
 * Saving with the picker still armed has its own test below.
 */
async function stopPicking(page: Page): Promise<void> {
  const inspect = panel(page).locator('.primary-btn');
  await inspect.click();
  await expect(inspect).toHaveAttribute('aria-pressed', 'false');
}

function assetRow(page: Page, name: string) {
  return panel(page)
    .locator('.asset')
    .filter({ has: page.locator('.asset-name', { hasText: name }) });
}

test.describe('saving assets', () => {
  test('a same-origin image saves under its own name, byte for byte', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, EGRESS_URL);
    await pin(page, '#hover-target');
    await openTab(page, 'assets');

    const row = assetRow(page, 'loaded.svg');
    await expect(row).toHaveCount(1);
    await stopPicking(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      row.getByRole('button', { name: 'save' }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('loaded.svg');
    expect(download.url()).toBe(`${PLAYGROUND}/egress/img/loaded.svg`);
    const saved = readFileSync(await download.path(), 'utf8');
    expect(saved).toBe(readFileSync(resolve(ROOT, 'apps/playground/egress/img/loaded.svg'), 'utf8'));
  });

  test('an inline SVG saves as an .svg file with no request at all', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '.card');
    await openTab(page, 'assets');

    const group = panel(page)
      .locator('.group')
      .filter({ has: page.locator('.group-title', { hasText: /^inline svg · / }) });
    await expect(group).toHaveCount(1);
    const row = group.locator('.asset').first();
    await stopPicking(page);

    const requests: string[] = [];
    context.on('request', (request) => requests.push(request.url()));

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      row.getByRole('button', { name: 'save' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.svg$/);
    // Minted in the page's world from the markup already in hand.
    expect(download.url()).toMatch(/^blob:http:\/\/localhost:5178\//);
    const saved = readFileSync(await download.path(), 'utf8');
    expect(saved.trimStart()).toMatch(/^<svg[\s>]/);
    expect(saved).toContain('icon-shape');
    expect(saved).toContain('</svg>');
    expect(requests.filter((url) => /^https?:/.test(url))).toEqual([]);
  });

  /**
   * Regression: the armed picker used to swallow the saver's synthetic click
   * on its hidden download link, so Save silently did nothing straight after
   * opening. Only trusted clicks are captured now.
   */
  test('save works while the picker is still armed', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, EGRESS_URL);
    await pin(page, '#hover-target');
    await openTab(page, 'assets');
    await expect(panel(page).locator('.primary-btn')).toHaveAttribute('aria-pressed', 'true');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5_000 }),
      assetRow(page, 'loaded.svg').getByRole('button', { name: 'save' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('loaded.svg');
  });
});

test.describe('copying', () => {
  test.beforeEach(async ({ context }) => {
    // The panel copies with execCommand; reading it back needs the async API.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PLAYGROUND });
  });

  async function clipboard(page: Page): Promise<string> {
    return page.evaluate(() => navigator.clipboard.readText());
  }

  /** Click a copy button and return what landed on the clipboard. */
  async function copyVia(page: Page, button: ReturnType<Page['locator']>): Promise<string> {
    const sentinel = `sentinel-${Math.random()}`;
    await page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
    await button.click();
    await expect.poll(() => clipboard(page)).not.toBe(sentinel);
    return clipboard(page);
  }

  test('every Export format copies exactly the text it shows', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '.card');
    await openTab(page, 'export');

    const formats = panel(page).locator('#oi-tabpanel .group').first().getByRole('button');
    await expect(formats.first()).toBeVisible();
    const labels = await formats.allTextContents();
    expect(labels).toEqual(expect.arrayContaining(['CSS vars', 'Tailwind', 'JSON', 'W3C tokens']));

    for (const label of labels) {
      await formats.filter({ hasText: label }).click();
      await expect(formats.filter({ hasText: label })).toHaveAttribute('aria-pressed', 'true');

      const shown = await panel(page).locator('#oi-tabpanel pre').textContent();
      expect(shown?.trim(), `${label} should not be empty`).toBeTruthy();

      const copy = panel(page).locator('#oi-tabpanel .code-block .copy');
      expect(await copyVia(page, copy)).toBe(shown);

      if (label === 'JSON' || label === 'W3C tokens') expect(() => JSON.parse(shown!)).not.toThrow();
      if (label === 'CSS vars') expect(shown).toMatch(/--[\w-]+:\s*[^;]+;/);
    }
  });

  test('an asset row copies its URL', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, EGRESS_URL);
    await pin(page, '#hover-target');
    await openTab(page, 'assets');

    const copy = assetRow(page, 'loaded.svg').getByRole('button', { name: 'copy' });
    expect(await copyVia(page, copy)).toBe(`${PLAYGROUND}/egress/img/loaded.svg`);

    // And the bulk list: one URL per line, no inline data.
    const all = panel(page).getByRole('button', { name: 'copy all URLs' });
    const list = (await copyVia(page, all)).split('\n');
    expect(list).toContain(`${PLAYGROUND}/egress/img/loaded.svg`);
    for (const url of list) expect(url).toMatch(/^https?:\/\//);
  });

  /**
   * `execCommand('copy')` returns `false` from a content script's isolated
   * world even when the copy happened, so the button used to never confirm.
   * It now trusts the textarea's `copy` event instead.
   */
  test('a copy button confirms with "Copied"', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, EGRESS_URL);
    await pin(page, '#hover-target');
    await openTab(page, 'assets');

    // By its copied state, which stays put: the accessible name changes to
    // "Copied", which a `name: 'Copy'` locator would stop matching.
    const copy = assetRow(page, 'loaded.svg').locator('.copy-icon[data-copied]');
    await copy.click();
    await expect(copy).toHaveText('Copied');
    await expect(copy).toHaveAttribute('data-copied', 'true');
  });
});
