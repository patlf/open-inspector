import {
  testWithHostAccess as test,
  testWithStaleWorker as staleWorkerTest,
  expect,
  FIXTURE_URL,
  activeTabId,
  toggleInspector,
} from './fixtures.js';
import type { Page } from '@playwright/test';

/**
 * The panel's own behaviour, driven through the real extension.
 *
 * Separate from inspector.spec.ts, which covers the overlay and the injection
 * plumbing. These are about what the panel does once it is on screen — the
 * parts a unit test cannot reach, because they depend on a real cascade, real
 * computed styles and a real shadow tree.
 */

/** Reach into the panel's shadow root. It is open, unlike the overlay's. */
function inPanel(page: Page, selector: string) {
  return page.evaluate(
    (css) =>
      document.querySelector('open-inspector-panel')?.shadowRoot?.querySelector(css) ?? null,
    selector,
  );
}

async function panelText(page: Page, selector: string): Promise<string | null> {
  return page.evaluate(
    (css) =>
      document
        .querySelector('open-inspector-panel')
        ?.shadowRoot?.querySelector(css)
        ?.textContent?.trim() ?? null,
    selector,
  );
}

async function clickInPanel(page: Page, selector: string, nth = 0): Promise<boolean> {
  return page.evaluate(
    ([css, index]) => {
      const shadow = document.querySelector('open-inspector-panel')?.shadowRoot;
      const target = shadow?.querySelectorAll(css as string)[index as number];
      if (!(target instanceof HTMLElement)) return false;
      target.click();
      return true;
    },
    [selector, nth] as const,
  );
}

/** Choose a tab by its visible label. */
async function openTab(page: Page, label: string): Promise<void> {
  const clicked = await page.evaluate((wanted) => {
    const shadow = document.querySelector('open-inspector-panel')?.shadowRoot;
    const tab = [...(shadow?.querySelectorAll('.tab') ?? [])].find(
      (button) => button.textContent?.trim() === wanted,
    );
    if (!(tab instanceof HTMLElement)) return false;
    tab.click();
    return true;
  }, label);

  expect(clicked, `tab "${label}" should exist`).toBe(true);
  await page.waitForTimeout(60);
}

/** Pin an element by clicking it, so the panel stops following the pointer. */
async function pin(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(80);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(120);
}

async function open(page: Page, serviceWorker: Parameters<typeof activeTabId>[0]) {
  await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
  const tabId = await activeTabId(serviceWorker);
  expect((await toggleInspector(serviceWorker, tabId)).active).toBe(true);
  await page.waitForTimeout(150);
  return tabId;
}

test.describe('panel search', () => {
  test('filters rows down to what was typed', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');

    const before = await page.evaluate(
      () =>
        document.querySelector('open-inspector-panel')?.shadowRoot?.querySelectorAll('.row')
          .length ?? 0,
    );
    expect(before).toBeGreaterThan(5);

    await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')?.shadowRoot;
      const search = shadow?.querySelector('.search');
      if (!(search instanceof HTMLInputElement)) throw new Error('no search box');
      search.value = 'padding';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(80);

    const rows = await page.evaluate(() =>
      [...(document.querySelector('open-inspector-panel')?.shadowRoot?.querySelectorAll('.row') ??
        [])].map((row) => row.textContent ?? ''),
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(before);
    // Every surviving row mentions it somewhere — label, value or property.
    for (const row of rows) expect(row.toLowerCase()).toContain('padding');
  });

  test('hides the groups it emptied rather than leaving bare headings', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');

    await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')?.shadowRoot;
      const search = shadow?.querySelector('.search');
      if (!(search instanceof HTMLInputElement)) throw new Error('no search box');
      search.value = 'padding';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(80);

    // A group left holding only its own title must not be on screen.
    const bareTitles = await page.evaluate(
      () =>
        [
          ...(document
            .querySelector('open-inspector-panel')
            ?.shadowRoot?.querySelectorAll('.group') ?? []),
        ].filter((group) => {
          const meaningful = [...group.children].filter(
            (child) => !child.classList.contains('group-title'),
          );
          return meaningful.length === 0 && getComputedStyle(group).display !== 'none';
        }).length,
    );

    expect(bareTitles).toBe(0);
  });
});

