import { defineConfig } from 'wxt';

/**
 * Manifest policy: the smallest set of permissions that can possibly work.
 *
 * Notably absent is `host_permissions`. The inspector content script is
 * registered as `runtime` with **no** `matches` — WXT only copies a runtime
 * script's match patterns into `host_permissions` if they exist, so omitting
 * them entirely leaves the manifest clean. Page access comes from `activeTab`,
 * granted per-tab by the user's click and revoked on navigation.
 *
 * The practical difference: this extension cannot read a page until you ask it
 * to, and the store listing says "no host permissions" rather than
 * "read and change all your data on all websites".
 */
export default defineConfig({
  srcDir: '.',
  outDir: '../../.output',

  /**
   * Preact, not React: this bundle is injected into other people's pages, and
   * 3 KB against 45 KB is the difference between a tool that feels instant and
   * one that does not.
   */
  vite: () => ({
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'preact',
    },
    /*
     * No modulepreload polyfill in the extension's own pages (the DevTools
     * tab and its setup page). It requests each preloaded chunk through the
     * Fetch API — local files, but a request all the same, and the
     * zero-egress guard rightly refuses any. Every browser this targets
     * preloads modules natively, so the polyfill would never run anyway.
     */
    build: {
      modulePreload: { polyfill: false },
    },
  }),

  /**
   * MV3 on both browsers, overriding WXT's MV2 default for Firefox.
   *
   * This is not a preference — the background worker calls
   * `browser.scripting.executeScript` and `browser.action`, and neither exists
   * under MV2 (they are `tabs.executeScript` and `browserAction` there). An
   * MV2 Firefox build would compile cleanly and then fail at runtime on every
   * toggle. Firefox has supported both since 109; the manifest floor below is
   * 115, comfortably clear of it.
   */
  manifestVersion: 3,

  manifest: ({ browser }) => ({
    name: 'Open Inspector',
    description:
      'Inspect layout, styles and design tokens on any page. Free, open source, and never sends anything anywhere.',
    /*
     * `storage` holds the settings page's choices, on this device only. It
     * asks the user nothing at install in either browser, and reads no page.
     */
    permissions: ['activeTab', 'scripting', 'storage'],
    /*
     * Firefox only: the DevTools tab, asked for when the user turns it on in
     * settings rather than at install. A required `devtools` would show
     * "Extend developer tools to access your data in open tabs" to every
     * Firefox user, including the ones who never open DevTools. The egress
     * guard allows exactly this optional permission and no other.
     */
    ...(browser === 'firefox' ? { optional_permissions: ['devtools'] } : {}),
    action: {
      default_title: 'Inspect this page (Alt+Shift+I)',
    },
    commands: {
      'toggle-inspector': {
        suggested_key: {
          default: 'Alt+Shift+I',
        },
        description: 'Toggle the inspector on the current tab',
      },
    },
    browser_specific_settings: {
      gecko: {
        id: 'open-inspector@openinspector.dev',
        strict_min_version: '115.0',
        /*
         * Firefox's own declaration of what an add-on collects, shown at
         * install time and soon required by AMO. "none" is the whole point of
         * this project, so it is stated where the browser will show it.
         * Spread in because WXT's manifest types predate the key.
         */
        ...({ data_collection_permissions: { required: ['none'] } } as object),
      },
    },
  }),
});
