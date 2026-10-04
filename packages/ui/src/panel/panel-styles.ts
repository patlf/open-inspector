/**
 * The light theme's tokens, written once for the two places that use them:
 * the system's light preference, and light chosen in settings.
 */
const LIGHT_PANEL = `
      --bg: #ffffff;
      --bg-raised: #f4f6f7;
      --bg-sunk: #eaedef;
      --ink: #14181c;
      --ink-soft: #3d474e;
      /* Tuned against --bg-sunk, the darkest light surface: 5.06:1 there. */
      --ink-mute: #5c656b;
      --grip-shade: rgba(20, 24, 28, 0.45);
      --grip-light: #ffffff;
      --rule: #d5dbde;
      /* 3.5:1 on sunk, clearing the 3:1 that WCAG 1.4.11 asks of a boundary. */
      --rule-strong: #787d80;
      /*
       * White reads on the light accent (5.37:1) but only 3.06:1 on the dark
       * one, which is why the most prominent control in the panel — the
       * Inspect button — was the least legible thing in it after dark. The
       * dark theme puts near-black on the orange instead, at 5.83:1.
       */
      --on-accent: #ffffff;
      --accent: #b8451f;
      --accent-wash: rgba(184, 69, 31, 0.10);
      /* Both clear 4.5:1 on sunk, where the copied state and notes sit. */
      --good: #376f4e;
      --warn: #86591a;
      --risk: #a8352b;
      --bd-margin: #fbe3cc;
      --bd-border: #fcf1c6;
      --bd-padding: #dbebd4;
      --bd-content: #cfe1ec;
      --bd-ink: #14181c;
      --bd-zero: #50555b;
      --syn-keyword: #1c58b8;
      --syn-name: #0b6a62;
      --syn-string: #2f6a30;
      --syn-number: #8a5200;
      --syn-selector: #6a3fbf;
      box-shadow: 0 16px 48px -18px rgba(20, 24, 28, 0.4), 0 1px 3px rgba(20, 24, 28, 0.16);
`;

/**
 * Styles for the panel's shadow tree.
 *
 * The panel floats over pages we do not control, so it commits to its own
 * visual world rather than trying to blend in: a compact instrument, dark by
 * default because that is the convention for developer tools and because a
 * light panel glares over most sites. It follows the viewer's colour-scheme
 * preference, since designers frequently work in light, unless settings
 * choose one or the other.
 *
 * Everything is scoped by the shadow boundary, so class names can be short and
 * no selector needs defensive specificity.
 */