test.describe('markup export', () => {
  test('writes the element back out as source, without our own attributes', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');
    await openTab(page, 'Markup');

    const html = await panelText(page, 'pre');
    expect(html).toBeTruthy();
    expect(html).toContain('<article');
    expect(html).toContain('class=');
    // The inspector must never appear in markup meant for someone's codebase.
    expect(html).not.toContain('open-inspector');

    // JSX is the same subtree in the other dialect.
    await clickInPanel(page, '.export-actions button', 1);
    await page.waitForTimeout(60);

    const jsx = await panelText(page, 'pre');
    expect(jsx).toContain('className=');
    expect(jsx).not.toContain(' class=');
  });
});

test.describe('hide element', () => {
  test('takes the element out of the layout and puts it back', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');

    const displayOf = () =>
      page.evaluate(() => {
        const element = document.querySelector('.card');
        return element ? getComputedStyle(element).display : null;
      });

    expect(await displayOf()).not.toBe('none');

    // The eye button is the only aria-pressed icon-btn in the toolbar.
    expect(await clickInPanel(page, '.toolbar .icon-btn')).toBe(true);
    await page.waitForTimeout(100);
    expect(await displayOf()).toBe('none');

    expect(await clickInPanel(page, '.toolbar .icon-btn')).toBe(true);
    await page.waitForTimeout(100);
    expect(await displayOf()).not.toBe('none');
  });

  test('leaves nothing behind when the inspector closes', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    const tabId = await open(page, serviceWorker);
    await pin(page, '.card');

    await clickInPanel(page, '.toolbar .icon-btn');
    await page.waitForTimeout(100);
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('.card')!).display),
    ).toBe('none');

    await toggleInspector(serviceWorker, tabId);
    await page.waitForTimeout(150);

    // Not merely visible again — the style attribute we created must be gone,
    // down to not leaving an empty one behind.
    const trace = await page.evaluate(() => {
      const element = document.querySelector('.card')!;
      return {
        display: getComputedStyle(element).display,
        hasStyleAttribute: element.hasAttribute('style'),
      };
    });

    expect(trace.display).not.toBe('none');
    expect(trace.hasStyleAttribute).toBe(false);
  });
});

test.describe('editing type and colour', () => {
  test('font-size is editable from the Type tab', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');
    await openTab(page, 'Type');

    const applied = await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')?.shadowRoot;
      const rows = [...(shadow?.querySelectorAll('.row') ?? [])];
      const row = rows.find((candidate) =>
        candidate.querySelector('.row-label')?.textContent?.trim() === 'size',
      );
      const trigger = row?.querySelector('.editable');
      if (!(trigger instanceof HTMLElement)) return 'no editable size row';
      trigger.click();
      return 'opened';
    });
    expect(applied).toBe('opened');
    await page.waitForTimeout(60);

    await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')?.shadowRoot;
      const input = shadow?.querySelector('.edit-input');
      if (!(input instanceof HTMLInputElement)) throw new Error('no input');
      input.value = '31px';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Enter has to land in a later frame. Preact re-renders asynchronously, so
    // dispatching both in one synchronous block would run the keydown handler
    // from the render before the typing — which still closes over the old
    // draft, and commits nothing. A real keystroke always has a repaint
    // between it and the last one.
    await page.waitForTimeout(80);

    await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')?.shadowRoot;
      const input = shadow?.querySelector('.edit-input');
      if (!(input instanceof HTMLInputElement)) throw new Error('input closed early');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await page.waitForTimeout(120);

    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('.card')!).fontSize),
    ).toBe('31px');
  });

  test('a colour row offers a picker seeded with its current value', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');
    await openTab(page, 'Color');

    const well = await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')?.shadowRoot;
      const input = shadow?.querySelector('.color-well');
      if (!(input instanceof HTMLInputElement)) return null;
      return { type: input.type, value: input.value };
    });

    expect(well).not.toBeNull();
    expect(well?.type).toBe('color');
    // Seeded from the page, not left at the control's default black.
    expect(well?.value).toMatch(/^#[0-9a-f]{6}$/);
  });
});

