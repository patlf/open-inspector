import { testWithHostAccess as test, expect } from './fixtures.js';
import type { Locator, Page } from '@playwright/test';
import { PLAYGROUND, openInspector, openTab, panel, pin } from './support/panel.js';

/**
 * The JS view and the tree's JS marks, through the real extension.
 *
 * The React and Vue cases can only pass if the worker's probe really ran in
 * the page's own world: the props it reads are invisible from the content
 * script's.
 */

const JS_URL = `${PLAYGROUND}/js.html`;

function treeRow(page: Page, text: string): Locator {
  return panel(page).locator('.structure .node', { hasText: text });
}

async function openDrawer(page: Page): Promise<void> {
  const toggle = panel(page).locator('button[aria-label="Structure"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

test.describe('js view', () => {
  test('marks every element with a handler in the tree, and only those', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, JS_URL);
    await pin(page, '#plain');
    await openDrawer(page);

    for (const label of ['button#inline', 'button#property', 'button#react', 'button#vue', 'a#js-link']) {
      await expect(treeRow(page, label).locator('.node-js')).toBeVisible();
    }
    await expect(treeRow(page, 'p#plain').locator('.node-js')).toHaveCount(0);
  });

  test('JS only lists just the elements with handlers, and turns back off', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, JS_URL);
    await pin(page, '#plain');
    await openDrawer(page);

    const jsOnly = panel(page).getByRole('button', { name: 'Only elements with JS' });
    await jsOnly.click();
    await expect(jsOnly).toHaveAttribute('aria-pressed', 'true');

    const rows = panel(page).locator('.structure .node');
    await expect(rows).toHaveCount(5);
    await expect(rows.locator('.node-js')).toHaveCount(5);
    await expect(panel(page).locator('.structure-count')).toHaveText('5 with handlers');
    await expect(treeRow(page, 'p#plain')).toHaveCount(0);

    // A row still selects its element.
    await treeRow(page, 'button#vue').click();
    await expect(panel(page).locator('.selector')).toContainText('button#vue');

    await jsOnly.click();
    await expect(jsOnly).toHaveAttribute('aria-pressed', 'false');
    await expect(treeRow(page, 'p#plain')).toHaveCount(1);
  });

  test('double-clicking a row with handlers, or clicking its badge, opens the JS tab', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, JS_URL);
    await pin(page, '#plain');
    await openDrawer(page);

    // A row without handlers leaves the tab alone.
    await treeRow(page, 'p#plain').dblclick();
    await expect(panel(page).locator('#oi-tab-styles')).toHaveAttribute('aria-selected', 'true');

    // Its badge comes from the page-world probe, which answers after the tree first draws.
    const property = treeRow(page, 'button#property');
    await expect(property.locator('.node-js')).toBeVisible();
    await property.dblclick();
    await expect(panel(page).locator('#oi-tab-js')).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page).locator('.group', { hasText: 'Event handlers' }).locator('.js-item')).toHaveCount(1);

    // A single click on a row's badge does the same, for that row.
    await panel(page).locator('#oi-tab-styles').click();
    await treeRow(page, 'button#inline').locator('.node-js').click();
    await expect(panel(page).locator('#oi-tab-js')).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page).locator('.selector')).toContainText('button#inline');
  });

  test('Expand all opens every node, and Collapse all closes them', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, JS_URL);
    await pin(page, '#plain');
    await openDrawer(page);

    const rows = panel(page).locator('.structure .node');
    const expand = panel(page).getByRole('button', { name: 'Expand all' });
    const collapse = panel(page).getByRole('button', { name: 'Collapse all' });

    // Every node open: the <style> in <head> is listed, which nothing else expanded.
    await expand.click();
    await expect(collapse).toBeVisible();
    await expect(treeRow(page, 'style')).toHaveCount(1);
    await expect(treeRow(page, 'button#react')).toHaveCount(1);

    await collapse.click();
    await expect(expand).toBeVisible();
    await expect(rows).toHaveCount(3); // html, head, body
    await expect(rows.first()).toContainText('html');
  });

  test('lists a React prop handler, read from the page world', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, JS_URL);
    await pin(page, '#react');
    await openTab(page, 'js');

    const handlers = panel(page).locator('.group', { hasText: 'Event handlers' });
    await expect(handlers.locator('.js-item')).toHaveCount(1);
    await expect(handlers).toContainText('click');
    await expect(handlers).toContainText('React');
    await expect(handlers).toContainText('openDialog');
    await expect(handlers).toContainText('Read from inline attributes');
  });

  test('shows an inline attribute once, as written', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, JS_URL);
    await pin(page, '#inline');
    await openTab(page, 'js');

    const items = panel(page).locator('.group', { hasText: 'Event handlers' }).locator('.js-item');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('attribute');
    await expect(items.first().locator('.js-source')).toHaveText('return false');
  });

  test('lists the page’s scripts, with an inline one’s source', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, JS_URL);
    await pin(page, '#plain');
    await openTab(page, 'js');

    // The dev server adds its own client script too, so the inline one is
    // found by name rather than by count.
    const scripts = panel(page).locator('.group', { hasText: 'Scripts on this page' });
    const inline = scripts.locator('.js-item', { hasText: 'inline' });
    await expect(inline).toHaveCount(1);
    await inline.locator('summary').click();
    const source = inline.locator('.code-block pre');
    await expect(source).toContainText('saveDraft');

    // Written on one line, shown formatted: the worker beautifies it.
    await expect(source).toContainText(
      "document.getElementById('react')['__reactProps$fixture'] = {\n  onClick: function openDialog() {},",
    );
  });
});
