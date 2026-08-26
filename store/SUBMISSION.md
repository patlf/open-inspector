# Chrome Web Store submission

Everything the listing needs, in the order the dashboard asks for it. Copy the
blocks verbatim; they are written to the character limits.

> **Published.** Live at https://chromewebstore.google.com/detail/open-inspector/apiiaenebelbejcjpmbcecikmaahpffd
>
> What follows is kept for the next version and for the Firefox submission. The
> copy below is what shipped.

---

## Before you start

- [x] **Register a Chrome Web Store developer account** — a one-time **$5** fee,
      paid to Google, at https://chrome.google.com/webstore/devconsole.
      Use an account you will still control in five years; transferring an
      extension later is awkward.
- [x] **Verify your contact email** in the dashboard. Google will not publish
      without it — it is the specific error behind "Nie udało się opublikować" /
      "Failed to publish" — and it is the address that receives review
      decisions.
- [ ] **Decide the publisher name.** It is shown on the listing, and changing it
      later is not straightforward. A project name reads better than a personal
      one for something open source.
- [x] **Privacy policy is live** at https://open-inspector-site.pattest.workers.dev/privacy —
      served as static files from Cloudflare Workers, no server-side code.
      Redeploy after edits with `pnpm site:deploy`.
- [x] **Set the publisher contact email, and verify it.** This is the one that
      blocks publishing, and it is an *account* setting rather than part of the
      item: dashboard → left menu → **Account** → **Add email** → enter it →
      **Verify email** → click the link Google sends. The address is shown
      publicly on your listings, so a project address beats a personal one.
- [ ] **Set `SUPPORT_URL`** in `packages/ui/src/panel/Panel.tsx` to your real
      Buy Me a Coffee handle. It is a placeholder right now and it ships in the
      panel footer.
- [ ] **Check the name is free** — search the Web Store, npm, GitHub and a
      trademark register for "Open Inspector" before committing to it.

---

## 1. Package

```bash
pnpm build && pnpm zip
```

Produces `.output/open-inspectorextension-0.0.1-chrome.zip`.

**Upload the production build, never a dev build.** `pnpm dev` writes to the
same directory but its manifest adds the `tabs` permission, host permissions for
localhost, and a relaxed CSP so hot reload can work. Uploading that would
request exactly the access this extension exists to avoid.

Verify before uploading:

```bash
node -e "const m=require('./.output/chrome-mv3/manifest.json');console.log(m.permissions, m.host_permissions ?? '(none)')"
```

Must print `[ 'activeTab', 'scripting' ] (none)`.

---

## 2. Store listing

**Name**

```
Open Inspector
```

**Summary** (132 characters max)

```
Inspect layout, styles and design tokens on any page. Free, open source, and it asks for no access to your data.
```

**Description**

```
Open Inspector shows you how any web page is built — its layout, spacing, colour, typography and assets — without asking for permission to read your browsing.

Every other extension in this category requests "read and change all your data on all websites". That covers your staging environments, your internal dashboards, and anything you are logged into. None of them can show you what they do with it.

This one requests no site access at all. Chrome's install screen will tell you the same thing.

WHAT IT DOES

• Styles — box model, spacing, and the CSS rules that matched, with overridden declarations struck through
• Color — element colours, WCAG AA/AAA contrast grading with a suggested passing colour, a screen eyedropper, a page-wide contrast audit, and a palette clustered so near-identical greys collapse into one entry
• Type — the font that actually rendered, measured rather than read off the stack, with full metrics and modular scale detection
• Layout — how the element lays out its children, the spacing scale the page really follows, and the breakpoints affecting it
• Assets — images with the srcset candidate the browser actually chose, inline SVG, video, webfonts
• Markup — the element as HTML or JSX, with framework attributes and inline styles stripped
• Export — CSS variables, SCSS, Tailwind config, JSON, W3C design tokens, or a markdown handoff for a coding assistant

You can also edit values live and revert them exactly, force :hover and :focus states so their styles can be read at all, hide elements, filter the whole panel, and resize the window to real breakpoints.

WHY IT ASKS FOR NOTHING

The manifest requests activeTab and scripting, and declares no host permissions. activeTab is granted by your click, for one tab, and revoked when you navigate.

It makes no network requests — no fetch, no analytics, no telemetry, no account, no licence check. That is enforced by a script that fails the build if any of them appear, not by a promise in a description.

It is free, and it will stay free. A paid tier would need a licence check, a licence check is a network request, and that would break the only promise this extension makes.

HONEST LIMITS

Cross-origin stylesheets cannot be read by any extension — the restriction follows the stylesheet, not the reader — and the panel says so rather than reporting "no rules matched". Canvas and closed shadow roots have nothing to inspect. There are no screenshots, no console or network debugging, and no bulk asset download: zipping every asset would mean fetching every asset.

MIT licensed. The whole thing is readable.
```

