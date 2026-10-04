import { defineBackground } from 'wxt/sandbox';
import { script } from '@open-inspector/core';
import beautifyJs from 'js-beautify/js/src/javascript/index.js';
import {
  DEVTOOLS_ATTACH,
  DEVTOOLS_PORT,
  INSPECTOR_SCRIPT,
  PAGE_PORT,
  PING,
  TOGGLE,
  isDevtoolsHello,
  isDevtoolsSetupMessage,
  isDevtoolsStart,
  isBeautifyMessage,
  isHandlersMessage,
  isResizeMessage,
  isSaveMessage,
  type DevtoolsStatusMessage,
  type HandlersResponse,
  type ResizeResponse,
  type ToggleResponse,
} from '../lib/messages.js';

/**
 * Ask the tab whether the inspector is already there.
 *
 * `sendMessage` rejects when nothing is listening, which is the documented way
 * to detect an uninjected tab — there is no "is my content script present"
 * API. A rejection here is an expected outcome, not an error.
 */
async function isInjected(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.sendMessage(tabId, { type: PING });
    return true;
  } catch {
    return false;
  }
}

/**
 * Inject the inspector if needed, then toggle it.
 *
 * `executeScript` is what consumes the `activeTab` grant. It fails on pages the
 * browser reserves — the web store, `about:` and `chrome://` URLs, PDF viewers
 * — and there is nothing to be done about that beyond failing quietly.
 */
async function toggleInspectorNow(tabId: number): Promise<void> {
  try {
    if (!(await isInjected(tabId))) {
      await browser.scripting.executeScript({
        target: { tabId },
        files: [INSPECTOR_SCRIPT],
      });
    }

    // A DevTools tab already showing this tab gets the panel, before the
    // toggle opens it, so it never flashes up in the page first.
    if (devtoolsPorts.has(tabId)) await attachPage(tabId, false);

    const response = (await browser.tabs.sendMessage(tabId, { type: TOGGLE })) as
      | ToggleResponse
      | undefined;

    await browser.action.setBadgeText({
      tabId,
      text: response?.active ? 'on' : '',
    });
  } catch (error) {
    // Restricted pages are the common case and not worth alarming the user
    // over; anything else is a real bug and should be visible in the worker's
    // console.
    console.debug('[open-inspector] could not toggle on tab', tabId, error);
  }
}

type Port = ReturnType<typeof browser.runtime.connect>;

/**
 * The Firefox DevTools tab, joined to the page it shows.
 *
 * The tab's panel cannot reach the content script, and the content script
 * cannot reach DevTools: each holds one port to this worker, and messages
 * for the same tab are passed straight across. The worker reads none of
 * them beyond the few it acts on itself.
 */
const devtoolsPorts = new Map<number, Port>();
const pagePorts = new Map<number, Port>();

function tellDevtools(tabId: number, status: DevtoolsStatusMessage): void {
  devtoolsPorts.get(tabId)?.postMessage(status);
}

/** Ask the content script to connect, and to start if `activate`. */
async function attachPage(tabId: number, activate: boolean): Promise<void> {
  await browser.tabs.sendMessage(tabId, { type: DEVTOOLS_ATTACH, activate });
}

/**
 * The DevTools tab's Start button.
 *
 * It only starts an inspector already in the page. Injecting one needs
 * `activeTab`, which Firefox grants for the toolbar button, the shortcut and
 * menus — not for a click in a DevTools panel — so the tab offers this
 * button only once the content script is there, and says how to start it
 * otherwise. The injection attempt stays, for a tab where access is still
 * held from an earlier toggle.
 */
