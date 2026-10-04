# Privacy Policy — Open Inspector

_Last updated: 3 October 2026_

## The short version

Open Inspector collects nothing and transmits nothing. The one thing it stores
is your own settings, on your own device.

There is no analytics, no telemetry, no crash reporting, no account, no licence
check and no server. The extension has no code capable of making a network
request of any kind.

## What data is collected

**None.**

Not anonymised data. Not aggregated data. Not "usage statistics to improve the
product". Nothing leaves your browser, because nothing in the extension is able
to send it.

## What data is stored

**Your settings, and nothing else.**

The choices you make in the panel's settings view — today, the theme and
which notation colors are written in — and where you last left the panel (docked or floating,
and how wide) are kept with `storage.local`, on this device. Never
`storage.sync`, which would upload them to the browser vendor; the build fails
if that ever appears. Nothing about any page is stored: not a URL, not a value,
not an edit.

The extension uses no other persistence: no `localStorage`, `IndexedDB` or
cookies. Everything it reads about a page lives in memory for as long as the
panel is open and is discarded when you close it.

Any change you make to a page — an edited CSS value, a forced `:hover` state, a
hidden element — is reverted when the inspector closes, and is gone entirely on
reload.

## What permissions are requested, and why

| Permission | Purpose |
| --- | --- |
| `activeTab` | Read the page you are inspecting. Granted by *your click* on the toolbar button or your press of the keyboard shortcut, for that one tab, and revoked by the browser when you navigate. |
| `scripting` | Inject the inspector into that tab. Without it, `activeTab` cannot be used. The same permission runs two small scripts in the page's own world: one that starts a download when you press save, and a read-only one that lists the event handlers the page's scripts attached, for the JS panel. Neither sends anything anywhere. |
| `storage` | Keep your settings on this device. It reads nothing from any page, and neither browser shows a warning for it at install. |
| `devtools` (Firefox, optional) | Show the panel as a tab in Firefox DevTools. Not requested at install: it is asked for only if you turn the DevTools tab on in settings, and you can turn it off there again. It grants no access to any page; the inspector still reads a page only while you have it running there. |

The extension declares **no host permissions**. Chrome's install screen will
show no site access requested. It cannot read a page until you explicitly
invoke it, and it cannot read any page you have not invoked it on.

## Network activity

The extension makes no network requests. This is verified automatically on every
build by [`scripts/check-zero-egress.mjs`](scripts/check-zero-egress.mjs), which
scans the source, both generated manifests and the shipped bundles for `fetch`,
`XMLHttpRequest`, `WebSocket`, `sendBeacon` and related APIs, and fails the
build if any appear.

Two behaviours sit close to this line and are worth stating exactly:

- **Asset thumbnails** are only rendered for URLs the page has already
  fetched (checked against the browser's own Resource Timing list), or for
  inline `data:` and `blob:` content. The browser answers those from its own
  cache. An asset the page only *references* — an `og:image`, an unused favicon
  size, a prefetch hint — is listed with "not loaded by the page" instead of a
  thumbnail, because showing it would be a request of ours.
- **Saving an asset** hands the browser a link and lets the browser do what
  browsers do. Inline SVG and `data:` URIs never touch the network. A remote
  file costs one browser request — made by the browser, to a URL the page
  already used, and only after you press save.

The "Buy me a coffee" link in the panel footer is a plain link. It is inert
until you click it, at which point your browser opens that page in a new tab in
the ordinary way. It is deliberately **not** the hosted badge image, because an
image would be a request the extension made on every render.

## Third parties

There are none. No SDKs, no trackers, no fonts loaded from a CDN, no error
reporting service.

## Children

The extension collects no data from anyone, of any age.

## Changes to this policy

The extension is open source under the MIT licence. Any change to what it does
is visible in its commit history, and the zero-network guarantee is enforced by
a test rather than by this document.

If this policy ever changes, the change will appear in the repository with the
commit that caused it.

## Contact

Open an issue on the project repository.
