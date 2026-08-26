# Recipes and the annotation spec

Read this when annotating, batching a set, or wiring `check` into CI. The SKILL.md covers
everything else.

## Contents

- [Annotation shapes](#annotation-shapes)
- [How many annotations](#how-many-annotations)
- [Finding coordinates](#finding-coordinates)
- [Batching a set](#batching-a-set)
- [Store and social sizes](#store-and-social-sizes)
- [CI](#ci)
- [Flag reference](#flag-reference)

## Annotation shapes

`--annotate` takes a JSON file or a JSON array on the command line. Coordinates are in
**source-image CSS pixels**: natural pixels ÷ `--scale`. Origin is the top-left of the
screenshot itself, not of the padded canvas — so an arrow does not move when you change
`--pad`.

```json
[
  { "type": "spotlight", "x": 16, "y": 236, "w": 316, "h": 156 },
  { "type": "box",       "x": 16, "y": 236, "w": 316, "h": 156 },
  { "type": "badge",     "x": 22, "y": 240, "label": "1" },
  { "type": "arrow",     "from": [250, 180], "to": [200, 300], "bend": 0.18 },
  { "type": "text",      "x": 120, "y": 150, "text": "Every edge is editable", "width": 220 },
  { "type": "blur",      "x": 16, "y": 88, "w": 200, "h": 22 },
  { "type": "redact",    "x": 16, "y": 60, "w": 140, "h": 18 }
]
```

| Type | Fields | Notes |
| --- | --- | --- |
| `box` | `x y w h` | Accent outline with a white keyline, so it survives on dark and light UI alike. `highlight` is an alias. |
| `spotlight` | `x y w h` | Dims everything outside the rectangle. Pair with `box` when the region also needs an outline. Only ever use one per image — two spotlights dim each other's subject. |
| `badge` | `x y` + `label` or `n` | Centred on the point, not offset from it. For numbered walkthroughs. |
| `arrow` | `from [x,y]` `to [x,y]`, optional `bend` | Bowed; `bend: 0` is straight, negative bends the other way. The head is at `to`. |
| `text` | `x y text`, optional `width` | Dark pill, light type. Legible on any background, which a bare coloured label is not. |
| `blur` | `x y w h` | Backdrop blur. Use for things that should read as "redacted but real". |
| `redact` | `x y w h` | Solid block. Use when blur is not enough — blur is reversible in principle, and a blurred 6-digit code is not safe. |

Shapes draw in array order, so put `spotlight` first and everything else after it.

`--accent` sets the colour for boxes, arrows and badges. Default `#e5484d`. Use the product's
own accent when it reads on both themes; fall back to red-orange when it does not, because the
annotation layer needs to be visibly *not part of* the UI.

## How many annotations

One idea per image. A screenshot with six numbered badges is a diagram wearing a screenshot
costume, and the reader has to do the work of a legend. If there are six things to say, that is
six images or one real diagram.

The exception is a deliberate numbered walkthrough, where the numbers *are* the content and
the reader is expected to read them in order.

## Finding coordinates

Do not guess. Ask the page, in the same units the annotation spec uses:

```bash
node -e '
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(process.argv[1]);
  console.log(await p.locator(process.argv[2]).first().boundingBox());
  await b.close();
})()' "http://localhost:3000" ".pricing-card"
```

If the shot was clipped with `--selector`, subtract that element's `x`/`y` from every box you
measure — the clip made its top-left the new origin.

For a screenshot you did not capture, `--dump-html out.html` writes the frame's markup; open it
in a browser and use devtools to place things, then transcribe.

## Batching a set

One command, one preset, one scale:

```bash
node "$S" frame raw/*.png --out shots/ --preset clean --scale 2 --suffix ""
node "$S" check shots/
```

`--out` is treated as a directory when there is more than one input or when it has no extension.
`--suffix` appends to each output name, for keeping raw and framed side by side.

If the set has light and dark variants, run twice with different backdrops rather than letting
`--bg auto` pick per file — auto is derived per image, and across a set that produces eight
slightly different greys that read as a mistake:

```bash
node "$S" frame raw/*-dark.png --out shots/ --preset clean --bg ink
ls raw/*.png | grep -v -- '-dark' | xargs node "$S" frame --out shots/ --preset clean --bg paper
```

## Store and social sizes

`--ratio` pads out to an exact aspect ratio with the same backdrop, centring the shot. It only
ever adds space, so nothing is cropped.

```bash
# Chrome Web Store marquee
node "$S" frame raw.png --out promo.png --preset hero --ratio 5:2

# OpenGraph card
node "$S" frame raw.png --out og.png --preset mac --ratio 1.91:1 --bg dusk
```

Store listings usually reject alpha channels and enforce exact pixel sizes. `--ratio` gets the
proportion right; the exact size still needs a resize step, and `sips -z H W out.png` on macOS
or a Playwright pass will do it. Some stores also reject PNGs with an alpha channel even when
it is fully opaque — strip it with
`python3 -c "from PIL import Image; Image.open('p.png').convert('RGB').save('p.png')"`.

## CI

`check` exits non-zero when it finds a problem, so it drops straight into a verify script:

```json
{ "scripts": { "check:shots": "node .claude/skills/polished-screenshots/scripts/shotkit.mjs check apps/site/public/shots" } }
```

Thresholds: `--max-kb` (default 400), `--bleed-ratio` (default 0.05 — the fraction of an edge
that has to be busy before it counts as a cut). Raise `--bleed-ratio` if the design deliberately
bleeds content off an edge; `--no-fail` reports without failing.

Regenerating shots in CI only works if the capture is deterministic — same viewport, same seeded
data, same fonts installed. If it is not, `check` on committed images is still worth having.

## Flag reference

### capture

| Flag | Default | |
| --- | --- | --- |
| `--out` | — | required |
| `--selector` | — | clip to the first match's box |
| `--bleed` | `0` | px of context around `--selector` |
| `--max-height` | — | cap the clip height |
| `--viewport` | `1280x800` | |
| `--scale` | `2` | device pixel ratio |
| `--theme` | `light` | `light` or `dark` |
| `--full-page` | off | |
| `--hide` | — | comma-separated selectors to make invisible |
| `--click` | — | selector to click before capturing |
| `--wait-for` | — | selector to wait for |
| `--wait` | `400` | extra settle time, ms |
| `--freeze` | on | animations, transitions, caret, scrollbars |
| `--omit-background` | off | transparent page background |

Any `frame` flag passed to `capture` frames the result in the same pass.

### frame

| Flag | Default | |
| --- | --- | --- |
| `--out` | — | file, or directory for multiple inputs |
| `--preset` | `clean` | `clean` `mac` `browser` `hero` `docs` `flat` `bare` |
| `--bg` | preset | `auto`, `transparent`, a named backdrop, `linear:#a,#b,angle`, `radial:#a,#b`, or any CSS value |
| `--pad` | preset | px or `%` of the shot's short side; clamped up to the shadow's reach |
| `--radius` | preset | px |
| `--shadow` | preset | `none` `contact` `soft` `deep` `lifted` |
| `--chrome` | preset | `none` `mac` `mac-dark` `browser` `browser-dark` |
| `--title` | — | title bar text, or the URL for browser chrome |
| `--hairline` | on | 1px inner rim separating shot from backdrop |
| `--scale` | `2` | the DPR the **source** was captured at |
| `--ratio` | — | `w:h`, pads out only |
| `--annotate` | — | JSON file or inline array |
| `--accent` | `#e5484d` | annotation colour |
| `--tint` | — | CSS colour multiplied over the shot |
| `--format` | source ext | `png` or `jpg` |
| `--quality` | `92` | jpeg only |
| `--suffix` | — | appended to output names |
| `--dump-html` | — | write the frame markup for debugging |

### check

| Flag | Default | |
| --- | --- | --- |
| `--max-kb` | `400` | file size budget |
| `--bleed-ratio` | `0.05` | busy-edge threshold |
| `--no-fail` | off | report without a non-zero exit |