test.describe('the panel collapses', () => {
  test('shrinks to an edge tab and comes back', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');

    expect(await inPanel(page, '.panel')).not.toBeNull();

    // The collapse control is the last icon button in the header row.
    await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')?.shadowRoot;
      const buttons = [...(shadow?.querySelectorAll('.head-actions .icon-btn') ?? [])];
      const collapse = buttons.find((button) =>
        button.getAttribute('title')?.startsWith('Collapse'),
      );
      if (!(collapse instanceof HTMLElement)) throw new Error('no collapse button');
      collapse.click();
    });
    await page.waitForTimeout(80);

    expect(await inPanel(page, '.panel')).toBeNull();
    expect(await inPanel(page, '.panel-tab')).not.toBeNull();

    await clickInPanel(page, '.panel-tab');
    await page.waitForTimeout(80);
    expect(await inPanel(page, '.panel')).not.toBeNull();
  });
});

test.describe('responsive preview', () => {
  /**
   * The claim being tested is that this is a *real* resize.
   *
   * Constraining the page inside a narrow box looks the same in a screenshot
   * but media queries evaluate against the viewport, so a boxed page still
   * renders its desktop layout. Asserting on `innerWidth` — and on a media
   * query actually matching — is the difference between the feature working
   * and merely appearing to.
   */
  test('moves the real window, so media queries re-evaluate', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    const tabId = await open(page, serviceWorker);
    await pin(page, '.card');

    /**
     * Start from bounds the API will accept.
     *
     * Chrome refuses any `windows.update` whose bounds fall more than half
     * outside the visible screen, and the window Playwright creates is wide
     * enough on this display to trip that on the way back. Shrinking first
     * keeps the test about the feature rather than about the CI display.
     */
    await serviceWorker.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id as number);
      await chrome.windows.update(tab.windowId!, { state: 'normal', width: 900, height: 700 });
    }, tabId);
    await page.waitForTimeout(200);

    /**
     * Measured through the browser, not through `window.innerWidth`.
     *
     * Playwright pins the page's viewport with `setDeviceMetricsOverride`, so
     * `innerWidth` stays at the emulated size no matter what the real window
     * does. The window is what this feature moves, so the window is what the
     * test has to look at.
     */
    const windowWidth = async (): Promise<number> =>
      serviceWorker.evaluate(async (id) => {
        const tab = await chrome.tabs.get(id as number);
        const win = await chrome.windows.get(tab.windowId!);
        return win.width ?? 0;
      }, tabId);

    const before = await windowWidth();
    expect(before).toBe(900);

    const clicked = await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')?.shadowRoot;
      const button = [...(shadow?.querySelectorAll('.viewport-btn') ?? [])].find(
        (candidate) => candidate.textContent?.trim() === '375',
      );
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    });
    expect(clicked, 'the 375 preset should be offered inside the extension').toBe(true);

    // Every platform enforces a minimum window width — around 570px on macOS
    // — so 375 is a request, not a guarantee. What must be true is that the
    // window really moved, and moved narrower.
    await expect.poll(windowWidth, { timeout: 4000 }).toBeLessThan(before);

    /**
     * The panel stays put, whatever width was asked for.
     *
     * It used to collapse itself below 900px to avoid covering the viewport it
     * had just created. That reads as the panel crashing on a button press,
     * and it takes the viewport control away with it — leaving no visible way
     * back out of a 375px window. It now says the page is covered and offers
     * the collapse instead.
     */
    expect(await inPanel(page, '.panel')).not.toBeNull();
    expect(await inPanel(page, '.panel-tab')).toBeNull();
    expect(await inPanel(page, '.coverage-hint')).not.toBeNull();

    // "auto" puts back the size we found, not some remembered default.
    const restored = await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')?.shadowRoot;
      const button = [...(shadow?.querySelectorAll('.viewport-btn') ?? [])].find(
        (candidate) => candidate.textContent?.trim() === 'auto',
      );
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    });
    expect(restored).toBe(true);

    await expect.poll(windowWidth, { timeout: 4000 }).toBe(before);
  });
});

