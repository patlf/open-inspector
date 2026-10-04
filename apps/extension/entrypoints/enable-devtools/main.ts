import { browser } from 'wxt/browser';

/**
 * Turns the Firefox DevTools tab on and off.
 *
 * A page of its own because `permissions.request` has to be called from a
 * click in an extension page: content scripts have no permissions API, and
 * the worker has no click to call it from. The settings view opens this.
 */

// `devtools` is optional in the Firefox manifest and nowhere else; the
// polyfill's permission type predates it.
const DEVTOOLS = { permissions: ['devtools'] } as unknown as Parameters<
  typeof browser.permissions.request
>[0];

const status = document.getElementById('status') as HTMLElement;
const toggle = document.getElementById('toggle') as HTMLButtonElement;

async function refresh(): Promise<void> {
  const on = await browser.permissions.contains(DEVTOOLS);
  status.textContent = on ? 'The DevTools tab is on.' : 'The DevTools tab is off.';
  status.dataset['on'] = String(on);
  toggle.textContent = on ? 'Turn off' : 'Turn on';
  toggle.dataset['on'] = String(on);
  toggle.disabled = false;
}

toggle.addEventListener('click', () => {
  // Asked inside the click handler itself, as Firefox requires.
  const change =
    toggle.dataset['on'] === 'true'
      ? browser.permissions.remove(DEVTOOLS)
      : browser.permissions.request(DEVTOOLS);
  void change.finally(() => void refresh());
});

void refresh();
