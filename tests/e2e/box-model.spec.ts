import { testWithHostAccess as test, expect, FIXTURE_URL } from './fixtures.js';
import type { Page } from '@playwright/test';
import { openInspector, overlayChip, panel, pin } from './support/panel.js';

/**
 * Pointing at the box-model diagram singles that part out on the page.
 *
 * The fixture's cards have a 2px border and 16px of padding on every side,
 * and no margin, which is what the expected labels below are built from.
 */

async function chipDetail(page: Page): Promise<string | null> {
  return (await overlayChip(page))?.detail ?? null;
}

function diagram(page: Page) {
  return panel(page).locator('.boxdiagram');
}

test.describe('box model hover', () => {
  test('names the band and the edge under the pointer', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '.card >> nth=0');

    await diagram(page).locator('.bd-padding > .bd-name').hover();
    await expect.poll(() => chipDetail(page)).toBe('padding: 16px');

    await diagram(page).locator('.bd-padding > .bd-t').hover();
    await expect.poll(() => chipDetail(page)).toBe('padding-top: 16px');

    await diagram(page).locator('.bd-border > .bd-l').hover();
    await expect.poll(() => chipDetail(page)).toBe('border-left-width: 2px');

    await diagram(page).locator('.bd-content').hover();
    await expect.poll(() => chipDetail(page)).toMatch(/^content: [\d.]+ × [\d.]+$/);
  });

  test('goes back to the whole box when the pointer leaves', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '.card >> nth=0');

    await diagram(page).locator('.bd-padding > .bd-name').hover();
    await expect.poll(() => chipDetail(page)).toBe('padding: 16px');

    await panel(page).locator('.foot').hover();
    await expect.poll(() => chipDetail(page)).toMatch(/^[\d.]+ × [\d.]+$/);
  });

  test('shows the part even with the picker off', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '.card >> nth=0');

    const inspect = panel(page).locator('.head-actions .primary-btn');
    await inspect.click();
    await expect(inspect).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => overlayChip(page)).toBeNull();

    await diagram(page).locator('.bd-padding > .bd-name').hover();
    await expect.poll(() => chipDetail(page)).toBe('padding: 16px');

    // With the picker off and the pointer gone, the page is handed back.
    await panel(page).locator('.foot').hover();
    await expect.poll(async () => overlayChip(page)).toBeNull();
  });
});