async function startFromDevtools(tabId: number): Promise<void> {
  try {
    if (!(await isInjected(tabId))) {
      await browser.scripting.executeScript({ target: { tabId }, files: [INSPECTOR_SCRIPT] });
    }
    await attachPage(tabId, true);
    await browser.action.setBadgeText({ tabId, text: 'on' });
    tellDevtools(tabId, { type: 'open-inspector:status', injected: true });
  } catch (error) {
    tellDevtools(tabId, {
      type: 'open-inspector:status',
      injected: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function onDevtoolsConnect(port: Port): void {
  let tabId: number | null = null;

  port.onMessage.addListener((message: unknown) => {
    // The first message says which tab this DevTools window is showing.
    if (tabId === null) {
      if (!isDevtoolsHello(message)) return;
      const id = message.tabId;
      tabId = id;
      devtoolsPorts.get(id)?.disconnect();
      devtoolsPorts.set(id, port);
      void isInjected(id).then(async (injected) => {
        tellDevtools(id, { type: 'open-inspector:status', injected });
        if (injected) await attachPage(id, false).catch(() => undefined);
      });
      return;
    }

    if (isDevtoolsStart(message)) {
      void startFromDevtools(tabId);
      return;
    }
    pagePorts.get(tabId)?.postMessage(message);
  });

  port.onDisconnect.addListener(() => {
    if (tabId === null || devtoolsPorts.get(tabId) !== port) return;
    devtoolsPorts.delete(tabId);
    // Closing DevTools hands the panel back to the page.
    const page = pagePorts.get(tabId);
    pagePorts.delete(tabId);
    page?.disconnect();
  });
}

function onPageConnect(port: Port): void {
  const tabId = port.sender?.tab?.id;
  if (tabId == null || !devtoolsPorts.has(tabId)) {
    port.disconnect();
    return;
  }

  pagePorts.get(tabId)?.disconnect();
  pagePorts.set(tabId, port);
  port.onMessage.addListener((message: unknown) => devtoolsPorts.get(tabId)?.postMessage(message));
  port.onDisconnect.addListener(() => {
    if (pagePorts.get(tabId) !== port) return;
    pagePorts.delete(tabId);
    tellDevtools(tabId, { type: 'open-inspector:status', injected: false });
  });
}

/** The toggle still in flight for each tab. */
const pendingToggles = new Map<number, Promise<void>>();

/**
 * Toggle, one request at a time per tab.
 *
 * Two quick clicks used to run side by side: both pings missed, both injected
 * the script, and the tab ended up with two inspectors or none. Chaining each
 * toggle onto the last means the second click sees the first one's result —
 * two clicks are exactly on then off.
 */
function toggleInspector(tabId: number): Promise<void> {
  const previous = pendingToggles.get(tabId) ?? Promise.resolve();
  const next = previous.then(() => toggleInspectorNow(tabId));
  pendingToggles.set(tabId, next);
  void next.finally(() => {
    if (pendingToggles.get(tabId) === next) pendingToggles.delete(tabId);
  });
  return next;
}

/**
 * Start a download from the page's own world.
 *
 * A content script cannot: Chrome silently ignores downloads begun in an
 * isolated world. Running the anchor click in the main world through
 * `scripting.executeScript` works, costs no additional permission, and keeps
 * the extension itself from ever issuing a request — the browser fetches, and
 * only because someone pressed save.
 */
async function saveInPage(tabId: number, href: string, filename: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [href, filename],
    func: (url: string, name: string) => {
      /**
       * A `data:` URI has to become a blob first.
       *
       * Chrome will not download a data URI through an anchor — the click is
       * accepted and nothing happens, with no error anywhere. A blob URL
       * minted in this world belongs to the page and saves normally. (A blob
       * minted in the *content script's* world does not, which is why this
       * runs here at all.)
       */
      let href = url;
      let revoke: string | null = null;

      if (url.startsWith('data:')) {
        const comma = url.indexOf(',');
        const meta = url.slice(5, comma);
        const payload = url.slice(comma + 1);
        const mime = meta.split(';')[0] || 'application/octet-stream';

        let blob: Blob;
        if (meta.includes('base64')) {
          const binary = atob(payload);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          blob = new Blob([bytes], { type: mime });
        } else {
          // A string Blob encodes UTF-8 correctly; going through charCodeAt
          // would truncate anything above U+00FF.
          blob = new Blob([decodeURIComponent(payload)], { type: mime });
        }

        href = URL.createObjectURL(blob);
        revoke = href;
      }

      const link = document.createElement('a');
      link.href = href;
      link.download = name;

      // `download` is ignored cross-origin; opening a tab beats navigating the
      // page under inspection away from itself.
      const sameOrigin = href.startsWith('blob:') || href.startsWith(location.origin);
      if (!sameOrigin) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }

      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();

      // Revoking immediately can cancel the download that just started.
      if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 30_000);
    },
  });
}