test.describe('force-state toggles', () => {
  /**
   * The availability answer used to arrive late, and wrongly.
   *
   * The controller that works out which states a page styles was built on the
   * first toggle press. Until then every state advertised itself as available;
   * pressing one produced the real — usually much shorter — list, and the state
   * just forced could fall outside it. It then rendered pressed *and* disabled,
   * a combination no rule styled: white label, blanked background, a third
   * opacity. The control vanished, and with it the only way to turn it off.
   */
  test('stay legible and releasable once forced', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await page.addStyleTag({
      content: '#plain-button:hover { background: rgb(0, 128, 0) !important; }',
    });

    await pin(page, '#plain-button');
    // The availability scan rides along with the settled page scan.
    await page.waitForTimeout(400);

    const readToggle = () =>
      page.evaluate(() => {
        const shadow = document.querySelector('open-inspector-panel')!.shadowRoot!;
        const button = [...shadow.querySelectorAll('.state-toggle')].find(
          (candidate) => candidate.textContent === ':hover',
        ) as HTMLButtonElement | undefined;
        if (!button) return null;

        const style = getComputedStyle(button);
        return {
          pressed: button.getAttribute('aria-pressed'),
          disabled: button.disabled,
          color: style.color,
          background: style.backgroundColor,
          opacity: Number(style.opacity),
        };
      });

    // The page styles :hover, so the toggle must be usable from the start —
    // no click needed to discover that.
    expect((await readToggle())?.disabled).toBe(false);

    await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')!.shadowRoot!;
      const button = [...shadow.querySelectorAll('.state-toggle')].find(
        (candidate) => candidate.textContent === ':hover',
      ) as HTMLButtonElement | undefined;
      button?.click();
    });
    await page.waitForTimeout(150);

    const forced = await readToggle();
    expect(forced?.pressed).toBe('true');
    // Releasable: a forced state is never disabled, whatever the scan concluded.
    expect(forced?.disabled).toBe(false);
    // Legible: an opaque, filled chip rather than white-on-white.
    expect(forced?.opacity).toBe(1);
    expect(forced?.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(forced?.background).not.toBe(forced?.color);
  });

  test('report honestly which states the page styles, before being pressed', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '#plain-button');
    await page.waitForTimeout(400);

    // This fixture styles no pseudo-states at all. Every toggle saying so up
    // front beats every toggle claiming to work and then not.
    const states = await page.evaluate(() =>
      [
        ...document.querySelector('open-inspector-panel')!.shadowRoot!.querySelectorAll(
          '.state-toggle',
        ),
      ].map((button) => (button as HTMLButtonElement).disabled),
    );

    expect(states.length).toBeGreaterThan(0);
    expect(states.every(Boolean)).toBe(true);
  });
});

staleWorkerTest.describe('when the background worker is stale', () => {
  /**
   * The failure that hides best is the one that looks like a limit.
   *
   * A resize request to a worker that never answers hangs rather than
   * rejecting, so the panel had nothing to report and fell back to showing the
   * width it measured — which is indistinguishable from a resize that worked
   * and was clamped. The feature appeared present and quietly did nothing.
   */
  staleWorkerTest('says so rather than reporting an unchanged width', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });

    // This worker cannot toggle anything, so inject and start it directly.
    const tabId = await activeTabId(serviceWorker);
    await serviceWorker.evaluate(async (id) => {
      await chrome.scripting.executeScript({
        target: { tabId: id as number },
        files: ['content-scripts/inspector.js'],
      });
      await chrome.tabs.sendMessage(id as number, { type: 'open-inspector:toggle' });
    }, tabId);
    await page.waitForTimeout(300);

    await pin(page, '.card');

    await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')!.shadowRoot!;
      const preset = [...shadow.querySelectorAll('.viewport-btn')].find(
        (button) => button.textContent?.trim() === '768',
      );
      (preset as HTMLElement | undefined)?.click();
    });

    // Longer than the deadline the content script puts on the round trip.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              document
                .querySelector('open-inspector-panel')
                ?.shadowRoot?.querySelector('.viewport-actual')
                ?.textContent ?? null,
          ),
        { timeout: 8000 },
      )
      .toBe('refused');

    const hint = await page.evaluate(
      () =>
        document
          .querySelector('open-inspector-panel')
          ?.shadowRoot?.querySelector('.coverage-hint[data-error="true"]')
          ?.textContent ?? '',
    );

    expect(hint).toContain('did not answer');
    // And it names the fix, rather than leaving the user to guess.
    expect(hint).toContain('chrome://extensions');
  });
});

