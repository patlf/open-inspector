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

  manifest: {
    name: 'Open Inspector',
    description:
      'Inspect layout, styles and design tokens on any page. Free, open source, and never sends anything anywhere.',
    version: '0.0.1',
    permissions: ['activeTab', 'scripting'],
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
      },
    },
  },
});