/** Enough for any page a person reads; past it the probe stops walking. */
const HANDLER_ELEMENT_BUDGET = 8000;

/**
 * Run the handler probe in the page's own world, in the frame that asked.
 *
 * Only that world can see what the page's scripts attached. The probe is a
 * self-contained function from core, serialized by `executeScript`; it reads
 * and dispatches events, and changes nothing else. Firefox runs `MAIN` world
 * scripts from 128; before that this rejects, and the panel falls back to
 * the inline handlers it can read itself.
 */
async function readHandlersInPage(tabId: number, frameId: number, eventName: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    args: [eventName, HANDLER_ELEMENT_BUDGET],
    func: script.probeHandlersInPage,
  });
}

/**
 * What each window looked like before the responsive preview touched it.
 *
 * Held here because only the worker can read a window's true bounds — a content
 * script's `outerWidth` is the page's own idea of it, and under automation
 * it is 0. Losing this map to worker eviction costs the user a manual resize,
 * which is a thing people do to windows anyway; persisting it would cost the
 * `storage` permission, which is not a trade this extension makes.
 */
const originalWindowBounds = new Map<
  number,
  { left: number; top: number; width: number; height: number }
>();

/**
 * Resize the window holding a tab so its page gets a given viewport width.
 *
 * A maximized window ignores width and height, so it has to be returned to
 * `normal` first — otherwise the call succeeds, nothing moves, and there is
 * no error to explain why.
 */
async function resizeWindow(
  windowId: number,
  viewportWidth: number | null,
  innerWidth: number,
): Promise<number> {
  const current = await browser.windows.get(windowId);

  if (
    !originalWindowBounds.has(windowId) &&
    current.left != null &&
    current.top != null &&
    current.width != null &&
    current.height != null
  ) {
    originalWindowBounds.set(windowId, {
      left: current.left,
      top: current.top,
      width: current.width,
      height: current.height,
    });
  }

  if (viewportWidth === null) {
    const original = originalWindowBounds.get(windowId);
    if (!original) return current.width ?? 0;

    await restoreBounds(windowId, original);
    originalWindowBounds.delete(windowId);
    return (await browser.windows.get(windowId)).width ?? 0;
  }

  /**
   * Leave the maximized state on its own, before asking for a size.
   *
   * A window manager handed a state change and a width in the same call is
   * free to honour the first and drop the second, and macOS does exactly that
   * for a zoomed window often enough to matter. Two calls cost a few
   * milliseconds and remove the ambiguity.
   */
  if (current.state && current.state !== 'normal') {
    await browser.windows.update(windowId, { state: 'normal' });
  }

  // Scrollbar plus window frame. Measured, not assumed: it varies by platform,
  // by theme, and by whether a scrollbar happens to be showing.
  const chromeWidth = Math.max(0, (current.width ?? innerWidth) - innerWidth);

  const updated = await browser.windows.update(windowId, {
    width: Math.round(viewportWidth + chromeWidth),
  });

  return updated.width ?? 0;
}

/**
 * Put a window back, and do not give up at the first refusal.
 *
 * Chrome rejects any update whose bounds fall more than half outside the
 * visible screen, and the bounds we saved can become illegal while the preview
 * is on: a display gets unplugged, the dock resizes, the window shrank near an
 * edge. Restoring position along with size is the first attempt because a
 * window that came back the right size in the wrong place is still wrong.
 *
 * The fallbacks matter more than the happy path. Leaving someone's window
 * stuck at 375px because one API call was refused would be the worst outcome
 * this feature could produce, so it degrades to size-only and finally to
 * maximized — visibly different from what they had, but usable.
 */
