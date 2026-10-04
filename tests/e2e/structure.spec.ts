import { testWithHostAccess as test, expect, FIXTURE_URL } from './fixtures.js';
import type { Locator, Page } from '@playwright/test';
import { openInspector, overlayLabel, panel, pin } from './support/panel.js';

/**
 * The structure drawer: the document as a tree, driven through the real
 * extension with real input.
 */

function drawer(page: Page): Locator {
  return panel(page).locator('.structure');
}

function toggle(page: Page): Locator {
  return panel(page).locator('button[aria-label="Structure"]');
}

/** The tree row whose text includes `text`. */
function treeRow(page: Page, text: string): Locator {
  return drawer(page).locator('.node', { hasText: text });
}

function selectedRow(page: Page): Locator {
  return drawer(page).locator('.node[aria-selected="true"]');
}

function header(page: Page): Locator {
  return panel(page).locator('.selector');
}

async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function openDrawer(page: Page): Promise<void> {
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(drawer(page)).toBeVisible();
}

test.describe('structure drawer', () => {
  test('opens expanded down to the selection', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '.card >> nth=1');

    await openDrawer(page);

    await expect(selectedRow(page)).toHaveCount(1);
    await expect(selectedRow(page)).toContainText('Second card');
    await expect(selectedRow(page)).toBeInViewport();
  });

  test('closes again from the same button', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');
    await openDrawer(page);

    await toggle(page).click();

    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(drawer(page)).toHaveCount(0);
  });

  test('hovering a row highlights its element without selecting it', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '.card >> nth=1');
    await openDrawer(page);
    await expect.poll(() => overlayLabel(page)).toBe('article.card');

    await treeRow(page, 'div.card-grid').hover();
    await expect.poll(() => overlayLabel(page)).toBe('div.card-grid');
    await expect(header(page)).toHaveText('article.card');
    await expect(selectedRow(page)).toContainText('Second card');

    // Off the tree, the highlight goes back to the selection.
    await panel(page).locator('.foot').hover();
    await expect.poll(() => overlayLabel(page)).toBe('article.card');
  });

  test('clicking a row selects its element', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '.card >> nth=0');
    await openDrawer(page);

    await treeRow(page, 'div.card-grid').click();

    await expect(header(page)).toHaveText('div.card-grid');
    await expect(selectedRow(page)).toContainText('div.card-grid');
    await expect(treeRow(page, 'First card')).toHaveAttribute('aria-selected', 'false');
  });

  test('arrows move through the rows and Enter selects', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '.card >> nth=0');
    await openDrawer(page);

    await selectedRow(page).focus();
    await page.keyboard.press('ArrowDown');
    await expect(treeRow(page, 'Second card')).toBeFocused();

    // Moving is looking: the selection holds until Enter.
    await expect(selectedRow(page)).toContainText('First card');

    await page.keyboard.press('Enter');
    await expect(selectedRow(page)).toContainText('Second card');
  });

  test('typing in the tree searches it, Enter picks a match, and Escape puts the tree back', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '.card >> nth=0');
    await openDrawer(page);

    await selectedRow(page).focus();
    await page.keyboard.type('second');
    const field = panel(page).locator('.tree-search');
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('second');
    await expect(drawer(page).locator('.node')).toHaveCount(1);
    await expect(panel(page).locator('.structure-count')).toHaveText('1 match');

    await page.keyboard.press('Enter');
    await expect(selectedRow(page)).toContainText('Second card');
    await expect(selectedRow(page)).toBeFocused();

    // Escape clears the search before anything else: the tree comes back,
    // still on the match, and the selection holds.
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
    await expect(treeRow(page, 'First card')).toBeVisible();
    await expect(selectedRow(page)).toContainText('Second card');
  });

  test('right opens a branch and left closes it', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    // Selecting a card opens the grid above it.
    await pin(page, '.card >> nth=0');
    await openDrawer(page);

    const grid = treeRow(page, 'div.card-grid');
    await grid.click();
    await expect(grid).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('ArrowLeft');
    await expect(grid).toHaveAttribute('aria-expanded', 'false');
    await expect(treeRow(page, 'First card')).toHaveCount(0);

    await page.keyboard.press('ArrowRight');
    await expect(grid).toHaveAttribute('aria-expanded', 'true');
    await expect(treeRow(page, 'First card')).toBeVisible();
  });

  test('highlights a tree selection with the picker off, until the tree closes too', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '.card >> nth=1');
    await openDrawer(page);

    const inspect = panel(page).locator('.head-actions .primary-btn');
    await inspect.click();
    await expect(inspect).toHaveAttribute('aria-pressed', 'false');

    // The tree is open, so choosing in it still shows on the page.
    await treeRow(page, 'div.card-grid').click();
    await expect(header(page)).toHaveText('div.card-grid');
    await panel(page).locator('.foot').hover();
    await expect.poll(() => overlayLabel(page)).toBe('div.card-grid');

    // Picker off and tree closed: the page is handed back, highlight and all.
    await toggle(page).click();
    await expect.poll(() => overlayLabel(page)).toBeNull();
    await expect(header(page)).toHaveText('div.card-grid');
  });

  test('a style element shows its source instead of a box', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');
    await openDrawer(page);

    const head = drawer(page).locator('.node', { hasText: /^head$/ });
    await head.locator('.node-twisty').click();

    // Matched by tag: the row also names where the block came from.
    const style = drawer(page)
      .locator('.node')
      .filter({ has: page.locator('.node-tag', { hasText: /^style$/ }) })
      .first();
    await expect(style.locator('.node-file')).toHaveText('inline');
    await style.click();

    await expect(header(page)).toHaveText('style');
    await expect(panel(page).locator('.group-title', { hasText: 'Source · CSS' })).toBeVisible();
    await expect(panel(page).locator('.body pre')).toContainText('{');
    await expect(panel(page).locator('.boxdiagram')).toHaveCount(0);
  });

  test('keeps the inspector’s own UI out of the tree', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');
    await openDrawer(page);

    await expect(drawer(page).locator('.node', { hasText: 'open-inspector' })).toHaveCount(0);
  });
});

test('the pointer over the panel does not inspect what is behind it', async ({
  context,
  serviceWorker,
}) => {
  /**
   * Probing at the pointer looks straight through the panel, so reaching for
   * anything in it used to swap the selection for whatever sat underneath on
   * the way. With the tree in the panel, that made rows impossible to reach
   * without pinning first.
   */
  const page = await context.newPage();
  await openInspector(page, serviceWorker, FIXTURE_URL);

  await page.locator('#plain-button').hover();
  await expect(header(page)).toHaveText('button#plain-button');

  await panel(page).locator('.body').hover();
  await nextFrames(page);

  await expect(header(page)).toHaveText('button#plain-button');
});
