# Privacy Policy — Open Inspector

_Last updated: 21 August 2026_

## The short version

Open Inspector collects nothing, stores nothing, and transmits nothing.

There is no analytics, no telemetry, no crash reporting, no account, no licence
check and no server. The extension has no code capable of making a network
request of any kind.

## What data is collected

**None.**

Not anonymised data. Not aggregated data. Not "usage statistics to improve the
product". Nothing leaves your browser, because nothing in the extension is able
to send it.

## What data is stored

**None.**

The extension does not use `chrome.storage`, `localStorage`, `IndexedDB`,
cookies, or any other persistence. Everything it reads about a page lives in
memory for as long as the panel is open and is discarded when you close it.

Any change you make to a page — an edited CSS value, a forced `:hover` state, a
hidden element — is reverted when the inspector closes, and is gone entirely on
reload.

## What permissions are requested, and why

| Permission | Purpose |
| --- | --- |
| `activeTab` | Read the page you are inspecting. Granted by *your click* on the toolbar button or your press of the keyboard shortcut, for that one tab, and revoked by the browser when you navigate. |
| `scripting` | Inject the inspector into that tab. Without it, `activeTab` cannot be used. |

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

- **Asset thumbnails** render the same URL the page has already loaded, so the
  browser answers from its own cache. The extension issues no request and sends
  nothing anywhere.
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
