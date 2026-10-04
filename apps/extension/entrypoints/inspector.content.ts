import { defineContentScript } from 'wxt/sandbox';
import { createInspectorSession } from '@open-inspector/ui';
import { loadSettings, onSettingsChanged, saveSettings } from '../lib/settings.js';
import { createDevtoolsBridge } from '../lib/devtools-bridge.js';
import {
  DEVTOOLS_ATTACH,
  DEVTOOLS_SETUP,
  BEAUTIFY,
  HANDLERS,
  MAX_BEAUTIFY_LENGTH,
  PING,
  RESIZE,
  SAVE,
  TOGGLE,
  isInspectorMessage,
  type HandlersResponse,
  type ResizeResponse,
  type ToggleResponse,
} from '../lib/messages.js';

/**
 * The inspector, injected on demand.
 *
 * `registration: 'runtime'` with **no** `matches` is the whole permission
 * story: WXT only promotes a runtime script's match patterns into
 * `host_permissions`, so with none declared the manifest stays free of host
 * access. The background worker injects this file via `scripting.executeScript`
 * under `activeTab`, which the user grants per-tab by clicking the toolbar
 * button and which the browser revokes on navigation.
 */
/**
 * A message to a worker that will not answer never settles.
 *
 * It does not reject — it simply hangs, which is worse than an error: the
 * caller waits forever and the panel, having nothing to report, shows the
 * unchanged width as though the resize had merely been clamped. That happens
 * whenever the background worker is stale (an unpacked extension whose files
 * changed on disk but which was never reloaded), and it is indistinguishable
 * from a working extension until it is given a deadline.
 */
/**
 * Both ways a stale worker shows up, and the one thing that fixes either.
 *
 * It may answer with nothing, or never answer at all; from the panel the two
 * are the same problem and have the same remedy, so they get the same words.
 */
const NO_WORKER =
  'the extension worker did not answer — reload the extension at chrome://extensions, then try again';

async function withTimeout(
  pending: Promise<unknown>,
  ms = 2000,
): Promise<ResizeResponse | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(NO_WORKER)), ms);
  });

  try {
    return (await Promise.race([pending, deadline])) as ResizeResponse | undefined;
  } finally {
    clearTimeout(timer);
  }
}

export default defineContentScript({
  registration: 'runtime',
  runAt: 'document_idle',

  main(ctx) {
    // Firefox only: the DevTools tab. Chrome builds leave it out entirely.
    const devtools = import.meta.env.FIREFOX ? createDevtoolsBridge(window) : null;

    const session = createInspectorSession({
      ...(devtools
        ? {
            surface: devtools.surface,
            setUpDevtools: () => void browser.runtime.sendMessage({ type: DEVTOOLS_SETUP }),
          }
        : {}),

      // Downloads have to be started from the page's own world; the worker
      // does it. See lib/messages.ts.
      save: (href, filename) => {
        void browser.runtime.sendMessage({ type: SAVE, href, filename });
      },

      // Kept in storage.local, which content scripts can write directly.
      onSettingsChange: (settings) => {
        void saveSettings(settings);
      },

      // Only the worker can run code in the page's own world, where the
      // handlers a page's scripts attached are visible. See lib/messages.ts.
      readPageHandlers: async (eventName) => {
        try {
          const response = (await withTimeout(
            browser.runtime.sendMessage({ type: HANDLERS, eventName }),
            4000,
          )) as HandlersResponse | undefined;
          return response?.ok === true;
        } catch {
          return false;
        }
      },

      // The worker carries the formatter, so this bundle does not. Code the
      // worker would refuse, or a worker that does not answer, leaves it as written.
      beautify: async (code) => {
        if (code.length > MAX_BEAUTIFY_LENGTH) return code;
        try {
          const formatted: unknown = await withTimeout(
            browser.runtime.sendMessage({ type: BEAUTIFY, code }),
            4000,
          );
          return typeof formatted === 'string' ? formatted : code;
        } catch {
          return code;
        }
      },

      // Only the worker can move a window; a content script has no windows API.
      resize: async (viewportWidth, innerWidth) => {
        try {
          const response = await withTimeout(
            browser.runtime.sendMessage({ type: RESIZE, viewportWidth, innerWidth }),
          );

          if (!response) return NO_WORKER;
          return response.ok ? null : (response.error ?? 'the browser refused, without saying why');
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    });

    const handleMessage = (message: unknown): Promise<ToggleResponse> | undefined => {
      if (!isInspectorMessage(message)) return undefined;

      switch (message.type) {
        case PING:
          return Promise.resolve({ active: session.active });
        case TOGGLE:
          return Promise.resolve({ active: session.toggle() });
        case DEVTOOLS_ATTACH:
          devtools?.attach(session, message.activate);
          return undefined;
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);

    /**
     * Settings arrive after the session exists, from an asynchronous read.
     * The panel only appears once a toggle message lands, which is well after
     * this resolves, so nothing is drawn in the wrong colour notation first.
     */
    void loadSettings().then((settings) => session.updateSettings(settings));
    const stopListening = onSettingsChanged((settings) => session.updateSettings(settings));

    /**
     * Tear down completely when this instance is superseded.
     *
     * WXT invalidates the previous instance whenever this script is evaluated
     * again — on an extension reload in development, and on any repeat
     * `scripting.executeScript` call.
     *
     * Removing the message listener is the part that is easy to miss and
     * expensive to get wrong. `runtime.onMessage` delivers to *every*
     * registered listener in the tab, not just the newest, so an invalidated
     * instance that only destroyed its session would still receive the next
     * toggle, build itself a fresh overlay, and leave the tab with two.
     *
     * Do not replace this with a global already-injected flag either: the new
     * instance would bail out after the old one had torn itself down, leaving
     * the tab with no session at all.
     */
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(handleMessage);
      stopListening();
      devtools?.destroy();
      session.destroy();
    });
  },
});
