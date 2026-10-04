import { testWithHostAccess as test, expect, FIXTURE_URL, toggleInspector } from './fixtures.js';
import type { Page, Worker } from '@playwright/test';
import { openInspector, openTab, panel, pin, row } from './support/panel.js';

/**
 * The settings view, and the one place the extension keeps anything.
 *
 * Every test gets a fresh browser profile, so storage starts empty and the
 * defaults are what a new install sees.
 */

async function storedSettings(serviceWorker: Worker): Promise<unknown> {
  return serviceWorker.evaluate(
    async () => (await chrome.storage.local.get('settings'))['settings'] ?? null,
  );
}

async function storeSettings(serviceWorker: Worker, settings: object): Promise<void> {
  await serviceWorker.evaluate(
    async (value: object) => chrome.storage.local.set({ settings: value }),
    settings,
  );
}

function settingsButton(page: Page) {
  return panel(page).locator('#oi-tab-settings');
}

function background(page: Page) {
  return row(page, 'background').first();
}

test.describe('settings', () => {
  test('colours default to oklch, in the rows and the exports', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');

    await expect(background(page)).toContainText('oklch(');

    await openTab(page, 'export');
    await expect(panel(page).locator('.body pre')).toContainText('oklch(');
  });

  test('choosing a format in the panel rewrites values and saves the choice', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');

    await settingsButton(page).click();
    await expect(settingsButton(page)).toHaveAttribute('aria-pressed', 'true');
    await panel(page).getByRole('button', { name: 'HEX', exact: true }).click();

    await expect.poll(() => storedSettings(serviceWorker)).toMatchObject({ colorFormat: 'hex' });

    // Pressed again, the button goes back to the tab you came from.
    await settingsButton(page).click();
    await expect(panel(page).locator('#oi-tab-styles')).toHaveAttribute('aria-selected', 'true');
    await expect(background(page)).toContainText('#');
    await expect(background(page)).not.toContainText('oklch(');
  });

  test('HEXA writes all eight digits, alpha included', async ({ context, serviceWorker }) => {
    await storeSettings(serviceWorker, { colorFormat: 'hexa' });

    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');

    await expect(background(page).locator('.row-value')).toHaveText(/^\s*#[0-9a-f]{8}\s*$/);
  });

  test('a change saved elsewhere reaches a panel that is already open', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');
    await expect(background(page)).toContainText('oklch(');

    await storeSettings(serviceWorker, { colorFormat: 'rgb' });

    await expect(background(page)).toContainText('rgb(');
  });

  test('the choice is there again the next time the inspector opens', async ({
    context,
    serviceWorker,
  }) => {
    await storeSettings(serviceWorker, { colorFormat: 'hsl' });

    const page = await context.newPage();
    const tabId = await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');
    await expect(background(page)).toContainText('hsl(');

    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(false);
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
    await pin(page, '#plain-button');
    await expect(background(page)).toContainText('hsl(');
  });
});