**Category:** `Developer Tools`

**Language:** English

---

## 3. Graphics

| Asset | Requirement | Status |
| --- | --- | --- |
| Store icon | 128×128 PNG | `.output/chrome-mv3/icon/128.png` — generated by a committed script |
| Screenshots | 1280×800, 1–5 | `store/screenshots/` — five, ready |
| Small promo tile | 440×280, **no alpha** | `store/promo/small-tile-440x280.png` — ready |
| Marquee promo | 1400×560, **no alpha** | `store/promo/marquee-1400x560.png` — ready |

Both promo images are generated, not hand-designed, for the same reason the
icons are — run `pnpm gen:promo` to rebuild them from `store/promo/src`.

**The alpha channel is the trap.** The store asks for JPEG or *24-bit* PNG, and
a fully-opaque alpha channel is still an alpha channel. Anything that writes
RGBA — every screenshot tool, including the one used here — produces a file the
store rejects with an unhelpful message. The generator strips the channel as its
last step; if you ever edit these by hand, check with:

```bash
python3 -c "from PIL import Image; print(Image.open('store/promo/small-tile-440x280.png').mode)"
```

It must print `RGB`, never `RGBA`.

**What the small tile is for:** it appears in the store's category listings and
discovery surfaces, so it is worth having even though the dashboard marks it
optional. **The marquee** is only used if Google features the extension in the
homepage carousel — you cannot request that, but you cannot be chosen without
the asset either.

**A deliberate omission:** neither image names or compares against a competitor,
even though that comparison is the strongest argument the project has. Store
policy is uncomfortable with disparaging comparisons in listing imagery, and a
rejection over a promo tile is not worth the risk. Save the comparison for the
website and Product Hunt, where nothing constrains it.

Screenshot order matters — the first is the one shown in search results:

1. `01-styles.png` — the panel over a real page, box model visible
2. `03-layout.png` — spacing scale detected at 8px, 84% conform, with outliers
3. `02-contrast.png` — the page-wide contrast audit finding a real failure
4. `05-type.png` — the rendered font measured, 1.25× Major Third detected
5. `04-export.png` — design tokens

**Consider adding a sixth by hand:** a screenshot of Chrome's own extension
detail page showing *"Site access: On click"* or the install dialog showing no
site access requested. Automation cannot capture `chrome://` pages, so this one
has to be taken manually — and it is the single most persuasive image the
project has.

---

## 4. Privacy practices

This is the section that most often delays review. Answer it exactly.

**Single purpose**

```
Inspecting the styles, layout, colours, typography and assets of the web page the user is currently viewing, at the user's explicit request.
```

**Permission justification — `activeTab`**

```
Reads the page the user is inspecting. Granted by the user's click on the toolbar button or their press of the keyboard shortcut, scoped to that one tab, and revoked by the browser on navigation. This is the only way the extension can see page content, and it cannot see any page the user has not explicitly invoked it on.
```

**Permission justification — `scripting`**

```
Injects the inspector into the tab the user invoked it on, via chrome.scripting.executeScript. Without it the activeTab grant cannot be used. No script is registered to run automatically on any page; the manifest declares no content_scripts and no host permissions.
```

**Host permission justification**

```
None requested.
```

**Remote code**

```
No, I am not using remote code.
```

Everything executed ships in the package. The extension loads no external
scripts and evaluates no fetched code.

**Data usage — tick nothing.** The extension collects none of the categories
listed (personally identifiable information, health information, financial
information, authentication information, personal communications, location, web
history, user activity, website content). It reads page content into memory to
display it to the user and never transmits or stores it.

**The three certification checkboxes** — you can truthfully tick all three:

- [ ] I do not sell or transfer user data to third parties, outside of the approved use cases
- [ ] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [ ] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:**

```
https://open-inspector-site.pattest.workers.dev/privacy
```

---

## 5. Distribution

- **Visibility:** Public
- **Regions:** All
- **Pricing:** Free. (Chrome Web Store payments were shut down in 2021; there is
  no paid option to choose even if you wanted one.)

---

## 6. After you submit

- Review typically takes a few days, occasionally a couple of weeks. Extensions
  requesting no host permissions tend to clear faster — that is one practical
  benefit of the whole design.
- **Do not launch on Product Hunt until it is live.** A launch that lands people
  on "enable developer mode and load unpacked" converts in the low single
  digits.
- If it is rejected, the reason is nearly always the privacy section. Re-read
  §4 against what the reviewer quoted and resubmit; it is usually one field.

---

## Firefox, when you want it

```bash
pnpm build:firefox
```

Submit at https://addons.mozilla.org. Registration is free — no fee. The build
is MV3 with `strict_min_version` 115. Note in the listing that the eyedropper is
Chromium-only; the control hides itself where the API is absent.
