# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Open Inspector is an MV3 browser extension (Chrome and Firefox) for inspecting layout, styles and design tokens on any page. The product *is* its privacy posture: no host permissions, no network requests, nothing stored. Those claims are enforced by CI checks (see "Hard constraints") — treat them as non-negotiable, not as style preferences.

pnpm workspace (pnpm 11, Node ≥20; CI runs 22). TypeScript + Preact. WXT builds the extension.

**This checkout is a fork of [patlf/open-inspector](https://github.com/patlf/open-inspector).** Its goals are first-class Gecko support (Firefox and Zen) and some extra features on top. Upstream was built and tested against Chromium, so Firefox-specific behaviour should be verified in a real Gecko browser rather than assumed from the Chrome path. Keep the upstream privacy constraints below intact.

## Gecko (Firefox / Zen) notes

- `pnpm build:firefox` → `.output/firefox-mv3`. MV3 on both browsers; on Firefox WXT emits an event-page background (`background.scripts`), not a service worker.
- Content scripts see the page through Xray wrappers. Reading `adoptedStyleSheets` from one returns an opaque object (no `length`, not iterable) rather than the array ([bug 1766909](https://bugzilla.mozilla.org/show_bug.cgi?id=1766909)) — anything iterating adopted sheets in `core` behaves differently there than in unit tests or Chromium.
- `scripting.executeScript({ world: 'MAIN' })` needs Firefox 128; `showPopover` 125; `scheduler.yield` 142 (MDN browser-compat-data). `EyeDropper` does not exist in Gecko — the Color tab hides its sampler there.
- **The DevTools tab is Firefox-only** (`entrypoints/devtools/`, `devtools-panel/`, `enable-devtools/`, each marked `manifest.include: ['firefox']`). It sits behind the optional `devtools` permission, requested from `enable-devtools.html` (opened from settings), because `permissions.request` needs a click in an extension page. The session keeps running in the page; `packages/ui/src/remote/` swaps its panel for a remote surface whose state crosses ports joined by the worker (`DEVTOOLS_PORT` ↔ `PAGE_PORT`). Firefox has no `panels.elements.onSelectionChanged`, so the tab polls `$0` through `inspectedWindow.eval` while visible and dispatches the content script's random event on it. A click in a DevTools panel does **not** grant `activeTab` (Firefox grants it only for the toolbar button, commands, menus, omnibox and the extensions menu — whatever MDN's wording suggests), so the tab can only start an inspector already in the page; otherwise it tells the user to press Alt+Shift+I.
- Zen patches `canAccessTab` to refuse its placeholder tab (`zen-empty-tab`): extensions get a null tab there. Test in a real tab. Zen ships Marionette, so a throwaway profile started with `--marionette -remote-allow-system-access` can install the build as a temporary add-on and drive DevTools from chrome context when Playwright can't.
- Playwright cannot load extensions in Firefox ("Extensions only work in Chromium"), so `pnpm e2e` covers Chromium only. `.github/workflows/nightly.yml` runs `web-ext lint` on the Firefox build.
- **Gecko dev loop: `pnpm dev:zen` / `pnpm dev:firefox`** (`scripts/dev-gecko.mjs`). WXT 0.19 refuses dev mode for Firefox MV3, so the script builds the production Firefox target, opens it via `web-ext` in a temporary profile, and rebuilds + reloads on every source save. A reload invalidates the injected inspector — press Alt+Shift+I again. `--browser <path>` or `GECKO_BINARY` picks another binary. The extension package's own `dev:firefox` (`wxt -b firefox`) still hits the WXT refusal.

## Commands

```bash
pnpm install          # also runs `wxt prepare`, which generates apps/extension/.wxt/
pnpm verify           # typecheck + lint + unit tests + zero-egress guard
pnpm build            # production extension → .output/chrome-mv3
pnpm launch           # Playwright Chromium with the built extension loaded (Alt+Shift+I to toggle)
```

Tests:

```bash
pnpm test                                               # unit (Vitest, happy-dom), packages/*/src/**/*.test.ts
pnpm test packages/core/src/color/parse.test.ts         # one file
pnpm test packages/core/src/color/parse.test.ts -t "lab"  # one test by name
pnpm test:browser                                       # *.browser.test.ts in headless Chromium
pnpm build && pnpm e2e                                  # real packaged extension in real Chromium
pnpm e2e tests/e2e/panel.spec.ts -g "some title"        # one e2e spec / test
pnpm e2e:headed                                         # with a visible window
```

- **e2e runs against `.output/chrome-mv3`, not source.** Rebuild after any change or the tests exercise stale bundles. Playwright starts the playground (`:5178`) itself.
- **`pnpm dev` and `pnpm build` both write to `.output/chrome-mv3`**, but the dev manifest adds `tabs`, localhost host permissions and a relaxed CSP. After using `dev`, run `build` again before `e2e`, `launch` or `check:egress` (`launch` refuses a dev build outright).
- Browser tests need `pnpm exec playwright install chromium` once.
- `pnpm typecheck` = `tsc --build` over packages (project references), then each app separately (the extension typechecks against WXT's generated `.wxt/tsconfig.json`, so it can't join the reference graph), then `tests/`.
- `pnpm check:egress` silently skips the manifest and bundle scans when `.output/` is missing — build first for the full check. `pnpm check:size` requires a build.
- `pnpm sweep` bundles the engine with esbuild and runs it against ~12 live production sites; report lands in `.output/sweep/`. Errors (threw) and suspicions (returned something implausible) are reported separately.
- Site: `pnpm site:dev` serves `apps/site/public` on `:8788`; `pnpm check:site` needs it running.
- Media generation (`gen:shots`, `gen:store`) needs shotkit cloned at `../shotkit` or `SHOTKIT_HOME`; `gen:store` also needs `build` and `site:dev`.

## Architecture

Dependency direction is strict: `core` ← `ui` ← `apps/extension` (and `apps/playground`).

**`packages/core` — the engine.** Pure TypeScript: takes a DOM, returns data. No `chrome.*`, no `browser.*`, no network — that boundary is what lets it be unit-tested and reused outside an extension. Analysis modules (`color`, `typography`, `layout`, `cascade`, `assets`, `a11y`, `tokens`, `edit`, `markup`) are exported from `src/index.ts` **as namespaces**, because several legitimately define the same type names; add new modules the same way. Functions are typed against the structural slice of the DOM/CSSOM they touch (e.g. cascade's `StyleSheetLike`) so tests can hand-build cases no headless DOM produces, like a sheet whose `cssRules` getter throws.

**`packages/ui` — overlay, panel, interaction loop.** Preact (not React: this bundle is injected into other people's pages), rendered into shadow roots.
- `host.ts`: both hosts (`<open-inspector-overlay>`, `<open-inspector-panel>`) are reset with inline `!important` and raised into the top layer via a manual popover, because page CSS and ancestor transforms can otherwise reach them.
- `session.ts`: the interaction loop. Pointer probing throttled to one rAF; expensive analysis waits for a 250 ms settle. Distinguishes *picking* (page clicks captured) from *pinned*. Owns the `edit.OverrideStore`, so there is exactly one place that mutates the page and one that reverts it. Uses no extension APIs — extension-only abilities arrive as `SessionOptions.save` / `resize` callbacks, and features hide themselves when those are absent.
- `panel/collect.ts`: per-element adapter from engine structures to the flat `PanelData` in `panel/view-model.ts`. Runs on every settled hover, so keep it cheap.
- `panel/page.ts`: page-wide scan (palette, type scale, spacing scale, token exports, contrast audit). Runs once per page, cached, split into generator phases.
- Panel components render only from the view-model and never touch the page DOM. A row is editable only when `Field.property` maps to exactly one declaration.

**`apps/extension` — WXT shell.**
- The content script uses `registration: 'runtime'` with **no `matches`**. WXT promotes a runtime script's match patterns into `host_permissions`, so adding any would break the zero-permission manifest.
- `entrypoints/background.ts` injects `content-scripts/inspector.js` via `scripting.executeScript` under `activeTab`, pinging first (executeScript is not idempotent) and serializing toggles per tab. It also performs downloads (in the page's MAIN world — Chrome drops downloads from the isolated world), runs the JS panel's handler probe in the MAIN world (`core`'s `script.probeHandlersInPage`, serialized by `executeScript`, so it must stay self-contained — no imports, no outer references), and window resizes for the responsive preview.
- `lib/messages.ts` is the entire worker ↔ content-script surface. Keep it tiny; every message is validated, not cast (`isSaveMessage` allowlists URL schemes because the href runs in the page's main world; `isHandlersMessage` allowlists the event name the probe dispatches on every element).
- `inspector.content.ts` must remove its `onMessage` listener in `ctx.onInvalidated`, or a superseded instance answers the next toggle and the tab ends up with two overlays.

**`apps/playground`** — Vite on `:5178`. `index.html` creates its own inspector session for manual work; `e2e.html` deliberately has none, so the only overlay there is the extension's. `fixtures.ts` holds the awkward DOM cases (nested shadow roots etc.) shared by both. `hostile.html`, `egress.html` and `keyboard.html` back specific e2e specs.

**`apps/site`** — static files, no build step. Deployed to GitHub Pages by `.github/workflows/pages.yml` on changes under `apps/site/public/`, after its own contrast and image-size checks pass.

**`tests/e2e`** — Playwright with a persistent context per test. `channel: 'chromium'` is required: the default headless shell loads no extensions and fails silently. Fixtures in `tests/e2e/fixtures.ts`:
- `test` — the shipped artifact byte for byte. Use for permission/privacy assertions.
- `testWithHostAccess` — same bundles, manifest rewritten with localhost host permissions, because automation can't click the toolbar to grant `activeTab`.
- `testWithStaleWorker` — a worker that never answers.

Shared drivers live in `tests/e2e/support/panel.ts`; the panel's shadow root is open, so locators pierce it.

## Hard constraints (CI fails on these)

- **Zero egress** (`scripts/check-zero-egress.mjs`, over `packages/`, `apps/`, both generated manifests and the built bundles): no `fetch` (including aliased references), `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `new Image()`, `window.open()`, remote `import()`, `WebTransport`, `RTCPeerConnection`. Asset thumbnails render only for URLs the page already loaded (checked against Resource Timing). Don't route around the guard — the absence is the feature.
- **Manifest**: permissions allowlisted to `activeTab` + `scripting` + `storage`. `host_permissions`, `optional_host_permissions`, `externally_connectable` and `web_accessible_resources` are forbidden. `optional_permissions` is forbidden except exactly `["devtools"]` in the Firefox manifest, for the DevTools tab.
- **Extension pages get no modulepreload polyfill** (`build.modulePreload.polyfill: false` in `wxt.config.ts`): Vite's polyfill requests chunks through the Fetch API, which the egress guard refuses.
- **Settings are the only persistence**: `storage.local` under the `settings` key (`apps/extension/lib/settings.ts`, normalized by `packages/ui/src/settings.ts`). Never the sync storage area — the egress guard fails on the literal `storage.sync`, comments included. No `localStorage`, IndexedDB, cookies, and nothing about pages (PRIVACY.md promises this).
- **Bundle budgets** (`scripts/check-bundle-size.mjs`, gzipped): inspector content script ≤150 KB, background ≤40 KB.
- **Icons** are generated by `scripts/gen-icons.mjs`; CI regenerates and fails on any diff. Change the script, not the PNGs.
- **The panel's own contrast** must meet WCAG AA in both themes (`tests/e2e/contrast.spec.ts`).
- **Edits are exactly revertible**: record the prior inline value *and* priority, validate with `CSS.supports` before writing, and on close revert everything and remove any `style` attribute the inspector created.

## Conventions

- TS is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`: optional fields that may receive `undefined` are declared `?: T | undefined`; otherwise build objects conditionally rather than assigning `undefined`.
- ESM with explicit extensions in relative imports — `.js` for `.ts`, `.jsx` for `.tsx` — and `import type` (`verbatimModuleSyntax`).
- ESLint: no `any`; no `console.log` (only `warn`/`error`/`debug`; `scripts/` and configs exempt); `eqeqeq` except `== null`; deliberately unused args/vars prefixed `_`.
- Doc comments explain *why* in full prose — the codebase leans on this heavily. Match it.
- Unit tests sit beside their source as `*.test.ts`. Anything needing real layout, the real cascade or canvas text measurement goes in `*.browser.test.ts`.
- `.gitignore` excludes private working notes (`PRODUCT.md`, `SOURCE-OF-TRUTH.md`, `LAUNCH-PLAN.md`, `store/SUBMISSION.md`, `store/launch/LAUNCH.md`). Read them if present; never commit them.
