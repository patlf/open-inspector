import { testWithHostAccess as test, expect, FIXTURE_URL, toggleInspector } from './fixtures.js';
import type { Page, Worker } from '@playwright/test';
import { openInspector, panel, pin } from './support/panel.js';

/**
 * Moving the panel, and finding it where it was left next time.
 *
 * Real mouse input throughout: a drag is a press on the rail, travel, and
 * a release, and only the release is saved.
 */

interface Placement {
  dock: 'left' | 'right' | null;
  x: number;
  y: number;
  width: number;
  height: number | null;
}

async function savedPlacement(serviceWorker: Worker): Promise<Placement | null> {
  return serviceWorker.evaluate(async () => {
    const stored = (await chrome.storage.local.get('settings'))['settings'] as
      | { panel?: Placement }
      | undefined;
    return stored?.panel ?? null;
  });
}

async function savePlacement(
  serviceWorker: Worker,
  partial: Omit<Placement, 'height'> & { height?: number | null },
): Promise<void> {
  const placement: Placement = { height: null, ...partial };
  await serviceWorker.evaluate(
    async (value: Placement) => chrome.storage.local.set({ settings: { panel: value } }),
    placement,
  );
}

function frame(page: Page) {
  return panel(page).locator('.panel');
}

/** Press on the centre of a handle and drag it by (dx, dy). */
async function dragHandle(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const box = await panel(page).locator(selector).boundingBox();
  if (!box) throw new Error(`no ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

/** A point on the rail's empty stretch, between the tabs and the buttons at its foot. */
async function railGrip(page: Page): Promise<{ x: number; y: number }> {
  const tabs = await panel(page).locator('.rail .tabs').boundingBox();
  const foot = await panel(page).locator('.rail-foot').boundingBox();
  if (!tabs || !foot) throw new Error('no rail');
  return { x: tabs.x + tabs.width / 2, y: (tabs.y + tabs.height + foot.y) / 2 };
}

/** Drag the panel by its rail, straight across to `x`, so the pointer stays on that stretch. */
async function dragRailTo(page: Page, x: number): Promise<void> {
  const grip = await railGrip(page);
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(x, grip.y, { steps: 8 });
  await page.mouse.up();
}

test.describe('panel placement', () => {
  test('dragging the rail floats the panel, and the drop is saved', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');

    await dragRailTo(page, 400);

    await expect(frame(page)).toHaveAttribute('data-side', 'float');
    await expect(panel(page).locator('.selector')).toHaveText('button#plain-button');
    await expect.poll(async () => (await savedPlacement(serviceWorker))?.dock).toBeNull();

    const box = await frame(page).boundingBox();
    const saved = await savedPlacement(serviceWorker);
    expect(Math.abs((box?.x ?? 0) - (saved?.x ?? -1))).toBeLessThanOrEqual(1);
    expect(Math.abs((box?.y ?? 0) - (saved?.y ?? -1))).toBeLessThanOrEqual(1);
  });

  test('the header does not drag the panel', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');

    const box = await panel(page).locator('.head-top .selector').boundingBox();
    if (!box) throw new Error('no panel header');
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(400, 200, { steps: 8 });
    await page.mouse.up();

    await expect(frame(page)).toHaveAttribute('data-side', 'right');
  });

  test('reopening puts the panel back where it was left', async ({ context, serviceWorker }) => {
    await savePlacement(serviceWorker, { dock: null, x: 200, y: 150, width: 400 });

    const page = await context.newPage();
    const tabId = await openInspector(page, serviceWorker, FIXTURE_URL);
    await expect(frame(page)).toHaveAttribute('data-side', 'float');
    expect(await frame(page).boundingBox()).toMatchObject({ x: 200, y: 150, width: 400 });

    // Closed and opened again in the same page, it is still there.
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(false);
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
    expect(await frame(page).boundingBox()).toMatchObject({ x: 200, y: 150, width: 400 });
  });

  test('dropping against a side edge docks it there', async ({ context, serviceWorker }) => {
    await savePlacement(serviceWorker, { dock: null, x: 300, y: 150, width: 348 });

    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');

    await dragRailTo(page, 2);

    await expect(frame(page)).toHaveAttribute('data-side', 'left');
    await expect.poll(async () => (await savedPlacement(serviceWorker))?.dock).toBe('left');
  });

  test('double-clicking the rail docks a floating panel to the nearer side', async ({
    context,
    serviceWorker,
  }) => {
    await savePlacement(serviceWorker, { dock: null, x: 700, y: 150, width: 348 });

    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    await pin(page, '#plain-button');

    const grip = await railGrip(page);
    await page.mouse.dblclick(grip.x, grip.y);

    await expect(frame(page)).toHaveAttribute('data-side', 'right');
    await expect.poll(async () => (await savedPlacement(serviceWorker))?.dock).toBe('right');
  });

  test('the bottom edge sets a height, which is saved and restored', async ({
    context,
    serviceWorker,
  }) => {
    await savePlacement(serviceWorker, { dock: null, x: 200, y: 100, width: 360 });

    const page = await context.newPage();
    const tabId = await openInspector(page, serviceWorker, FIXTURE_URL);
    const before = await frame(page).boundingBox();
    if (!before) throw new Error('no panel');

    await dragHandle(page, '.resize-bottom', 0, -150);

    await expect.poll(async () => (await savedPlacement(serviceWorker))?.height).not.toBeNull();
    const after = await frame(page).boundingBox();
    expect(Math.round(after?.height ?? 0)).toBeLessThan(Math.round(before.height) - 100);

    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(false);
    expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
    expect(Math.round((await frame(page).boundingBox())?.height ?? 0)).toBe(
      Math.round(after?.height ?? -1),
    );
  });

  test('the corner resizes width and height together', async ({ context, serviceWorker }) => {
    await savePlacement(serviceWorker, { dock: null, x: 200, y: 100, width: 360 });

    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    const before = await frame(page).boundingBox();
    if (!before) throw new Error('no panel');

    await dragHandle(page, '.resize-corner', 80, -120);

    const after = await frame(page).boundingBox();
    expect(after?.width ?? 0).toBeGreaterThan(before.width + 60);
    expect(after?.height ?? 0).toBeLessThan(before.height - 100);
    await expect
      .poll(async () => (await savedPlacement(serviceWorker))?.width)
      .toBeGreaterThan(before.width + 60);
  });

  test('double-clicking the bottom edge fills the height again', async ({
    context,
    serviceWorker,
  }) => {
    await savePlacement(serviceWorker, { dock: 'right', x: 12, y: 12, width: 348, height: 300 });

    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);
    expect(Math.round((await frame(page).boundingBox())?.height ?? 0)).toBe(300);

    await panel(page).locator('.resize-bottom').dblclick();

    await expect.poll(async () => (await savedPlacement(serviceWorker))?.height).toBeNull();
    const viewport = page.viewportSize();
    expect(Math.round((await frame(page).boundingBox())?.height ?? 0)).toBe(
      (viewport?.height ?? 0) - 24,
    );
  });

  test('a docked-right panel has no corner, since its right edge is pinned', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);

    await expect(frame(page)).toHaveAttribute('data-side', 'right');
    await expect(panel(page).locator('.resize-corner')).toHaveCount(0);
    await expect(panel(page).locator('.resize-bottom')).toHaveCount(1);
  });

  test('a position saved in a bigger window is pulled back on screen', async ({
    context,
    serviceWorker,
  }) => {
    await savePlacement(serviceWorker, { dock: null, x: 5000, y: 5000, width: 348 });

    const page = await context.newPage();
    await openInspector(page, serviceWorker, FIXTURE_URL);

    const box = await frame(page).boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error('no panel or viewport');
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeLessThan(viewport.height - 100);
  });
});