test.describe('page-wide contrast audit', () => {
  /**
   * The single-element verdict answers "is this readable"; this answers
   * "where is this page unreadable", which is the question anyone auditing a
   * site actually has. Run on request rather than on every selection: it is a
   * second full walk of the document.
   */
  test('finds deliberately unreadable text and jumps to it', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);

    await page.addStyleTag({
      content: `
        #contrast-victim {
          color: #bbbbbb;
          background: #ffffff;
          font-size: 14px;
          padding: 10px;
        }
      `,
    });
    await page.evaluate(() => {
      const victim = document.createElement('p');
      victim.id = 'contrast-victim';
      victim.textContent = 'Nobody can read this grey on white';
      document.body.append(victim);
    });

    await pin(page, '.card');
    await openTab(page, 'Color');

    await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')!.shadowRoot!;
      const button = [...shadow.querySelectorAll('.sample-btn')].find((candidate) =>
        candidate.textContent?.includes('Scan'),
      );
      (button as HTMLElement | undefined)?.click();
    });

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              document.querySelector('open-inspector-panel')?.shadowRoot?.querySelectorAll(
                '.finding',
              ).length ?? 0,
          ),
        { timeout: 8000 },
      )
      .toBeGreaterThan(0);

    const findings = await page.evaluate(() =>
      [
        ...document.querySelector('open-inspector-panel')!.shadowRoot!.querySelectorAll('.finding'),
      ].map((row) => row.textContent ?? ''),
    );

    // #bbbbbb on white is about 1.9:1 — it must be in there.
    expect(findings.join(' ')).toContain('contrast-victim');

    // Pressing a finding selects that element, which is the point of the list.
    await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')!.shadowRoot!;
      const row = [...shadow.querySelectorAll('.finding')].find((candidate) =>
        candidate.textContent?.includes('contrast-victim'),
      );
      (row as HTMLElement | undefined)?.click();
    });
    await page.waitForTimeout(300);

    expect(await panelText(page, '.selector')).toContain('contrast-victim');
  });

  test('never audits the inspector itself', async ({ context, serviceWorker }) => {
    // The panel is in the document like anything else. Auditing our own UI
    // would bury the page's findings under our own.
    const page = await context.newPage();
    await open(page, serviceWorker);
    await pin(page, '.card');
    await openTab(page, 'Color');

    await page.evaluate(() => {
      const shadow = document.querySelector('open-inspector-panel')!.shadowRoot!;
      const button = [...shadow.querySelectorAll('.sample-btn')].find((candidate) =>
        candidate.textContent?.includes('Scan'),
      );
      (button as HTMLElement | undefined)?.click();
    });
    await page.waitForTimeout(1200);

    const findings = await page.evaluate(() =>
      [
        ...(document.querySelector('open-inspector-panel')?.shadowRoot?.querySelectorAll(
          '.finding',
        ) ?? []),
      ].map((row) => row.textContent ?? ''),
    );

    for (const finding of findings) expect(finding).not.toContain('open-inspector');
  });
});

test.describe('the support link', () => {
  test('is present, safe to click, and makes no request of its own', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();

    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await open(page, serviceWorker);
    await pin(page, '.card');

    const link = await page.evaluate(() => {
      const anchor = document
        .querySelector('open-inspector-panel')
        ?.shadowRoot?.querySelector('.foot-link');
      if (!(anchor instanceof HTMLAnchorElement)) return null;
      return { href: anchor.href, target: anchor.target, rel: anchor.rel, text: anchor.textContent };
    });

    expect(link?.text).toBe('Buy me a coffee');
    // A new tab, and one that cannot reach back into the page it came from.
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noopener');
    expect(link?.rel).toContain('noreferrer');

    // The link is inert until pressed. Rendering the panel must not touch the
    // network — which is why this is a text link and not the hosted badge.
    expect(requests.filter((url) => url.includes('buymeacoffee'))).toEqual([]);
  });

  test('shows on the first screen too, before anything is selected', async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await open(page, serviceWorker);

    expect(await panelText(page, '.foot-link')).toBe('Buy me a coffee');
  });
});
