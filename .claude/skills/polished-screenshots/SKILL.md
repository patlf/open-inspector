---
name: polished-screenshots
description: >-
  Produce screenshots that look like a product shipped them — the way Shottr, CleanShot X
  or Screely do it: a clean deterministic capture, cropped at a real boundary, on a backdrop
  with padding, rounded corners, a layered shadow, optional macOS or browser window chrome,
  and arrows/numbered badges/blur redaction where they help. Use this whenever a screenshot
  is going to be *seen by someone else* — a marketing or landing page, a README or docs page,
  a changelog, a release post, an app store or Chrome Web Store listing, a slide, a design
  review — and whenever someone says their screenshots look bad, flat, cheap, amateur,
  inconsistent, blurry or "like a bug report", or asks to add a device frame, drop shadow,
  gradient background, padding or annotations to an image. Also use it to audit a set of
  existing screenshots for clipped text, wrong resolution and mismatched sizes. Do NOT use it
  for screenshots you take to verify your own work or to debug a layout — those want the raw
  pixels, and framing them just wastes time.
---

# Polished screenshots

A screenshot that will be looked at by a stranger is a piece of design, and it fails in
predictable ways. This skill is a renderer (`scripts/shotkit.mjs`) plus the judgment about
when to reach for which part of it.

## The one rule

**A frame cannot rescue a bad capture.** Padding, shadow and a mac window around a shot whose
text is cut mid-glyph makes the defect *more* obvious, not less — you have drawn a nice border
around the mistake and lit it. Spend the effort in this order:

1. **Capture** clean and deterministic
2. **Crop** at a boundary the UI actually has
3. **Frame** it
4. **Check** it

Most bad screenshots are lost at step 1 or 2, and no amount of step 3 gets them back.

## Quick start

```bash
S=".claude/skills/polished-screenshots/scripts/shotkit.mjs"

# Capture a live page and frame it in one pass
node "$S" capture http://localhost:3000 --out shots/hero.png \
    --selector ".app-shell" --viewport 1440x900 --preset mac --title "Acme"

# Frame a screenshot you already have (or one from ⌘⇧4 / Shottr / CleanShot)
node "$S" frame raw.png --out shots/hero.png --preset clean

# Frame a whole set consistently
node "$S" frame raw/*.png --out shots/ --preset clean --scale 2

# Audit what you have
node "$S" check shots/
```

No dependencies. It uses Playwright if the project has it, otherwise a local Chrome/Chromium.
`capture` needs Playwright; `frame` and `check` work with either.

## Step 1 — Capture

`capture` applies the hygiene that separates a repeatable shot from a lucky one. It waits for
`document.fonts.ready` (a shot taken mid-swap shows the fallback face, which is the difference
between *our* type and *some* type), freezes animations and transitions, hides the caret and
the scrollbars, forces `prefers-reduced-motion`, and parks the pointer in a corner so no stray
hover state leaks in.

Everything else is on you, and it is the part that matters:

- **Real content, not lorem ipsum.** Placeholder text in a marketing shot tells the reader the
  product has nothing to show.
- **No relative timestamps.** "3 minutes ago" dates the screenshot the moment it is published.
- **Nothing personal.** Real names, emails, avatars, API keys, internal URLs, "Downloads (847)".
  Use `--hide` for banners and `blur`/`redact` annotations for anything that survives.
- **Match the reader's theme.** If the page has light and dark modes, capture `--theme light`
  and `--theme dark` and serve them with a `<picture>` + `prefers-color-scheme` source. A
  light-mode screenshot on a dark-mode page is a jarring white rectangle.
- **`--scale 2`.** A 1× capture upscaled into a 2× layout goes soft exactly where the type is
  smallest, which is where the reader is looking.

Useful flags: `--selector` clips to an element (measured, not guessed), `--bleed` adds context
around it — but check the result, because bleed catches whatever is next to the element.
`--click` and `--wait-for` drive the UI into the state worth showing. `--full-page` for whole
pages.

## Step 2 — Crop where the UI has a seam

This is the step people skip. A crop height picked because it "looked about right" lands
wherever it lands, which is usually the middle of a row of text.

Cut at a divider, a section heading, a card edge, the end of a list — somewhere the UI already
has a horizontal line. If nothing is close, change the viewport or the scroll position instead
of accepting a cut through a word. `check` finds these after the fact, but the cheap fix is to
pick the boundary while you still have the page open.

