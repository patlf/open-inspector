# Open Inspector — Product Context

## Register

**Product.** A tool that serves a task. Design is in service of reading a page
accurately and fast; nothing here is a landing page or a campaign surface.

## What it is

A free, open-source browser extension that inspects layout, styles, colour,
type, assets and design tokens on any page — without opening DevTools. It
requests no host permissions and makes no network requests, both enforced in CI.

## Users

Front-end developers and product designers, working in a browser on someone
else's page — a competitor's site, a staging environment, a client's build, an
internal dashboard. They are mid-task and interrupted: the panel is opened to
answer one question ("what font is that", "why is this element 3px off",
"what's the real brand palette") and then dismissed.

Two things follow from that context:

- **They already know CSS.** Property names do not need translating. Hiding the
  real value behind a friendly label costs trust.
- **They are on a page they do not control**, often one they cannot afford to
  break. Every mutation must be exactly revertible, and must be *visibly* so.

## Why it exists

The three established tools — CSS Peeper, Hoverify, MiroMiro — are closed
source and all request permission to read every page you visit. That includes
staging environments, internal dashboards and anything you are logged into.
None of them can show you what they do with that access.

The product's differentiator is **auditability**: zero host permissions, zero
network egress, both checked by a script that fails the build. The second
differentiator is **honest failure** — the panel says "this stylesheet is
cross-origin and cannot be read" rather than "no rules matched".

## Personality

**A precise instrument.** Dense, quiet, monospace-led. It should read like a
measuring device, not an app: numbers are the content, chrome is minimal, and
colour is reserved for meaning (a state that is on, a value that was changed, a
contrast check that failed). Closest in spirit to Chrome DevTools, Linear and
Raycast.

Its voice is plain and specific. It states limits rather than hiding them.

## Anti-references

- **CSS Peeper** — pretty but shallow; hides real values behind a curated view.
  We show the truth even when the truth is ugly.
- **Hoverify** — feature-dense to the point of being a toolbar of toolbars.
  Do not add a control per capability.
- **MiroMiro** — reads as a consumer app. We are a developer tool.
- **Generic "AI dashboard"** — card grids, hero metrics, gradient accents,
  decorative icons. None of that belongs in an instrument.

## Design principles

1. **Numbers are the interface.** Values get the visual weight; labels recede.
2. **Never a confident wrong answer.** An unknown is stated as unknown, with a
   reason. Illegible is a failure mode as bad as inaccurate.
3. **Reversibility must be visible.** Anything that mutates the page shows up
   in one list, with what it was before, and one control to undo it.
4. **Colour means something.** Accent = active or changed. Warn = clamped or
   approximate. Risk = failing. Nothing is coloured for decoration.
5. **Fits in a shadow root over a hostile page.** Every rule is defensive; the
   page's CSS must never reach in, and ours must never leak out.

## Accessibility

Non-negotiable, and specifically load-bearing: the panel *grades other pages*
on WCAG contrast. Failing that standard itself would undermine the feature.

- All text meets WCAG AA (4.5:1 body, 3:1 large).
- Disabled controls are still readable — they carry a real answer ("this page
  defines no `:hover` rules"), so they must not fade to unreadable.
- Every control reachable and operable by keyboard; visible focus everywhere.
- Nothing conveyed by colour alone.