export const PANEL_STYLES = `
  :host {
    all: initial;
    /*
     * The panel's one curve, for everything that enters, leaves or answers a
     * press: a strong ease-out, which moves at once and settles, so a short
     * transition still reads as immediate. Color fades use plain ease.
     */
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  }

  /*
   * Thin scrollbars everywhere in the panel: not inherited, so it goes on
   * every element. Their colour is inherited, and set once on .panel.
   */
  * { box-sizing: border-box; scrollbar-width: thin; }

  .panel {
    --bg: #14181c;
    --bg-raised: #1b2126;
    --bg-sunk: #0f1316;
    --ink: #e6eaec;
    --ink-soft: #b3bcc2;
    /*
     * Muted, but never below AA.
     *
     * This one token paints seven things — the breadcrumb, dimensions, icon
     * buttons, inactive tabs, specificity, the sibling counter, copy buttons —
     * and it is painted on three surfaces. It was tuned against --bg only, so
     * on the raised header it measured 4.43:1 and every one of those failed.
     * Chosen to clear 4.5:1 on bg, raised and sunk alike.
     */
    --ink-mute: #838d94;
    --rule: #2b343a;
    /*
     * Borders that carry meaning rather than decorate.
     *
     * --rule is a 1.4:1 hairline: right for a divider between sections,
     * wrong for the edge of an input or a chip, which WCAG 1.4.11 asks to
     * reach 3:1 because the boundary is what tells you the control is there.
     */
    --rule-strong: #656b70;
    /*
     * A thumb and no track. The panel scrolls in several places at once — the
     * body, the tree, code blocks — and a full track on each drew more lines
     * than the content did. Mixed from --ink-mute so it follows the theme.
     */
    --scroll-thumb: color-mix(in srgb, var(--ink-mute) 55%, transparent);
    /* The corner grip's pressed-in pixels: a shadow, and the light that catches its lower edge. */
    --grip-shade: rgba(0, 0, 0, 0.75);
    --grip-light: rgba(255, 255, 255, 0.22);
    /* Text on an accent fill. See the note in the light block. */
    --on-accent: #14181c;
    --accent: #e4743f;
    --accent-wash: rgba(228, 116, 63, 0.14);
    --good: #6aab84;
    --warn: #c79b4a;
    /* Lifted from #d9705f so a risk pill on its own wash clears AA. */
    --risk: #e07a69;
    --mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
    --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    /*
     * The box model's DevTools colours, per theme.
     *
     * They used to be the same pale fills in both themes, which kept the
     * diagram legible but made it the brightest thing on a dark panel by far.
     * Dark gets the same hues sunk to the panel's depth, with light ink; every
     * number clears 4.5:1 on its own fill in both themes.
     */
    --bd-margin: #4a3627;
    --bd-border: #4a4327;
    --bd-padding: #2e4331;
    --bd-content: #294453;
    --bd-ink: #e6eaec;
    --bd-zero: #b3bcc2;
    /*
     * Syntax colors for the code blocks. Each clears 7.8:1 on every surface
     * code sits on here, and 5.4:1 in the light block; comments and
     * punctuation take --ink-mute, already held to AA.
     */
    --syn-keyword: #79b8ff;
    --syn-name: #5fd0c4;
    --syn-string: #9fcf7f;
    --syn-number: #e3b46a;
    --syn-selector: #c3a6ff;

    position: fixed;
    top: 12px;
    right: 12px;
    bottom: 12px;
    /* Overridden inline once the inner edge has been dragged. */
    width: 348px;
    max-width: calc(100vw - 24px);
    display: flex;
    background: var(--bg);
    color: var(--ink);
    border: 1px solid var(--rule);
    border-radius: 10px;
    box-shadow: 0 16px 48px -12px rgba(0, 0, 0, 0.65), 0 2px 8px rgba(0, 0, 0, 0.4);
    font-family: var(--sans);
    font-size: 12px;
    line-height: 1.5;
    pointer-events: auto;
    overflow: hidden;
    scrollbar-color: var(--scroll-thumb) transparent;
  }

  /*
   * Light: the system's when the panel follows it, or chosen in settings.
   * A chosen dark keeps the dark tokens above whatever the system says.
   */
  @media (prefers-color-scheme: light) {
    .panel:not([data-theme='dark']) {
${LIGHT_PANEL}    }
  }
  .panel[data-theme='light'] {
${LIGHT_PANEL}  }

  .panel[data-side='left'] { right: auto; left: 12px; }
  /*
   * Floating where it was dropped: its top-left corner comes inline, and it
   * still runs down to the bottom margin, so the body keeps all the height
   * there is below it.
   */
  .panel[data-side='float'] { right: auto; bottom: 12px; }
  .panel[data-dragging='true'] { user-select: none; }
  /*
   * A DevTools tab: the panel is the whole document, so it fills it, square
   * and flat, with no floating frame around it.
   */
  .panel[data-side='embedded'] {
    position: fixed;
    inset: 0;
    width: auto;
    max-width: none;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  /* Everything but the rail: header, the tab's content, the footer. */
  .main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* ---------- collapsed ---------- */

  /*
   * A thin edge tab, so a 375px viewport preview is not entirely covered by
   * the panel that asked for it. Deliberately not a floating pill — flush
   * against the edge it came from, it reads as "the panel is over there".
   */
  .panel-tab {
    position: fixed;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    width: 24px;
    padding: 26px 0;
    writing-mode: vertical-rl;
    /*
     * In the accent, because it is the only trace of the inspector left on
     * screen. A grey tab at the edge of a busy page read as part of the page,
     * and collapsing looked like closing.
     */
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid #e4743f;
    border-right: 0;
    border-radius: 6px 0 0 6px;
    background: #e4743f;
    color: #14181c;
    font: 600 11px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    letter-spacing: 0.02em;
    cursor: pointer;
    pointer-events: auto;
    box-shadow: -4px 0 16px -6px rgba(0, 0, 0, 0.6);
  }
  .panel-tab[data-side='left'] {
    right: auto;
    left: 0;
    border: 1px solid #e4743f;
    border-left: 0;
    border-radius: 0 6px 6px 0;
    box-shadow: 4px 0 16px -6px rgba(0, 0, 0, 0.6);
  }
  .panel-tab:hover { filter: brightness(1.08); }

  @media (prefers-color-scheme: light) {
    .panel-tab:not([data-theme='dark']) {
      background: #b8451f;
      border-color: #b8451f;
      color: #ffffff;
    }
  }
  .panel-tab[data-theme='light'] {
    background: #b8451f;
    border-color: #b8451f;
    color: #ffffff;
  }

  /* ---------- toolbar ---------- */

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Also an .icon-btn, for its colours; this undoes that class's square box. */
  .icon-btn.hide-btn {
    width: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    color: var(--ink-soft);
  }
  .btn-label {
    font-family: var(--sans);
    font-size: 11px;
  }

  /*
   * A filled field, not an outlined one.
   *
   * The icon and the placeholder say what it is; the outline only added one
   * more line to a header that was all lines. Focus still draws the full ring.
   */
  .search-box {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    background: var(--bg-sunk);
    color: var(--ink-mute);
    cursor: text;
  }
  .search-box:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }

  .search,
  .tree-search {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--ink);
    font-family: var(--sans);
    font-size: 11.5px;
  }
  .search::placeholder,
  .tree-search::placeholder { color: var(--ink-mute); }
  .search::-webkit-search-cancel-button,
  .tree-search::-webkit-search-cancel-button { filter: grayscale(1) opacity(0.6); }

  /*
   * Presets, not a free-form number box. The widths that matter are few and
   * known, and typing one is slower than clicking it.
   */
  .viewport {
    display: inline-flex;
    /* Sized to its buttons, not stretched across the Layout group. */
    align-self: flex-start;
    gap: 2px;
    padding: 2px;
    border-radius: 7px;
    background: var(--bg-sunk);
  }
  .viewport-btn {
    padding: 0 8px;
    height: 20px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ink-soft);
    font-family: var(--mono);
    font-size: 10px;
    line-height: 20px;
    cursor: pointer;
  }
  .viewport-btn:hover { color: var(--ink); background: transparent; }
  /*
   * Filled with the accent when a width is forced, because accent means "you
   * have changed something" — the window really has moved.
   */
  .viewport-btn[aria-pressed='true'] { background: var(--accent); color: var(--on-accent); }

  /*
   * "auto" is the resting state, so it is not an alert.
   *
   * Accent means "you have changed something". Filling the default preset
   * meant the toolbar carried a permanent orange chip announcing that nothing
   * was happening, which is exactly backwards.
   */
  .viewport-btn[data-resting='true'][aria-pressed='true'] {
    background: var(--bg);
    color: var(--ink);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
  }

  /*
   * Stated, not acted on.
   *
   * Sits under the toolbar when the previewed viewport is narrower than the
   * panel, offering the collapse rather than performing it.
   */
  .coverage-hint {
    margin: 0;
    padding: 0 10px 8px;
    font-size: 10.5px;
    line-height: 1.45;
    color: var(--ink-mute);
  }

  .link-btn {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    font: inherit;
    cursor: pointer;
  }
  .link-btn:hover { background: none; filter: brightness(1.1); }

  /* Shown only when the browser refused the width that was asked for. */
  .viewport-actual[data-error='true'] { color: var(--risk); cursor: help; }

  .coverage-hint[data-error='true'] { color: var(--risk); }

  .viewport-actual {
    padding: 0 5px;
    font-family: var(--mono);
    font-size: 9.5px;
    line-height: 20px;
    color: var(--warn);
  }

  /*
   * The native colour well, stripped of its chrome so it reads as a swatch
   * that happens to be clickable rather than as a form control.
   */
  .color-well {
    flex: none;
    width: 15px;
    height: 15px;
    padding: 0;
    border: 1px solid var(--rule-strong);
    border-radius: 3px;
    background: none;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }
  .color-well::-webkit-color-swatch-wrapper { padding: 0; }
  .color-well::-webkit-color-swatch { border: 0; border-radius: 2px; }
  .color-well::-moz-color-swatch { border: 0; border-radius: 2px; }

  /*
   * A group whose every row was filtered out holds nothing but its own title.
   * Hiding it here rather than in each section keeps the sections ignorant of
   * the search, which is the only reason one input can filter all of them.
   */
  .body[data-searching='true'] .group:not(:has(> *:not(.group-title))) {
    display: none;
  }

  /*
   * Nor are the diagram and the state chips kept: neither has a row the
   * filter can match, so they survived every query and pushed the rows that
   * did match off the first screen.
   */
  .body[data-searching='true'] .group:has(> .boxdiagram),
  .body[data-searching='true'] .group:has(> .states) {
    display: none;
  }

  /* ---------- header ---------- */

  .head {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 9px 8px 9px 12px;
    border-bottom: 1px solid var(--rule);
    flex: none;
  }

  .head-top { display: flex; align-items: center; gap: 8px; min-height: 26px; }

  /*
   * Ink, not accent. Accent marks what you have changed or switched on; the
   * element's name is neither, and painting it orange made it compete with
   * the edits it was meant to be read alongside.
   */
  .selector {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 600;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 1 auto;
    min-width: 0;
  }

  /*
   * Directly after the selector, and never cut. A clipped size reads as a
   * different number ("256 × 20" of "256 × 202.45"); the selector truncates
   * with an ellipsis instead, and carries its full text as a title.
   */
  .dims {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--ink-mute);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex: none;
  }

  .head-actions { display: flex; gap: 2px; flex: none; margin-left: auto; }

  /*
   * The page is modified: say so from every tab.
   *
   * Accent, because accent means "changed" — this is the one piece of chrome
   * that earns it. On the tab rather than in the header, where it squeezed
   * the selector, the single most important label in the panel.
   */
  .tab-count {
    position: absolute;
    top: -2px;
    right: -3px;
    min-width: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 9.5px;
    font-weight: 600;
    line-height: 14px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    box-shadow: 0 0 0 2px var(--bg-raised);
  }

  /* The close button, when pressing it would revert something. */
  .icon-btn[data-pending='true'] { color: var(--accent); }

  .confirm-close {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--bg);
    font-size: 11px;
    line-height: 1.45;
  }
  .confirm-close p { margin: 0; color: var(--ink-soft); }
  .confirm-close b { color: var(--ink); font-weight: 600; }
  .confirm-actions { display: flex; gap: 6px; }
  .confirm-actions button {
    font-size: 11px;
    border-color: var(--rule-strong);
    border-radius: 5px;
  }
  .confirm-actions .confirm-yes {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .confirm-actions .confirm-yes:hover { filter: brightness(1.08); background: var(--accent); }

  /*
   * The inner edge of the panel, as a drag handle.
   *
   * Invisible until it is wanted: a hairline of accent on hover or focus is
   * enough to say "this edge moves" without a grip icon on every screen.
   */
  .resize-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 6px;
    /* Above the rail, which sits on the same edge when the panel is docked right. */
    z-index: 3;
    cursor: ew-resize;
    touch-action: none;
  }
  .panel[data-side='left'] .resize-handle,
  .panel[data-side='float'] .resize-handle { left: auto; right: 0; }
  .resize-handle::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2px;
    background: transparent;
    transition: background 120ms ease;
  }
  .panel[data-side='left'] .resize-handle::after,
  .panel[data-side='float'] .resize-handle::after { left: auto; right: 0; }
  .resize-handle:hover::after,
  .resize-handle:focus-visible::after,
  .resize-handle[data-dragging='true']::after { background: var(--accent); }
  .resize-handle:focus-visible { outline: none; }

  /* The bottom edge: the same thin line as the side, turned on its side. */
  .resize-bottom {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 6px;
    z-index: 3;
    cursor: ns-resize;
    touch-action: none;
  }
  .resize-bottom::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: transparent;
    transition: background 120ms ease;
  }
  .resize-bottom:hover::after,
  .resize-bottom:focus-visible::after,
  .resize-bottom[data-dragging='true']::after { background: var(--accent); }
  .resize-bottom:focus-visible { outline: none; }

  /*
   * The bottom-right corner, above both edges so a press there takes width and
   * height together. A grip of three inset pixels marks it.
   */
  .resize-corner {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 14px;
    height: 14px;
    z-index: 4;
    cursor: nwse-resize;
    touch-action: none;
  }
  .corner-grip {
    position: absolute;
    right: 3px;
    bottom: 3px;
    display: block;
    shape-rendering: crispEdges;
  }
  .grip-shade { fill: var(--grip-shade); }
  .grip-light { fill: var(--grip-light); }

  button {
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    cursor: pointer;
    padding: 3px 6px;
    transition: scale 160ms var(--ease-out);
  }

  /*
   * A press gives a little under the pointer, so a click is felt before its
   * result lands. The scale property rather than transform, so it composes
   * with the buttons a transform positions. Pointer presses only — a key
   * press does not set :hover, and keyboard actions should not animate.
   */
  @media (prefers-reduced-motion: no-preference) {
    button:not(:disabled):active:hover { scale: 0.97; }
  }

  button:hover { background: var(--bg-sunk); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  .icon {
    display: block;
    flex: none;
  }

  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    color: var(--ink-mute);
    line-height: 1;
  }
  .icon-btn:hover { color: var(--ink); }
  .icon-btn[aria-pressed='true'] { color: var(--accent); background: var(--accent-wash); }

  /*
   * Labelled and filled while nothing is selected, where it is the only thing
   * to do. The state is carried by the trailing word, not by making the button
   * disappear into the chrome when it is off.
   */
  .primary-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    font-weight: 600;
    padding: 4px 9px 4px 7px;
    border-radius: 6px;
    white-space: nowrap;
    background: var(--accent);
    border: 1px solid var(--accent);
    color: var(--on-accent);
  }

  .primary-btn:hover { filter: brightness(1.08); background: var(--accent); }

  .primary-btn .state {
    font-size: 9.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding-left: 6px;
    /* Separated by a rule, not by being faded — fading it cost 1.5:1. The
       separator may fade; the label may not. */
    border-left: 1px solid color-mix(in srgb, currentColor 40%, transparent);
  }

  /*
   * Off: the picker is paused. A toggle like the forced states, so it reads
   * the same way they do — neutral while off, solid accent while on.
   */
  .primary-btn[aria-pressed='false'] {
    background: var(--bg-sunk);
    border-color: transparent;
    color: var(--ink-soft);
  }
  .primary-btn[aria-pressed='false']:hover {
    filter: none;
    background: var(--bg-sunk);
    color: var(--ink);
  }

  /*
   * Once an element is held: the same button as an icon, solid while
   * picking, because the page cannot be clicked then and that must be
   * obvious.
   */
  .primary-btn[data-compact='true'] {
    /* .primary-btn comes later than .icon-btn and is inline-flex, which left
       the icon hugging the left edge of its square. */
    justify-content: center;
    gap: 0;
    padding: 0;
    font-weight: 400;
  }
  /* Outranks .icon-btn[aria-pressed='true'], whose wash would otherwise win. */
  .primary-btn[data-compact='true'][aria-pressed='true'] {
    color: var(--on-accent);
    background: var(--accent);
    border-color: var(--accent);
  }

  /* ---------- editing ---------- */

  /*
   * An edited row is marked, not merely different. Someone returning to the
   * panel after a minute needs to know which numbers are the page's and which
   * are theirs — without that, the tool quietly lies about the site.
   */
  .editable {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 1px 4px;
    margin: -1px -4px;
    border: 1px solid transparent;
    border-radius: 3px;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: text;
    min-width: 0;
  }

  .editable:hover {
    background: var(--bg-sunk);
    border-color: var(--rule);
  }

  .editable[data-edited='true'] { color: var(--accent); }

  .row[data-edited='true'] .row-label { color: var(--accent); }
  .row[data-edited='true'] .row-label::after {
    content: ' •';
    color: var(--accent);
  }

  .edit-input {
    font-family: var(--mono);
    font-size: 11.5px;
    width: 100%;
    min-width: 0;
    padding: 1px 4px;
    margin: -1px -4px;
    background: var(--bg-sunk);
    color: var(--ink);
    border: 1px solid var(--accent);
    border-radius: 3px;
    outline: none;
  }

  /* Rejected values stay on screen. Silently reverting would leave the user
     unsure whether they mistyped or the tool failed. */
  .edit-input[data-rejected='true'] {
    border-color: var(--risk);
    color: var(--risk);
  }

  .revert { color: var(--risk); }
  .row .revert, .change .revert { opacity: 1; }

  /* ---------- forced states ---------- */

  .states { display: flex; flex-wrap: wrap; gap: 4px; }

  .state-toggle {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--ink-soft);
    background: var(--bg-sunk);
    padding: 3px 7px;
  }
  .state-toggle:hover { color: var(--ink); }
  .state-toggle[aria-pressed='true'] {
    color: var(--on-accent);
    background: var(--accent);
    border-color: var(--accent);
  }
  .state-toggle[aria-pressed='true']:hover { background: var(--accent); }

  /*
   * Disabled means the page defines no rules for that state — a real answer,
   * so it stays visible rather than being hidden.
   *
   * Both rules exclude a pressed toggle, and that exclusion is the whole
   * point. A toggle that is on paints white text on the accent; letting the
   * disabled rules blank its background and drop it to a third opacity left
   * white-on-white, and the label vanished entirely.
   */
  .state-toggle:disabled:not([aria-pressed='true']) {
    /*
     * Legible, not faded.
     *
     * At 0.45 opacity this measured 1.8:1 — the label was gone. A disabled
     * toggle here is not an absence of an answer, it *is* the answer ("nothing
     * on this page styles :focus"), so unavailability is carried by the dashed
     * edge and the cursor while the text stays at full strength.
     */
    color: var(--ink-mute);
    border-style: dashed;
    border-color: var(--rule);
    cursor: not-allowed;
  }
  .state-toggle:disabled:not([aria-pressed='true']):hover { background: transparent; }

  /* ---------- assets ---------- */

  .asset {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 4px;
    border-radius: 3px;
  }
  .asset:hover { background: var(--bg-sunk); }

  /*
   * A checkerboard behind every thumbnail.
   *
   * Half the icons on a real page are dark artwork on transparency; on a dark
   * panel they render as an empty square, which reads as a broken image rather
   * than as a picture of something dark.
   */
  .asset-thumb {
    width: 48px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    overflow: hidden;
    background-color: #8b8b8b;
    background-image:
      linear-gradient(45deg, #6f6f6f 25%, transparent 25%, transparent 75%, #6f6f6f 75%),
      linear-gradient(45deg, #6f6f6f 25%, transparent 25%, transparent 75%, #6f6f6f 75%);
    background-size: 10px 10px;
    background-position: 0 0, 5px 5px;
  }

  .asset-thumb[data-empty='true'] {
    background: var(--bg-sunk);
    background-image: none;
  }

  .asset-thumb img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    display: block;
  }

  .asset-thumb-note {
    font-family: var(--mono);
    font-size: 9.5px;
    line-height: 1.2;
    text-align: center;
    color: var(--ink-mute);
    padding: 2px;
    overflow: hidden;
  }

  .asset-body { display: flex; flex-direction: column; min-width: 0; }

  .asset-name {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .asset-meta {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--ink-mute);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .asset-actions { display: flex; gap: 2px; }
  .asset .copy { opacity: 0; }
  .asset:hover .copy, .asset:focus-within .copy { opacity: 1; }

  /* ---------- changes list ---------- */

  .change-block {
    border-radius: 6px;
    background: var(--bg-raised);
    overflow: hidden;
  }

  .change-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 8px;
    font-family: var(--mono);
    font-size: 10.5px;
  }

  .change-element {
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .change-here { color: var(--ink-mute); }

  /*
   * Before and after, stacked and both labelled.
   *
   * A list of new values alone cannot be read a minute later — there is no way
   * to tell a nudge from a rewrite, and no way to put it back by hand.
   */
  .change {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 8px;
    padding: 5px 8px;
    border-top: 1px solid var(--rule);
    font-family: var(--mono);
    font-size: 10.5px;
  }

  .change-prop {
    grid-column: 1;
    color: var(--ink-soft);
  }

  .change-now {
    grid-column: 1;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .change-now::before {
    content: 'now ';
    color: var(--ink-mute);
  }

  .change-was {
    grid-column: 1;
    color: var(--ink-mute);
    text-decoration: line-through;
    overflow-wrap: anywhere;
  }

  .change .revert {
    grid-column: 2;
    grid-row: 1 / span 3;
    align-self: start;
  }

  .changes-note {
    margin: 0;
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--ink-mute);
  }

  .onboard {
    margin: 0;
    font-size: 12px;
    color: var(--ink);
  }

  .onboard-keys {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--ink-mute);
  }

  .onboard-note {
    margin: 4px 0 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--ink-mute);
  }

  /* The shortcut sheet, when opened from the header's "?" button. */
  .head .onboard-keys {
    padding: 8px;
    border-radius: 6px;
    background: var(--bg-raised);
  }

  .onboard-keys b {
    font-family: var(--mono);
    font-weight: 500;
    color: var(--ink-soft);
    background: var(--bg-raised);
    border: 1px solid var(--rule);
    border-radius: 3px;
    padding: 0 4px;
    margin-right: 4px;
  }

  .boundary-note {
    margin: 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--warn);
  }

  /* ---------- breadcrumb ---------- */

  .crumbs { display: flex; align-items: center; gap: 6px; min-width: 0; }

  /*
   * Scrolls sideways rather than wrapping, and is kept scrolled to its end.
   *
   * A deep DOM produces a long path; wrapping it would push everything below
   * down the panel every time the selection moved.
   */
  .crumb-trail {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 1px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .crumb-trail::-webkit-scrollbar { display: none; }
  /* Only when the start of the path is actually scrolled out of view. */
  .crumb-trail[data-clipped='true'] {
    mask-image: linear-gradient(to right, transparent, #000 16px);
  }

  .crumb-item { display: inline-flex; align-items: center; gap: 1px; flex: none; }
  .crumb-sep { color: var(--ink-mute); font-size: 10px; }

  .crumb {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--ink-mute);
    padding: 1px 3px;
    border: 0;
    border-radius: 4px;
    white-space: nowrap;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .crumb:hover { color: var(--ink); background: var(--bg-sunk); }
  .crumb[aria-current='true'] {
    color: var(--ink);
    font-weight: 500;
    cursor: default;
    background: transparent;
  }

  .crumb-steps { display: flex; align-items: center; flex: none; margin-left: -4px; }

  .step {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    color: var(--ink-soft);
  }
  /*
   * Receded, not faded. "No previous sibling" is information, so the arrow
   * stays at a colour that clears 3:1 as an icon; at 0.35 opacity it measured
   * 1.5:1 and simply looked broken.
   */
  .step:disabled { color: var(--rule-strong); cursor: not-allowed; }
  .step:disabled:hover { background: transparent; }

  .crumb-count {
    flex: none;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--ink-mute);
    font-variant-numeric: tabular-nums;
  }

  /* The drawer toggle is a step button that stays lit while the tree is open. */
  .step[aria-pressed='true'] { color: var(--accent); background: var(--accent-wash); }

  /* ---------- structure drawer ---------- */

  /*
   * A fixed share of the panel with its own scroll, so a deep tree never
   * pushes the tab content off screen. The bottom edge can be dragged: some
   * pages want a tall tree, most want their styles.
   */
  .structure {
    position: relative;
    height: 220px;
    min-height: 96px;
    max-height: 70vh;
    resize: vertical;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 3px 0;
    background: var(--bg-sunk);
    border: 1px solid var(--rule);
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.65;
  }

  /* Rows grow to their content and scroll sideways, as deep trees need. */
  .node {
    display: flex;
    align-items: center;
    gap: 1px;
    width: max-content;
    min-width: 100%;
    padding-right: 10px;
    white-space: nowrap;
    color: var(--ink-soft);
    cursor: default;
  }
  .node:hover { background: var(--bg-raised); }
  .node:focus { outline: none; }
  .node:focus-visible { box-shadow: inset 0 0 0 1px var(--accent); }
  /* Ink on the wash: the selected row must stay as legible as any other. */
  .node[aria-selected='true'] { background: var(--accent-wash); color: var(--ink); }
  .node[aria-selected='true'] .node-attrs,
  .node[aria-selected='true'] .node-text { color: var(--ink); }

  .node-twisty {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 14px;
    height: 14px;
    color: var(--ink-mute);
  }
  /*
   * Turns at once. The tree is walked with the arrow keys as often as with
   * the pointer, and its rows appear without easing; a twisty still turning
   * after its children have arrived only reads as lag.
   */
  .node-twisty[data-open='true'] .icon { transform: rotate(90deg); }

  .node-tag { color: var(--ink); }
  .node-attrs { color: var(--ink-mute); }
  .node[data-kind='shadow-root'] .node-tag { color: var(--ink-soft); font-style: italic; }
  .node-text { margin-left: 6px; color: var(--ink-mute); font-family: var(--sans); }
  .node-text::before { content: '“'; }
  .node-text::after { content: '”'; }
  .node-address { margin-left: 6px; color: var(--ink-soft); }
  .node-file { margin-left: 6px; color: var(--ink-soft); }
  .node-file[data-inline='true'] { color: var(--ink-mute); font-style: italic; }
  .node-more { color: var(--ink-soft); text-decoration: underline; text-underline-offset: 2px; }
  /*
   * The JavaScript logo as a prefix to the tag, so a row with handlers is
   * found at a glance. Placed there by order, not written there: in the
   * markup it follows the tag, so a screen reader names the element before
   * the mark.
   *
   * Grey, like the JS filter while it is off: a mark on many rows should
   * not outshout the tags it sits beside. Its letters are cut out of the
   * square, so the row's own background draws them, in either theme.
   */
  .node-twisty { order: -2; }
  .node-js {
    order: -1;
    flex: none;
    display: grid;
    margin-right: 4px;
    color: var(--ink-mute);
    cursor: pointer;
  }
  .node-js:hover { color: var(--ink); }

  /*
   * Above the tree and outside its scroll, so the controls stay put while it
   * moves, and stacked over it so the labels they drop below are not covered.
   */
  .structure-bar {
    position: relative;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 4px;
  }
  .structure-bar button { position: relative; }
  .structure-bar .tab-label {
    --label-shift: translateY(0);
    left: 0;
    top: calc(100% + 6px);
    transform-origin: top left;
  }
  /*
   * The bar's buttons answer the pointer as the Hide toggle does: a filled
   * pill, the ink brightening. At rest the JS filter is the badge alone —
   * grey while off, the accent while on, like every other toggle in the
   * panel — and its box shows only under the pointer.
   */
  .structure-bar .icon-btn,
  .structure-bar .js-toggle {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--ink-mute);
  }
  .structure-bar .icon-btn:hover,
  .structure-bar .js-toggle:hover { background: var(--bg-sunk); color: var(--ink); }
  .structure-bar .js-toggle[aria-pressed='true'] { color: var(--accent); }
  .structure-count {
    margin-left: auto;
    padding-left: 6px;
    white-space: nowrap;
    font-size: 10.5px;
    color: var(--ink-mute);
    font-variant-numeric: tabular-nums;
  }

  .structure-note {
    margin: 4px 8px;
    font-family: var(--sans);
    font-size: 11px;
    color: var(--warn);
  }

  /* ---------- rail ---------- */

  /*
   * Always on the outer edge of the panel, whichever side it is docked to,
   * so the sections sit where the eye expects a tool palette.
   */
  .rail {
    position: relative;
    z-index: 2;
    flex: none;
    width: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    /* As far from the top and bottom as from the sides: (39 - 30) / 2. */
    padding: 4.5px 0;
    background: var(--bg-raised);
    border-right: 1px solid var(--rule);
  }
  /* Its empty space is the panel's handle; the buttons on it stay buttons. */
  .panel:not([data-side='embedded']) .rail { cursor: grab; touch-action: none; }
  .panel[data-dragging='true'] .rail { cursor: grabbing; }

  .tabs { display: flex; flex-direction: column; gap: 3px; }

  .tab {
    position: relative;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 7px;
    color: var(--ink-mute);
  }
  .tab:hover { color: var(--ink); background: var(--bg-sunk); }
  .tab[aria-selected='true'] {
    color: var(--accent);
    background: var(--bg);
    box-shadow: 0 0 0 1px var(--rule), 0 1px 2px rgba(0, 0, 0, 0.12);
  }

  /*
   * The tab's name, as a label that shows on hover and on keyboard focus.
   *
   * Real text in the button rather than a title attribute: a title takes a
   * second to appear and never appears for keyboard users at all.
   */
  .tab-label {
    /* Where the label sits against its button; the tree's bar puts it below. */
    --label-shift: translateY(-50%);
    position: absolute;
    left: calc(100% + 8px);
    top: 50%;
    /* Grows out of the button it names, not from its own middle. */
    transform-origin: left center;
    transform: var(--label-shift) scale(0.97);
    padding: 3px 7px;
    border-radius: 5px;
    background: var(--ink);
    color: var(--bg);
    font-size: 11px;
    font-weight: 500;
    line-height: 1.3;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    /*
     * Timing comes from the button, so hovering can slow the way in without
     * slowing the way out: a label leaves in 100ms, straight away.
     */
    transition:
      opacity var(--label-duration, 100ms) var(--ease-out) var(--label-delay, 0s),
      transform var(--label-duration, 100ms) var(--ease-out) var(--label-delay, 0s);
  }
  .tab:focus-visible .tab-label,
  .rail-foot .icon-btn:focus-visible .tab-label,
  .structure-bar button:focus-visible .tab-label,
  .copy-icon:focus-visible .tab-label { opacity: 1; transform: var(--label-shift); }
  /*
   * A short wait before the first label, so sweeping the pointer across the
   * rail does not flash every name on the way. Only where hover is real: a
   * tap would leave the label stuck on.
   */
  @media (hover: hover) and (pointer: fine) {
    .tab:hover,
    .rail-foot .icon-btn:hover,
    .structure-bar button:hover,
    .copy-icon:hover { --label-duration: 150ms; --label-delay: 150ms; }
    .tab:hover .tab-label,
    .rail-foot .icon-btn:hover .tab-label,
    .structure-bar button:hover .tab-label,
    .copy-icon:hover .tab-label { opacity: 1; transform: var(--label-shift); }
  }
  /*
   * At once: from the keyboard, which should never wait on an animation, and
   * once one label is up (Rail marks the rail warm), since by then the
   * pointer is plainly reading the names.
   */
  .rail:has(:focus-visible) .tab-label,
  .rail[data-warm='true'] .tab-label,
  .structure-bar:has(:focus-visible) .tab-label { transition: none; }
  /* Without motion the label still fades, but does not grow. */
  @media (prefers-reduced-motion: reduce) {
    .tab-label { transform: var(--label-shift); }
  }

  .rail-foot {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  /* Labelled the same way as the tabs above them, so it is positioned too. */
  .rail-foot .icon-btn { position: relative; width: 30px; height: 30px; border-radius: 7px; }

  /* ---------- body ---------- */

  .body {
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px 10px 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .group { display: flex; flex-direction: column; gap: 4px; }

  /* A hairline between groups does the separating the heading rules used to. */
  .body > .group + .group {
    border-top: 1px solid var(--rule);
    padding-top: 12px;
  }

  /* Sentence case, the interface face, no rule: a label, not a banner. */
  .group-title {
    margin: 0 0 2px;
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 600;
    color: var(--ink-mute);
  }

  .summary {
    margin: 0 0 4px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ink);
  }

  /* ---------- rows ---------- */

  /*
   * A label and a value in a filled field, the way design tools lay out an
   * inspector. The field says "this is the value, and it is yours to change"
   * without a border on every line.
   */
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    align-items: center;
    gap: 6px;
    cursor: default;
  }

  /*
   * Inside the field's right end rather than in a column of its own, so every
   * field runs the full width. It sits on the field's own fill, so the value
   * under it is covered cleanly rather than showing through.
   */
  .row > .copy {
    position: absolute;
    top: 50%;
    right: 3px;
    transform: translateY(-50%);
    background: var(--bg-sunk);
  }
  .row > .copy:hover { background: var(--bg-raised); }

  /* Revert is always shown on an edited row, so it keeps a column of its own
     rather than permanently covering the end of the value it would restore. */
  .row:has(> .revert) { grid-template-columns: 76px minmax(0, 1fr) auto; }
  .row > .copy.revert {
    position: static;
    transform: none;
    background: transparent;
    /* Beats the hover-reveal below: an edit's way back is never hidden. */
    opacity: 1;
  }

  /* While a value is being typed, the field is the input; nothing sits on it. */
  .row:has(.edit-input) > .copy { display: none; }
  .row-value > .edit-input {
    width: calc(100% + 12px);
    height: 22px;
    margin: -2px -6px;
    padding: 0 5px;
    border-radius: 5px;
  }

  .row-label {
    font-size: 11px;
    color: var(--ink-mute);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-value {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 6px;
    min-width: 0;
    min-height: 22px;
    padding: 2px 6px;
    border-radius: 5px;
    background: var(--bg-sunk);
  }

  /* A token — a hex code, a length — never breaks inside itself: wrapping
     happens only at the spaces of a composite value like "1px solid #ccc",
     which is where a reader expects it. Genuinely long values (URLs, font
     stacks) opt into breaking anywhere. */
  .row-value > span,
  .row-value > .editable > span { white-space: normal; overflow-wrap: normal; }
  .row-value > span.wrap,
  .row-value > .editable > span.wrap { overflow-wrap: anywhere; }
  /*
   * The colour well stays on the value's line; the value beside it wraps its
   * own detail instead. Wrapping the whole group left a lone swatch on one
   * line and the hex on the next.
   */
  .row-value:has(> .color-well) { flex-wrap: nowrap; }
  .row-value > .editable { flex-wrap: wrap; row-gap: 0; }

  .row-detail {
    color: var(--ink-mute);
    font-size: 10.5px;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  /* A hairline at rest so it reads as a button rather than a stray word. */
  .copy {
    font-size: 10.5px;
    color: var(--ink-mute);
    padding: 1px 4px;
    border-radius: 6px;
    border-color: var(--rule);
  }
  /* Answers the pointer as the Hide toggle does, filled with the ink brightening, and firms its edge as Scan the page does. */
  .copy:hover { color: var(--ink); background: var(--bg-sunk); border-color: var(--rule-strong); }

  /*
   * Hover-to-reveal belongs to dense value rows and nowhere else.
   *
   * Scoping this to the .copy class alone hid every copy button in the panel,
   * including "copy for AI" — a control nobody can see is a feature that does
   * not exist.
   */
  .row .copy { opacity: 0; }
  .row:hover .copy, .row:focus-within .copy { opacity: 1; }
  /* Nothing to hover with: a reveal-on-hover control would never appear. */
  @media (hover: none) {
    .row .copy, .asset .copy { opacity: 1; }
  }
  .copy[data-copied='true'] { color: var(--good); opacity: 1; }

  /*
   * The clipboard form. Its label rises above it rather than out to the
   * side: in a row it would cover the value it copies, and below it a later
   * row, painted after, would cover the label. It lines up with the button's
   * right edge, since these buttons sit at the right of what they belong to:
   * centred, it reached past the panel's edge, and even hidden it counted
   * toward the width the body scrolls.
   */
  .copy-icon { position: relative; }
  /*
   * Square, and as tall as a text button beside it: that one is a line of
   * its text (1.5em) plus 1px of padding and 1px of border on each side.
   */
  .copy.copy-icon {
    display: inline-grid;
    place-items: center;
    width: calc(1.5em + 4px);
    height: calc(1.5em + 4px);
    padding: 0;
  }
  .copy-icon .tab-label {
    --label-shift: none;
    left: auto;
    right: 0;
    top: auto;
    bottom: calc(100% + 6px);
    transform-origin: bottom right;
  }

  /* ---------- footer ---------- */

  .foot {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px 6px 12px;
    border-top: 1px solid var(--rule);
    font-size: 10.5px;
  }

  .foot-name { color: var(--ink-mute); }

  .foot-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--ink-mute);
    text-decoration: none;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .foot-link:hover { color: var(--accent); background: var(--accent-wash); }
  .foot-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* ---------- sampling and auditing ---------- */

  .sample-btn {
    font-size: 11px;
    font-weight: 500;
    color: var(--ink);
    background: var(--bg-sunk);
    padding: 4px 10px;
    border-radius: 6px;
    /* The same faint edge as the copy buttons, firmed up on hover below. */
    border-color: var(--rule);
  }
  .sample-btn:hover { border-color: var(--rule-strong); }

  /*
   * One failing sample, as a row you can press.
   *
   * The ratio leads because it is the sort key and the thing being judged;
   * the severity stripe is on the ratio itself rather than the whole row, so
   * a list of forty findings does not become forty coloured bands.
   */
  .finding {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 5px 6px;
    border-radius: 6px;
    border: 1px solid transparent;
  }
  .finding:hover { background: var(--bg-sunk); }
  /* Says what pressing does, on the row about to be pressed. */
  .finding::after {
    content: 'Select';
    flex: none;
    font-size: 10.5px;
    color: var(--ink-mute);
    opacity: 0;
  }
  .finding:hover::after, .finding:focus-visible::after { opacity: 1; }

  .finding-ratio {
    flex: none;
    min-width: 46px;
    font-family: var(--mono);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    padding: 2px 5px;
    border-radius: 5px;
    text-align: center;
  }
  .finding[data-severity='critical'] .finding-ratio {
    background: color-mix(in srgb, var(--risk) 10%, transparent);
    color: var(--risk);
  }
  .finding[data-severity='serious'] .finding-ratio {
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    color: var(--warn);
  }
  .finding[data-severity='moderate'] .finding-ratio {
    background: var(--bg-sunk);
    color: var(--ink-soft);
  }

  .finding-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }

  .finding-label {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .finding-text {
    font-size: 10.5px;
    color: var(--ink-mute);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ---------- swatches ---------- */

  /*
   * Checkered behind the colour, so white and transparent both read.
   *
   * A plain white swatch on the light theme's white ground was a thin outline
   * around nothing, and a half-transparent one showed the panel rather than
   * itself. The chequer is what every colour tool uses, for this reason.
   */
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    flex: none;
    border: 1px solid var(--rule-strong);
    background-image:
      linear-gradient(45deg, #888 25%, transparent 25%, transparent 75%, #888 75%),
      linear-gradient(45deg, #888 25%, transparent 25%, transparent 75%, #888 75%);
    background-size: 6px 6px;
    background-position: 0 0, 3px 3px;
  }
  .swatch > span { display: block; width: 100%; height: 100%; border-radius: 1px; }

  .palette { display: flex; flex-wrap: wrap; gap: 4px; }

  .chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 7px 3px 4px;
    background: var(--bg-sunk);
    border: 1px solid transparent;
    border-radius: 5px;
    font-family: var(--mono);
    font-size: 10.5px;
    cursor: pointer;
    color: var(--ink);
  }
  .chip:hover { border-color: var(--rule-strong); }
  .chip .count { color: var(--ink-mute); font-size: 9.5px; }

  /* ---------- misc ---------- */

  .empty {
    margin: 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--ink-mute);
    padding: 2px 0;
    font-style: normal;
  }

  /* A pill on its own wash: the colour is the verdict, the fill just holds it. */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    border-radius: 99px;
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
  }
  .badge.pass { color: var(--good); background: color-mix(in srgb, var(--good) 13%, transparent); }
  .badge.fail { color: var(--risk); background: color-mix(in srgb, var(--risk) 12%, transparent); }
  .badge.unknown { color: var(--warn); background: color-mix(in srgb, var(--warn) 13%, transparent); }

  /* ---------- js ---------- */

  .js-list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .js-item { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .js-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
  .js-event { font-family: var(--mono); font-size: 11px; color: var(--ink); }
  .js-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--ink-soft);
  }
  .js-detail { font-family: var(--mono); font-size: 10px; color: var(--ink-mute); }
  .js-tag {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--bg-sunk);
    color: var(--ink-soft);
    font-size: 10px;
  }
  .js-actions { margin-left: auto; display: flex; gap: 2px; }
  /* A handler is usually a line or two; a code block's panel-filling height is for files. */
  .js-source { flex: none; min-height: 0; max-height: 180px; }
  /*
   * An open script is a file: it takes what the tab has left, the way
   * Markup's code does, through each box between it and the body. Never
   * less than its content, so a long list still scrolls as a list.
   */
  .body > .group:has(.js-more[open]),
  .group:has(.js-more[open]) > .js-list,
  .js-item:has(> .js-more[open]),
  .js-more[open] { flex: 1 0 auto; }
  /*
   * A details element keeps its content in a box of its own, past the
   * summary; that box has to grow too. Where the pseudo-element is unknown
   * the source keeps its minimum height.
   */
  .js-more[open],
  .js-more[open]::details-content { display: flex; flex-direction: column; }
  .js-more[open]::details-content { flex: 1 0 auto; }
  .js-more summary {
    width: max-content;
    font-size: 10.5px;
    color: var(--ink-mute);
    cursor: pointer;
    /* A toggle, not text: a quick double-click should not select the word. */
    user-select: none;
  }
  .js-more summary:hover { color: var(--ink); }
  .js-more[open] summary { margin-bottom: 4px; }
  .js-note { margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: var(--ink-mute); }

  /* ---------- scale ladder ---------- */

  /*
   * One grid for the whole ladder, its rows on a subgrid, so the names
   * column is as wide as the widest name in every row and each ruler ends
   * at the same place. Sized per row, they ended wherever that row's name did.
   */
  .scale {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr) auto 28px;
    gap: 2px 8px;
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
  }
  .scale-row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: center;
    min-height: 18px;
  }
  .scale-value {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--ink);
    text-align: right;
    white-space: nowrap;
  }
  .scale-count {
    font-family: var(--mono);
    font-size: 9.5px;
    color: var(--ink-mute);
    text-align: right;
  }
  .scale-sample {
    font-family: var(--sans);
    line-height: 1.15;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
  }
  /*
   * The ruler: a hairline at every base unit, at the bars' own doubled
   * scale, so a value on the scale ends exactly on one.
   */
  .scale-track {
    position: relative;
    height: 10px;
    overflow: hidden;
    border-radius: 2px;
    background: repeating-linear-gradient(
      90deg,
      var(--rule) 0 1px,
      transparent 1px var(--scale-tick, 8px)
    );
  }
  /* Neutral: a reading, not a change. Only the values off the grid take the accent. */
  .scale-bar {
    display: block;
    max-width: 100%;
    height: 100%;
    border-radius: 2px;
    background: var(--ink-soft);
  }
  .scale-row[data-off='true'] .scale-value { color: var(--accent); }
  .scale-row[data-off='true'] .scale-bar,
  .scale-legend .scale-key { background: var(--accent); }
  .scale-row[data-off='true'] .scale-sample { color: var(--accent); }
  .scale-legend {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--ink-mute);
  }
  .scale-key { width: 10px; height: 8px; border-radius: 2px; }

  /*
   * The variable names, each its own copy button. Capped so a long name
   * cannot squeeze the bar out of its row; the full name is in the title.
   */
  .scale-vars { display: flex; gap: 2px; max-width: 150px; min-width: 0; }
  .scale-vars .copy {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--ink-soft);
    background: var(--bg-sunk);
  }
  .scale-vars .copy:hover { color: var(--ink); }
  /* The Export tab's names are suggestions, not the page's: a quieter ink, and the legend says so. */
  .scale-vars[data-from='export'] .copy,
  .scale-key-name { color: var(--ink-mute); }
  .scale-key-name { font-family: var(--mono); font-size: 10px; }

  /* Read out, not shown: what color alone would otherwise have to say. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  /*
   * A code block is the point of the view it is in — Markup, Export, a
   * stylesheet's source — so it takes whatever height the panel has left
   * rather than stopping at a fixed one: its group grows into the body, and
   * the block grows inside its group. Past that it scrolls on its own. The
   * minimums keep it usable when the content above it is tall.
   */
  .body > .group:has(> pre),
  .body > .group:has(> .code-block),
  .body > .group:has(.svg-tool) { flex: 1 1 0; min-height: 180px; }

  /* ---------- svg tool ---------- */

  .svg-tool { display: flex; flex-direction: column; gap: 6px; flex: 1 1 0; min-height: 0; }
  .svg-size {
    margin: 0;
    font-size: 11px;
    color: var(--ink-mute);
    font-variant-numeric: tabular-nums;
  }
  /* A checkerboard behind the preview, so transparent parts read as transparent. */
  .svg-preview {
    display: block;
    height: 140px;
    padding: 8px;
    border-radius: 6px;
    background: repeating-conic-gradient(var(--bg-sunk) 0 25%, var(--bg-raised) 0 50%) 0 0 / 12px 12px;
  }
  /*
   * Sized to the box, not to the image: an SVG with only a viewBox has no
   * size of its own. The box is a block of fixed height so that 100% has
   * something definite to resolve against; in a grid row sized by its
   * content it fell back to the image's ratio and overflowed.
   */
  .svg-preview img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .svg-input {
    width: 100%;
    min-height: 120px;
    resize: vertical;
    padding: 8px 10px;
    font-family: var(--mono);
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--ink);
    background: var(--bg-sunk);
    border: 1px solid var(--rule-strong);
    border-radius: 6px;
    /* Wrapped like the code blocks; set here, not left to each engine's defaults. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .svg-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  /* Under an asset row: a bounded block, since the list goes on below it. */
  .asset-svg { padding: 4px 0 10px; }
  .asset-svg .svg-tool pre { flex: none; max-height: 240px; }
  /* As tall as its code there, so the buttons in its corner sit at the code's end. */
  .asset-svg .svg-tool .code-block { flex: none; min-height: 0; }

  pre {
    flex: 1 1 0;
    min-height: 120px;
    margin: 0;
    padding: 8px 10px;
    background: var(--bg-sunk);
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 10.5px;
    line-height: 1.55;
    color: var(--ink-soft);
    overflow: auto;
    /*
     * Wrapped, so a long line reads without scrolling sideways in a narrow
     * panel. "anywhere" rather than "break-word": minified markup and path
     * data are one unbroken run, and only "anywhere" also lets the block's
     * own width shrink to the panel instead of the run stretching it.
     */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  pre + .empty,
  .code-block + .empty { margin-top: 4px; }

  /*
   * Prism's token types, folded into a few colors. Nested tokens carry their
   * own class, so an attribute inside a tag or a quote inside a string takes
   * its own color rather than the one around it.
   */
  .tok-comment, .tok-prolog, .tok-doctype, .tok-cdata,
  .tok-punctuation, .tok-operator { color: var(--ink-mute); }
  .tok-tag, .tok-keyword, .tok-atrule, .tok-rule, .tok-important { color: var(--syn-keyword); }
  .tok-attr-name, .tok-property, .tok-function { color: var(--syn-name); }
  .tok-string, .tok-attr-value, .tok-url, .tok-template-string, .tok-regex,
  .tok-char { color: var(--syn-string); }
  .tok-number, .tok-boolean, .tok-null, .tok-constant, .tok-entity { color: var(--syn-number); }
  .tok-selector, .tok-class-name, .tok-variable { color: var(--syn-selector); }

  /*
   * A block with its buttons in the top-right corner. The block keeps clear
   * of them on the right, so no wrapped line runs underneath: wider where
   * there are two, as in the SVG tool.
   */
  .code-block {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 120px;
  }
  .code-block pre { padding-right: 32px; }
  .code-block:has(.code-actions > :nth-child(2)) pre { padding-right: 54px; }
  .code-actions {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 2px;
  }
  .code-actions .copy { background: var(--bg-sunk); }
  .code-actions .copy:hover { background: var(--bg-raised); }

  .export-actions { display: flex; flex-wrap: wrap; gap: 4px; }

  .export-actions button {
    font-size: 11px;
    color: var(--ink-soft);
    background: var(--bg-sunk);
    padding: 3px 9px;
  }
  .export-actions button:hover { color: var(--ink); }
  /* Chosen, not changed: the same tint as every other pressed toggle. */
  .export-actions button[aria-pressed='true'] {
    color: var(--accent);
    background: var(--accent-wash);
    font-weight: 600;
  }

  /* Read like source: a raised block, selector on top, no box inside a box. */
  .rule-block {
    border-radius: 6px;
    background: var(--bg-raised);
    overflow: hidden;
  }
  .rule-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px 2px;
    font-family: var(--mono);
    font-size: 10.5px;
  }
  .rule-selector { color: var(--accent); word-break: break-all; }
  .rule-source { color: var(--ink-mute); flex: none; font-size: 9.5px; }
  .decls { padding: 2px 8px 7px 18px; display: flex; flex-direction: column; gap: 2px; }
  .decl {
    font-family: var(--mono);
    font-size: 10.5px;
    display: flex;
    gap: 6px;
  }
  .decl .prop { color: var(--ink-soft); }
  .decl .val { color: var(--ink); }
  .decl[data-winning='false'] { text-decoration: line-through; color: var(--ink-mute); }
  .decl[data-winning='false'] .prop,
  .decl[data-winning='false'] .val { color: var(--ink-mute); }
`;
