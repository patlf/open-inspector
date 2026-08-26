# Open Inspector

Inspect layout, styles and design tokens on any page — without opening DevTools.

Free, open source, and **it never talks to a network**. No accounts, no telemetry, no host
permissions. That last part is not a promise in a readme; it is a check that fails the build.

> **[Add to Chrome](https://chromewebstore.google.com/detail/open-inspector/apiiaenebelbejcjpmbcecikmaahpffd)** — live on the Chrome Web Store.
> The listing shows no site access requested, which is the whole point.

## What it does

Hover anything, or click to pin it. Seven panels:

| | |
| --- | --- |
| **Styles** | Box-model diagram, spacing, appearance, and the matched CSS rules with overridden declarations struck through |
| **Color** | Element colours with swatches, live WCAG AA/AAA contrast grading, a screen eyedropper, a page-wide contrast audit, and a page palette clustered in OKLab so near-identical greys collapse into one entry |
| **Type** | The font that **actually rendered** (measured, not guessed), full metrics, `@font-face` inventory, and modular type-scale detection |
| **Layout** | How the element lays out its children and how its parent places it, plus spacing-scale inference and the breakpoints that affect this element |
| **Assets** | Images with the `srcset` candidate the browser really chose, inline SVG as standalone markup, video, webfonts, Lottie hints |
| **Markup** | The element written back out as HTML or JSX, with framework hydration ids, scripts and inline styles stripped — source to paste, not a DOM recording |
| **Export** | CSS variables, Tailwind config, JSON, W3C design tokens, SCSS, and a compact markdown handoff for pasting into Cursor or Claude |

Plus, across the panel:

- **A breadcrumb and arrow keys** — <kbd>↑</kbd> parent, <kbd>↓</kbd> first child, <kbd>←</kbd>/<kbd>→</kbd> siblings.
  Wrappers with no padding of their own are entirely covered by their children and cannot be
  reached by mouse at all; this is how you get to them.
- **Forced pseudo-states** — `:hover`, `:focus`, `:active` and friends held on, so their styles can
  be read at all. States the page does not define are shown disabled rather than hidden.
- **`::before` and `::after` rules**, in their own groups.
- **A screen eyedropper**, which reads pixels the DOM cannot — inside images, canvas, video and
  cross-origin frames. Chromium only; the control hides itself where the API is absent.
- **A page-wide contrast audit**, listing every text sample that fails WCAG AA, worst first, with
  a suggested passing colour and a press to jump to the element. Run on request: it is a second
  full walk of the document, and charging every session for it to serve the few who want it would
  make the panel feel slow to everyone.
- **Asset thumbnails and save**, so a list of twelve `icon.svg` entries is no longer twelve
  identical rows.
- **A filter box** over everything at once — properties, values, matched rules, palette entries and
  assets. Groups it empties disappear rather than leaving bare headings.
- **Hide element**, a revertible `display: none` for looking at what a sticky header is covering.
- **A responsive preview** that resizes the real browser window, so media queries genuinely
  re-evaluate. See the limits below for why nothing simulated would do.
- **Collapse to the edge**, because a 375px preview covered by a 348px panel shows nothing.

### Editing

Spacing and appearance values in **Styles**, the metrics in **Type**, and the element's own colours
in **Color** are all editable — click one, type, press Enter. Arrow keys step numbers (Shift by ten,
Alt by a tenth), and any colour that resolves to a single declaration gets a picker beside it, which
keeps the existing alpha rather than flattening a 40%-opaque overlay on first use. Edits apply
inline to the live page and appear in a **Changes** list you can copy as CSS or revert.

Three things make it safe to use on a page you care about:

- **Exactly revertible.** Every edit records the element's prior inline value *and* its
  `!important` state, so reverting restores what was there — including a page's own inline
  styles, which a blanket `style.cssText = ''` would destroy.
- **Rejected values are reported, not swallowed.** `setProperty` silently ignores anything it
  cannot parse, so values are checked with `CSS.supports` *before* being written. Checking
  afterwards cannot work: if the element already had `color: blue` inline, a rejected write
  leaves `blue` in place, which is indistinguishable from success.
- **Nothing is persisted.** Closing the inspector reverts every edit and removes the `style`
  attribute it created — down to not leaving an empty `style=""` behind. A reload would discard
  the edits anyway; leaving marks on a page we were only asked to read would not be acceptable.

## Why another one

The three established tools in this space — CSS Peeper, Hoverify, MiroMiro — are all closed
source, and all of them ask for permission to read every page you visit. That includes your
staging environments, your internal dashboards, and anything you are logged into. It is a
large amount of trust, and none of them can show you what they do with it.

This one can:

- **No host permissions.** The manifest requests `activeTab` and `scripting`, nothing more.
  The inspector is injected only when you click the button, and the browser revokes that
  access on navigation. Compare the store listings: "no special permissions" against
  "read and change all your data on all websites".
- **No network, at all.** No fetch, no XHR, no WebSocket, no beacon — enforced by
  [`scripts/check-zero-egress.mjs`](scripts/check-zero-egress.mjs), which scans the source,
  both generated manifests, and the shipped bundles on every CI run.
- **Reproducible.** Even the icons are generated by a committed script, and CI fails if they
  drift from it.

And one thing none of the paid tools do at any price: explain how a layout is *built*, not just
what it looks like — grid and flex anatomy, the spacing scale a page actually follows, and the
breakpoints that affect the element in front of you.

## Try it

### Fastest: a disposable browser with it already installed

```bash
pnpm install && pnpm build && pnpm launch
```

That starts the playground and opens a Chromium window with the extension loaded. Press
<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> (or use the puzzle-piece menu in the toolbar),
then hover anything. <kbd>Esc</kbd> stops it.

The profile lives in `.output/launch-profile` and is disposable. Your real browser profile is
never touched.

### In your own Chrome

Chrome removed the `--load-extension` command-line switch from the stable channel, so this is
now a manual three-step:

```bash
pnpm build
```

> **Run `pnpm build`, not `pnpm dev`, before loading it.** WXT writes both to
> `.output/chrome-mv3`, but the dev manifest adds the `tabs` permission, host permissions for
> localhost, and a relaxed CSP so hot reload can work. Loading that would show a permission
> posture this project exists to avoid. `pnpm launch` refuses to start on a dev build for the
> same reason.

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select `.output/chrome-mv3`

Firefox is `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick
`.output/firefox-mv3/manifest.json`, after `pnpm build:firefox`.

Worth doing once for the permissions screen alone: Chrome will show this extension requesting
no site access at all.

### Just the engine, no extension

```bash
pnpm --filter @open-inspector/playground dev
```

Hosts the awkward cases on one page — nested shadow roots, a closed shadow root, a canvas, a
same-origin iframe, SVG, an element with more padding than width, and a section whose CSS
forces `position: static !important` on everything inside it. Fastest loop for working on the
overlay, since there is no extension to reload.

## Layout

```
packages/core    the engine. pure TypeScript, no chrome.*, no network
packages/ui      shadow-DOM overlay and the interaction loop
apps/extension   WXT shell: manifest, background worker, injected script
apps/playground  manual test surface
```

The engine deliberately knows nothing about browser extensions. It takes a DOM and returns
data, which is what lets it be unit-tested without a browser, and reused later in a CLI or a
Playwright plugin without dragging an extension along.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm launch` | Disposable browser with the extension installed |
| `pnpm dev` / `pnpm dev:firefox` | WXT dev build with hot reload |
| `pnpm build` / `pnpm build:firefox` | Production build into `.output/` |
| `pnpm test` | Unit tests |
| `pnpm e2e` | End-to-end: the real extension in a real browser |
| `pnpm e2e:headed` | Same, with a visible window |
| `pnpm typecheck` | Project-wide typecheck |
| `pnpm check:egress` | The zero-egress guard |
| `pnpm check:size` | Bundle budgets, gzipped |
| `pnpm sweep` | Run the engine against real production sites |
| `pnpm verify` | Typecheck, lint, unit tests, egress guard |

## Testing

Unit tests cover the engine's arithmetic and traversal under happy-dom. They do not cover
whether the thing works *as an extension*, so there is a second layer:

`tests/e2e/` loads the built extension into a real Chromium via Playwright and drives it
through the actual plumbing — background worker, `scripting.executeScript`, message passing,
overlay in the page.

Two details worth knowing before you touch these:

- **`channel: 'chromium'` is required.** Playwright's default headless path is the headless
  *shell*, which has no extension support and fails silently — you get no service worker and a
  cascade of confusing errors far from the cause.
- **`extension-privacy.spec.ts` runs the shipped artifact; `inspector.spec.ts` runs a copy with
  one host permission added.** `activeTab` is granted by a real click on the toolbar button,
  and no automation framework can click browser chrome, so the functional path is otherwise
  unreachable. Only `manifest.json` differs — every line of JavaScript under test is the
  shipped build. The privacy properties are asserted against the real manifest, including a
  test that injection *is* correctly refused without a gesture.

## Permissions, justified

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | Read the page you are inspecting. Granted by your click on one tab, revoked on navigation. |
| `scripting` | Inject the inspector into that tab. Without it, `activeTab` cannot be used. |

There is no `host_permissions` key, no `tabs`, no `cookies`, no `webRequest`. If you ever see
one appear, CI is broken — [the guard](scripts/check-zero-egress.mjs) treats all of those as
build failures.

The responsive preview moves the real browser window through `chrome.windows.update`, which is
worth stating plainly because it sounds like it should need something: the `windows` API is
available to every extension, and only the `tabs` permission gates the sensitive parts of a tab
(its URL, title and favicon). Resizing a window reveals nothing about you, so nothing is asked for.

## The reliability sweep

```bash
pnpm build && pnpm sweep
```

Bundles the engine standalone, injects it into a dozen real production sites, and drives every
module over a spread of elements on each. It reports two kinds of finding, deliberately kept
apart:

- **errors** — something threw. Always a bug.
- **suspicions** — it returned, but the answer looks wrong: no rendered font on visible text, an
  empty palette on a colourful page, a pass that took seconds. This is where silent wrongness
  hides, and a harness that only catches exceptions never finds it.

It has already earned its keep. The first run found that Chrome serializes computed colours as
`lab()` whenever the author used a modern colour space — so on tailwindcss.com, 2,398 colour
values were being rejected as unreadable and the palette came back nearly empty. That is the
most popular CSS framework there is, and no unit test would have caught it.

The sweep injects by evaluation rather than by `<script>` tag on purpose: script tags are subject
to the page's Content Security Policy, and GitHub, Stripe and MDN all forbid inline scripts. A
content script runs in an isolated world that CSP does not govern, so injecting via a tag would
have reported failures the real product never hits.

## The zero-egress boundary, precisely

"It never talks to a network" is a claim about **the extension**, and it is worth stating exactly
where the line falls, because two features sit near it:

- **Asset thumbnails** render the same URL the page already loaded, so the browser answers from
  its cache. The extension issues no request and sends nothing anywhere.
- **Saving an asset** hands the browser a link and lets it do what browsers do. Inline SVG and
  `data:` URIs never touch the network at all. A remote file costs one browser request — made
  by the browser, to a URL the page already used, only after someone presses save.

The extension itself makes no `fetch`, no `XMLHttpRequest`, no WebSocket, no beacon, ever — that
is what [`scripts/check-zero-egress.mjs`](scripts/check-zero-egress.mjs) enforces on every build.
Nothing about you or the pages you visit is transmitted anywhere, and there is no telemetry,
no analytics and no account.

Bulk download is deliberately absent for the same reason: zipping every asset would mean fetching
each one. The Assets tab offers the URL list instead, for `curl` or a download manager.

## Known limits

Honest failure beats a confident wrong answer, so the probe reports what it cannot see:

- **Closed shadow roots** are undetectable by design. An empty custom element that rendered
  something is flagged as probably hiding one, but that is a heuristic, not a detection.
- **Canvas and WebGL** surfaces have no DOM inside them. Nothing can fix this.
- **Cross-origin iframes** are unreachable from the parent frame. Same-origin frame support
  arrives in M5.
- **The responsive preview cannot go below the browser's minimum window width**, which is around
  570px on macOS. The 375 preset is a request, and when it is clamped the panel shows the width
  actually achieved (`375 →578`) rather than the one you asked for. Simulating it instead —
  rendering the page inside a narrow box — would look right and be wrong: media queries evaluate
  against the viewport, so a boxed page keeps its desktop layout. The honest alternative is an
  iframe, which reloads the page and is refused outright by any site sending `X-Frame-Options`.
  Chrome also rejects a resize whose result would fall mostly off-screen; if restoring is refused,
  the window falls back to size-only and then to maximized rather than being left narrow.
- **Transformed elements** report their on-screen bounding box, which will not match the
  element's computed `width`. The overlay wants the former; a future authored-value view will
  want the latter.
- **Cross-origin stylesheets** cannot be read. `.cssRules` throws when a stylesheet is served
  from another origin without CORS headers, and no extension permission changes that — the
  restriction follows the stylesheet, not the reader. Stripe serves all six of its sheets this
  way, so Matched Rules is empty there and says so rather than claiming nothing matched.
  DevTools works around this by refetching the CSS over the network; we will not, because that
  would break the zero-egress promise.
- **`color-mix()`, `light-dark()` and relative colour syntax** are refused rather than guessed
  at — each needs context the parser cannot see. `lab()`, `lch()`, `oklch()` and `oklab()` all
  parse.

## Supporting it

There is a **Buy me a coffee** link in the panel's footer, and that is the entire business model.
The extension is free, all of it, forever — there is no paid tier, no licence check and no
account, and there cannot be: a licence check is a network request, which is the one thing this
project promises never to make.

The link is text, never the hosted badge image. An `<img>` pointed at buymeacoffee.com would be a
request the extension issues on every render, which would break that promise on the very screen
that makes it.

To point it at your own handle, change `SUPPORT_URL` in
[`packages/ui/src/panel/Panel.tsx`](packages/ui/src/panel/Panel.tsx). It appears in one place.

## Contributing

The reliability harness is the best place to start. A page the inspector gets wrong is a
perfectly scoped issue: add it to `tests/fixtures/` as a snapshot, assert the correct
reading, and fix it. No product-design judgment required, and every fixture makes the next
change safer.

## License

MIT. See [LICENSE](LICENSE).
