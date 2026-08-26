import { defineBackground } from 'wxt/sandbox';
import {
  INSPECTOR_SCRIPT,
  PING,
  RESIZE,
  SAVE,
  TOGGLE,
  type ResizeMessage,
  type ResizeResponse,
  type SaveMessage,
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
async function toggleInspector(tabId: number): Promise<void> {
  try {
    if (!(await isInjected(tabId))) {
      await browser.scripting.executeScript({
        target: { tabId },
        files: [INSPECTOR_SCRIPT],
      });
    }

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
      },
    ): Promise<ResizeResponse> | undefined => {
      const request = message as SaveMessage | ResizeMessage | undefined;

      if (request?.type === RESIZE) {
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

      if (request?.type !== SAVE) return undefined;

      const tabId = sender.tab?.id;
      if (tabId == null) return undefined;

      void saveInPage(tabId, request.href, request.filename).catch((error) => {
        console.debug('[open-inspector] download refused', error);
      });
      return undefined;
    },
  );

  browser.action.onClicked.addListener((tab) => {
    if (tab.id != null) void toggleInspector(tab.id);
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
    if (changeInfo.status === 'loading') {
      void browser.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
    }
  });
});