async function restoreBounds(
  windowId: number,
  bounds: { left: number; top: number; width: number; height: number },
): Promise<void> {
  // Typed from the call site rather than a namespace: WXT re-exports `browser`
  // as a value, so there is no `browser.windows` type namespace to reference.
  const attempts: Array<Parameters<typeof browser.windows.update>[1]> = [
    { state: 'normal', ...bounds },
    { state: 'normal', width: bounds.width, height: bounds.height },
    { state: 'maximized' },
  ];

  for (const attempt of attempts) {
    try {
      await browser.windows.update(windowId, attempt);
      return;
    } catch {
      // Try the next, less exact, shape.
    }
  }
}

// Forget a window we can no longer restore.
browser.windows.onRemoved.addListener((windowId) => originalWindowBounds.delete(windowId));

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: {
        tab?: { id?: number | undefined; windowId?: number | undefined } | undefined;
        frameId?: number | undefined;
      },
    ): Promise<ResizeResponse | HandlersResponse | string> | undefined => {
      // Formatting for the JS tab. Here rather than in the content script,
      // which is injected into every page and has a budget to keep.
      if (isBeautifyMessage(message)) {
        try {
          return Promise.resolve(
            beautifyJs(message.code, { indent_size: 2, max_preserve_newlines: 2, end_with_newline: false }),
          );
        } catch {
          return Promise.resolve(message.code);
        }
      }

      // Checked, not cast: the event name is dispatched on every element of
      // the page, so only our own pattern is allowed through.
      if (isHandlersMessage(message)) {
        const tabId = sender.tab?.id;
        if (tabId == null) return Promise.resolve({ ok: false });
        return readHandlersInPage(tabId, sender.frameId ?? 0, message.eventName).then(
          (): HandlersResponse => ({ ok: true }),
          (error: unknown): HandlersResponse => {
            console.debug('[open-inspector] could not read handlers', error);
            return { ok: false };
          },
        );
      }

      // Checked, not cast: a malformed save would otherwise run an arbitrary
      // href in the page's main world.
      if (isResizeMessage(message)) {
        const request = message;
        const windowId = sender.tab?.windowId;
        if (windowId == null) {
          return Promise.resolve({ ok: false, error: 'no window for this tab' });
        }

        // Returning the promise is how the polyfill replies; the panel needs
        // the answer, so a refusal has somewhere to be reported.
        return resizeWindow(windowId, request.viewportWidth, request.innerWidth).then(
          (width): ResizeResponse => ({ ok: true, width }),
          (error: unknown): ResizeResponse => ({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }

      if (isDevtoolsSetupMessage(message)) {
        void browser.tabs.create({ url: browser.runtime.getURL('/enable-devtools.html') });
        return undefined;
      }

      if (!isSaveMessage(message)) return undefined;
      const request = message;

      const tabId = sender.tab?.id;
      if (tabId == null) return undefined;

      void saveInPage(tabId, request.href, request.filename).catch((error) => {
        console.debug('[open-inspector] download refused', error);
      });
      return undefined;
    },
  );

  browser.runtime.onConnect.addListener((port) => {
    // Only the DevTools tab's own page may speak for DevTools; a content
    // script has a tab, and an extension page does not.
    const fromExtension = port.sender?.url?.startsWith(browser.runtime.getURL('/')) ?? false;
    if (port.name === DEVTOOLS_PORT && fromExtension && !port.sender?.tab) {
      onDevtoolsConnect(port);
    } else if (port.name === PAGE_PORT) {
      onPageConnect(port);
    } else {
      port.disconnect();
    }
  });

  browser.action.onClicked.addListener((tab) => {
    // Zen hands over no tab when the click lands on its placeholder "empty
    // tab", which it keeps out of every extension's reach.
    if (tab?.id != null) void toggleInspector(tab.id);
  });

  browser.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-inspector') return;

    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null) await toggleInspector(tab.id);
    })();
  });

  // activeTab is revoked on navigation, so the injected script goes with it.
  // Clear the badge rather than leaving a stale "on".
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // Zen reports updates for tab -1, which setBadgeText rejects before it
    // returns a promise, so the catch below would never see it.
    if (tabId < 0) return;
    if (changeInfo.status === 'loading') {
      void browser.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
    }
  });
});
