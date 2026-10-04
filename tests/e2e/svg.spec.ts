import { readFileSync } from 'node:fs';
import { testWithHostAccess as test, expect, FIXTURE_URL } from './fixtures.js';
import type { Page } from '@playwright/test';
import { openInspector, openTab, panel, pin } from './support/panel.js';

/**
 * The SVG optimizer, wherever SVG turns up: the selected element, an inline
 * asset, and markup pasted into its own tab. Saving goes through the page's
 * own download path, so these also check that nothing is fetched to do it.
 */

const MESSY = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator -->
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" viewBox="0 0 24.000 24.000">
  <g><path fill="#FFFFFF" d="M 6.000,6.000 L 18.000,18.000"/></g>
</svg>`;

function tool(page: Page) {
  return panel(page).locator('.svg-tool');
}

async function stopPicking(page: Page): Promise<void> {
  const inspect = panel(page).locator('.primary-btn');
  await inspect.click();
  await expect(inspect).toHaveAttribute('aria-pressed', 'false');
}

test.describe('svg optimizer', () => {
  test('a shape inside an <svg> gets the whole drawing in Markup', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    // The circle fills the middle of the mark, so this selects the circle.
    await pin(page, 'svg[aria-label="Decorative mark"] circle');
    await openTab(page, 'markup');

    await panel(page).getByRole('button', { name: 'SVG', exact: true }).click();

    await expect(tool(page).locator('.svg-size')).toContainText('→');
    await expect(tool(page).locator('pre')).toContainText('<circle');
    await expect(tool(page).locator('pre')).toContainText('xmlns="http://www.w3.org/2000/svg"');

    await tool(page).getByRole('button', { name: 'Beautified' }).click();
    await expect(tool(page).locator('pre')).toContainText('\n  <circle');
  });

  test('a non-SVG selection has no SVG view', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');
    await openTab(page, 'markup');

    await expect(panel(page).getByRole('button', { name: 'SVG', exact: true })).toHaveCount(0);
  });

  test('an inline SVG asset opens the optimizer under its row', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '.card');
    await openTab(page, 'assets');

    const row = panel(page)
      .locator('.group')
      .filter({ has: page.locator('.group-title', { hasText: /^inline svg · / }) })
      .locator('.asset')
      .first();
    await row.getByRole('button', { name: 'optimize' }).click();

    await expect(tool(page)).toHaveCount(1);
    await expect(tool(page).locator('pre')).toContainText('<svg');
  });

  test('pasted markup is optimized, previewed and saved without a request', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');
    await openTab(page, 'svg');

    await panel(page).locator('.svg-input').fill(MESSY);

    const out = tool(page).locator('pre');
    await expect(out).toHaveText(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M6 6 18 18"/></svg>',
    );
    await expect(tool(page).locator('.svg-size')).toContainText('smaller');
    await expect(tool(page).locator('.svg-preview img')).toBeVisible();

    await stopPicking(page);
    const requests: string[] = [];
    context.on('request', (request) => requests.push(request.url()));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      tool(page).getByRole('button', { name: 'save' }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('optimized.svg');
    expect(readFileSync(await download.path(), 'utf8')).toBe(await out.textContent());
    expect(requests.filter((url) => /^https?:/.test(url))).toEqual([]);
  });

  test('markup that is not SVG says why', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');
    await openTab(page, 'svg');

    await panel(page).locator('.svg-input').fill('<svg><g></svg>');

    await expect(panel(page).locator('.body')).toContainText('Not readable as SVG. </svg> closes <g>.');
  });
});