Deliberately bleeding content off an edge is a legitimate device — it says "this continues"
rather than "this is all there is." It only works when it is obviously intentional: the cut
runs through a large region or a whole repeated row, never through a single line of type.

## Step 3 — Frame

Pick one preset and use it for the entire set. Mixing presets is what makes a gallery look
assembled from whatever was lying around.

| Preset | Backdrop | Chrome | Use for |
| --- | --- | --- | --- |
| `clean` | derived from the shot | none | The default. A UI region, a panel, a component. |
| `mac` | derived | macOS title bar | A desktop app, or a whole window. |
| `browser` | slate | URL bar | Anything where "this is a website" is the point. |
| `hero` | derived | macOS | Above the fold. Generous padding, tall shadow. |
| `docs` | transparent | none | Inline in a README or docs page. |
| `flat` | derived | none | Dense grids, where shadows on every tile become noise. |
| `bare` | transparent | none | Rounded corners only, for placing on a page that supplies its own background. |

Three things the renderer does that are worth knowing about, because they are the things
that usually get done wrong by hand:

- **The shadow is stacked, not single.** Six layers from a tight contact shadow out to a wide
  ambient one. A single `0 20px 60px rgba(0,0,0,.3)` produces a uniform grey halo with no
  contact, which is the clearest tell of a screenshot that was decorated rather than lit.
- **`--bg auto` derives the backdrop from the shot's own edge pixels** in OKLCH, capping chroma
  hard, so the pair reads as one object under one light. Named backdrops (`paper`, `slate`,
  `sand`, `mint`, `blush`, `dusk`, `ink`, `graphite`) are all low-chroma on purpose. A saturated
  gradient competes with the screenshot for the same attention and dates the image.
- **The source is never resampled.** It is placed at exactly `naturalWidth / --scale` CSS px on
  a whole device pixel. `--scale` tells the renderer what DPR the source was captured at — it
  does not resize anything. Get it wrong and you lose the sharpness you captured at 2× for.

If the shot is going into a card or tile that already has its own shadow and radius, use `bare`
or `docs`. Two shadows on one object looks like a mistake, because it is one.

## Step 4 — Check

```bash
node "$S" check shots/
```

Reports, and exits non-zero on:

- **an edge that cuts through content** — the band just inside each edge is scanned for the
  sharp light/dark transitions that half-glyphs produce
- images over the file-size budget (`--max-kb`, default 400)
- images too small for where they will be displayed
- **a set whose members are different sizes** — the thing that makes a grid jitter

`check` reads the pixels, so it catches what review misses: whoever chose the crop was looking
at the content, not at the boundary.

## Annotations

Arrows, numbered badges, highlight boxes, spotlight dimming, blur and redaction. Coordinates are
in source-image CSS pixels — natural pixels divided by `--scale`, the same space the shot is laid
out in.

```bash
node "$S" frame raw.png --out out.png --preset clean --annotate anno.json --accent "#e5484d"
```

The full shape spec, and guidance on how many annotations one image can carry, is in
`references/recipes.md`. Read it when you are annotating; skip it otherwise.

## Where this goes wrong

| Symptom | Cause |
| --- | --- |
| Soft or fuzzy type | `--scale` does not match the DPR the source was captured at |
| Shadow cut off square at the canvas edge | `--pad` is tighter than the shadow reaches; raise it or use a shorter `--shadow` |
| Shot floats with no separation on a dark backdrop | Dark shadow on dark ground does nothing — the hairline carries it; keep `--hairline` on |
| Backdrop fights the UI | `--bg auto` sampled a colourful banner at the edge; name a backdrop instead |
| Set looks messy in a grid | Mixed presets or mixed sizes — `check` a directory to confirm |
| Framed shot looks worse than the raw one | The shot is going somewhere that already frames it; use `bare` |

## Sources other than a browser

`frame` takes any PNG or JPEG, so a macOS `⌘⇧4`, a Shottr or CleanShot export, a simulator
recording still, or a Figma export all go through the same pipeline. macOS window captures
already carry a rounded alpha corner and the system's own shadow — capture with
`screencapture -o` to suppress that shadow, then let `frame` supply a consistent one, or the two
shadows will stack.

## Using this outside Claude Code

`scripts/shotkit.mjs` is a plain Node CLI with no dependencies and no knowledge of any agent
harness. For another agent, either point it at this SKILL.md or copy the `## Quick start` and
`## The one rule` sections into that project's `AGENTS.md`. To make it available everywhere
rather than in one repo, copy the directory to `~/.claude/skills/`.
