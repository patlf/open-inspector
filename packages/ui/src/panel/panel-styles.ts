/**
 * Styles for the panel's shadow tree.
 *
 * The panel floats over pages we do not control, so it commits to its own
 * visual world rather than trying to blend in: a compact instrument, dark by
 * default because that is the convention for developer tools and because a
 * light panel glares over most sites. It follows the viewer's colour-scheme
 * preference, since designers frequently work in light.
 *
 * Everything is scoped by the shadow boundary, so class names can be short and
 * no selector needs defensive specificity.
 */
export const PANEL_STYLES = `
  :host {
    all: initial;
  }

  * { box-sizing: border-box; }

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
    /* Text on an accent fill. See the note in the light block. */
    --on-accent: #14181c;
    --accent: #e4743f;
    --accent-wash: rgba(228, 116, 63, 0.14);
    --good: #6aab84;
    --warn: #c79b4a;
    --risk: #d9705f;
    --mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
    --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

    position: fixed;
    top: 12px;
    right: 12px;
    bottom: 12px;
    width: 348px;
    max-width: calc(100vw - 24px);
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--ink);
    border: 1px solid var(--rule);
    border-radius: 6px;
    box-shadow: 0 16px 48px -12px rgba(0, 0, 0, 0.65), 0 2px 8px rgba(0, 0, 0, 0.4);
    font-family: var(--sans);
    font-size: 12px;
    line-height: 1.5;
    pointer-events: auto;
    overflow: hidden;
  }

  @media (prefers-color-scheme: light) {
    .panel {
      --bg: #ffffff;
      --bg-raised: #f4f6f7;
      --bg-sunk: #eaedef;
      --ink: #14181c;
      --ink-soft: #3d474e;
      --ink-mute: #646d73;
      --rule: #d5dbde;
      --rule-strong: #8b8f91;
      /*
       * White reads on the light accent (5.37:1) but only 3.06:1 on the dark
       * one, which is why the most prominent control in the panel — the
       * Inspect button — was the least legible thing in it after dark. The
       * dark theme puts near-black on the orange instead, at 5.83:1.
       */
      --on-accent: #ffffff;
      --accent: #b8451f;
      --accent-wash: rgba(184, 69, 31, 0.10);
      --good: #3f7d58;
      --warn: #97671b;
      --risk: #a8352b;
      box-shadow: 0 16px 48px -18px rgba(20, 24, 28, 0.4), 0 1px 3px rgba(20, 24, 28, 0.16);
    }
  }

  .panel[data-side='left'] { right: auto; left: 12px; }

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
    letter-spacing: 0.14em;
    font-size: 9px;
    text-transform: uppercase;
    border: 1px solid #2b343a;
    border-right: 0;
    border-radius: 5px 0 0 5px;
    background: #14181c;
    color: #b3bcc2;
    font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    cursor: pointer;
    pointer-events: auto;
    box-shadow: -4px 0 16px -6px rgba(0, 0, 0, 0.6);
  }
  .panel-tab[data-side='left'] {
    right: auto;
    left: 0;
    border: 1px solid #2b343a;
    border-left: 0;
    border-radius: 0 5px 5px 0;
    box-shadow: 4px 0 16px -6px rgba(0, 0, 0, 0.6);
  }
  .panel-tab:hover { color: #e4743f; }

  @media (prefers-color-scheme: light) {
    .panel-tab {
      background: #ffffff;
      color: #3d474e;
      border-color: #d5dbde;
    }
    .panel-tab:hover { color: #b8451f; }
  }

  /* ---------- toolbar ---------- */

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px 0;
  }

  /*
   * Two rows, because they are not the same kind of control.
   *
   * The filter acts on the panel, hide acts on the selected element, and the
   * presets act on the browser window. Three scopes crowded into one strip
   * read as a row of unrelated buttons — and left no room to label the one
   * that was only an icon.
   */
  .toolbar-page { padding: 4px 10px 8px; }

  .toolbar-label {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-mute);
    flex: none;
  }

  .hide-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }
  .btn-label {
    font-family: var(--mono);
    font-size: 9.5px;
  }

  .search {
    flex: 1;
    min-width: 0;
    height: 22px;
    padding: 0 7px;
    border: 1px solid var(--rule-strong);
    border-radius: 4px;
    background: var(--bg-sunk);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 11px;
  }
  .search::placeholder { color: var(--ink-mute); }
  .search:focus { outline: none; border-color: var(--accent); }
  .search::-webkit-search-cancel-button { filter: grayscale(1) opacity(0.6); }

  /*
   * Presets, not a free-form number box. The widths that matter are few and
   * known, and typing one is slower than clicking it.
   */
  .viewport {
    display: inline-flex;
    border: 1px solid var(--rule-strong);
    border-radius: 4px;
    overflow: hidden;
    background: var(--bg-sunk);
  }
  .viewport-btn {
    padding: 0 5px;
    height: 20px;
    border: 0;
    border-right: 1px solid var(--rule);
    background: transparent;
    color: var(--ink-soft);
    font-family: var(--mono);
    font-size: 9.5px;
    line-height: 20px;
    cursor: pointer;
  }
  .viewport-btn:last-child { border-right: 0; }
  .viewport-btn:hover { color: var(--ink); }
  /*
   * Filled when active, matching the force-state chips.
   *
   * The accent-on-wash treatment it had measured 3.99:1, and it also read as
   * merely tinted next to a chip that fills solid — two controls with the same
   * on/off meaning should not signal it two different ways.
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
    background: var(--bg-raised);
    color: var(--ink);
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
    border-left: 1px solid var(--rule);
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

  /* ---------- header ---------- */

  .head {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--rule);
    flex: none;
  }

  .head-top { display: flex; align-items: center; gap: 8px; }

  .selector {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--accent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }

  /*
   * Pushed right, on the row that describes the element.
   *
   * It used to sit in the title row between the selector and the buttons,
   * where it and an 88px button squeezed the selector — the single most
   * important label in the panel — down to about ten characters.
   */
  .dims {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--ink-mute);
    font-variant-numeric: tabular-nums;
    flex: none;
  }

  .head-actions { display: flex; gap: 4px; flex: none; }

  button {
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
    padding: 3px 6px;
  }

  button:hover { background: var(--bg-sunk); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  .icon-btn {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-mute);
    line-height: 1;
  }
  .icon-btn[aria-pressed='true'] { color: var(--accent); border-color: var(--rule); }

  /*
   * Always filled, always the most prominent thing in the header. The state
   * is carried by the trailing word and a dot, not by making the button
   * disappear into the chrome when it is off — a control nobody can find is
   * worse than one that is always slightly loud.
   */
  .primary-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    padding: 4px 8px;
    border-radius: 3px;
    white-space: nowrap;
    background: var(--accent);
    border: 1px solid var(--accent);
    color: var(--on-accent);
  }

  .primary-btn:hover { filter: brightness(1.08); background: var(--accent); }

  .primary-btn .state {
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding-left: 5px;
    border-left: 1px solid currentColor;
    /* Separated by a rule, not by being faded — fading it cost 1.5:1. */
    opacity: 0.75;
  }

  /* Held: the picker is paused, so drop to an outline. */
  .primary-btn[aria-pressed='false'] {
    background: transparent;
    color: var(--accent);
  }
  .primary-btn[aria-pressed='false']:hover { background: var(--accent-wash); }
  .primary-btn[aria-pressed='false'] .state { border-left-color: var(--accent); }
  /* The separator may fade; the label may not. */
  .primary-btn .state { opacity: 1; }
  .primary-btn .state { border-left-color: color-mix(in srgb, currentColor 40%, transparent); }

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
    color: var(--ink-mute);
    border-color: var(--rule);
    padding: 3px 7px;
  }
  .state-toggle[aria-pressed='true'] {
    color: var(--bg);
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
  .asset:hover { background: var(--bg-raised); }

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
    border: 1px solid var(--rule);
    border-radius: 3px;
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
    font-size: 8px;
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
    font-size: 9.5px;
    color: var(--ink-mute);
    font-variant-numeric: tabular-nums;
  }

  .asset-actions { display: flex; gap: 2px; }
  .asset .copy { opacity: 0; }
  .asset:hover .copy, .asset .copy:focus-visible { opacity: 1; }

  /* ---------- changes list ---------- */

  .change-block {
    border: 1px solid var(--rule);
    border-radius: 4px;
    overflow: hidden;
  }

  .change-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 8px;
    background: var(--bg-raised);
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
    font-family: var(--mono);
    font-size: 10px;
    color: var(--warn);
    letter-spacing: 0.03em;
  }

  /* ---------- breadcrumb ---------- */

  .crumbs { display: flex; flex-direction: column; gap: 4px; }

  /*
   * Scrolls sideways rather than wrapping.
   *
   * A deep DOM produces a long path; wrapping it would push the tabs down the
   * panel every time the selection moved, which makes the whole header jump
   * around as you navigate.
   */
  .crumb-trail {
    display: flex;
    align-items: center;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
    padding-bottom: 1px;
  }
  .crumb-trail::-webkit-scrollbar { display: none; }

  .crumb-item { display: inline-flex; align-items: center; gap: 2px; flex: none; }
  .crumb-sep { color: var(--ink-mute); font-size: 10px; }

  .crumb {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--ink-mute);
    padding: 1px 4px;
    white-space: nowrap;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .crumb:hover { color: var(--ink); background: var(--bg-sunk); }
  .crumb[aria-current='true'] {
    color: var(--accent);
    cursor: default;
    background: transparent;
  }

  .crumb-steps { display: flex; align-items: center; gap: 2px; }

  .step {
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1;
    color: var(--ink-soft);
    border-color: var(--rule);
    padding: 2px 6px;
  }
  /*
   * Same reasoning as the state toggles. "No previous sibling" is information;
   * at 0.35 opacity the arrow measured 1.5:1 and simply looked broken.
   */
  .step:disabled { color: var(--ink-mute); border-style: dashed; cursor: not-allowed; }
  .step:disabled:hover { background: transparent; }

  .crumb-count {
    font-family: var(--mono);
    font-size: 9.5px;
    color: var(--ink-mute);
    margin-left: 4px;
    font-variant-numeric: tabular-nums;
  }

  /* ---------- tabs ---------- */

  .tabs {
    display: flex;
    gap: 0;
    padding: 0 6px;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--rule);
    flex: none;
    overflow-x: auto;
    scrollbar-width: none;
    /*
     * Seven tabs do not fit in 348px, so the strip scrolls. A tab sheared off
     * mid-word at the edge reads as a rendering bug; the mask fades the last
     * few pixels instead, which reads as "there is more this way".
     */
    mask-image: linear-gradient(to right, #000 calc(100% - 18px), transparent);
  }
  .tabs::-webkit-scrollbar { display: none; }

  .tab {
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-mute);
    padding: 7px 8px;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    white-space: nowrap;
  }
  .tab:hover { background: transparent; color: var(--ink-soft); }
  .tab[aria-selected='true'] { color: var(--ink); border-bottom-color: var(--accent); }

  /* ---------- body ---------- */

  .body {
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 10px 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .body::-webkit-scrollbar { width: 10px; }
  .body::-webkit-scrollbar-thumb {
    background: var(--rule);
    border-radius: 5px;
    border: 3px solid var(--bg);
  }

  .group { display: flex; flex-direction: column; gap: 5px; }

  .group-title {
    font-family: var(--mono);
    font-size: 9.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-mute);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .group-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--rule);
  }

  /* ---------- rows ---------- */

  .row {
    display: grid;
    grid-template-columns: 74px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 4px 8px;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: default;
  }
  .row:hover { background: var(--bg-raised); }

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
  }

  /* Values are single tokens — a hex code or a length. Breaking one across
     two lines makes it unreadable and un-copyable by eye, so wrap the whole
     token to the next line instead. Genuinely long values (URLs, shadow
     longhands) opt into breaking. */
  .row-value > span { white-space: nowrap; }
  .row-value > span.wrap { white-space: normal; overflow-wrap: anywhere; }

  .row-detail {
    color: var(--ink-mute);
    font-size: 10.5px;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .copy {
    font-family: var(--mono);
    font-size: 9.5px;
    color: var(--ink-mute);
    padding: 1px 4px;
  }

  /*
   * Hover-to-reveal belongs to dense value rows and nowhere else.
   *
   * Scoping this to the .copy class alone hid every copy button in the panel,
   * including "copy for AI" — a control nobody can see is a feature that does
   * not exist.
   */
  .row .copy { opacity: 0; }
  .row:hover .copy, .row .copy:focus-visible { opacity: 1; }
  /* Nothing to hover with: a reveal-on-hover control would never appear. */
  @media (hover: none) {
    .row .copy, .asset .copy { opacity: 1; }
  }
  .copy[data-copied='true'] { color: var(--good); opacity: 1; }

  /* ---------- footer ---------- */

  .foot {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    border-top: 1px solid var(--rule);
    background: var(--bg-raised);
    font-family: var(--mono);
    font-size: 9.5px;
    letter-spacing: 0.02em;
  }

  .foot-name { color: var(--ink-mute); }

  .foot-link {
    color: var(--ink-mute);
    text-decoration: none;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .foot-link:hover { color: var(--accent); background: var(--accent-wash); }
  .foot-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* ---------- sampling and auditing ---------- */

  .sample-btn {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.03em;
    color: var(--accent);
    border-color: var(--accent);
    padding: 4px 9px;
  }
  .sample-btn:hover { background: var(--accent-wash); }

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
    border-radius: 4px;
    border: 1px solid transparent;
  }
  .finding:hover { background: var(--bg-sunk); border-color: var(--rule); }

  .finding-ratio {
    flex: none;
    min-width: 46px;
    font-family: var(--mono);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    padding: 2px 5px;
    border-radius: 3px;
    text-align: center;
  }
  .finding[data-severity='critical'] .finding-ratio {
    background: color-mix(in srgb, var(--risk) 18%, transparent);
    color: var(--risk);
  }
  .finding[data-severity='serious'] .finding-ratio {
    background: color-mix(in srgb, var(--warn) 18%, transparent);
    color: var(--warn);
  }
  .finding[data-severity='moderate'] .finding-ratio {
    background: var(--bg-sunk);
    color: var(--ink-soft);
  }

  .finding-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }

  .finding-label {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--accent);
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
    background-image:
      linear-gradient(45deg, var(--sunk) 25%, transparent 25%),
      linear-gradient(-45deg, var(--sunk) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--sunk) 75%),
      linear-gradient(-45deg, transparent 75%, var(--sunk) 75%);
    background-size: 6px 6px;
    background-position: 0 0, 0 3px, 3px -3px, -3px 0;
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
    padding: 3px 6px 3px 4px;
    background: var(--bg-raised);
    border: 1px solid var(--rule);
    border-radius: 3px;
    font-family: var(--mono);
    font-size: 10.5px;
    cursor: pointer;
    color: var(--ink);
  }
  .chip:hover { border-color: var(--ink-mute); }
  .chip .count { color: var(--ink-mute); font-size: 9.5px; }

  /* ---------- misc ---------- */

  .empty {
    font-size: 11px;
    color: var(--ink-mute);
    padding: 10px 4px;
    font-style: normal;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 5px;
    border-radius: 2px;
    font-family: var(--mono);
    font-size: 9.5px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    border: 1px solid currentColor;
  }
  .badge.pass { color: var(--good); }
  .badge.fail { color: var(--risk); }
  .badge.unknown { color: var(--warn); }

  .meter {
    height: 4px;
    background: var(--bg-sunk);
    border-radius: 2px;
    overflow: hidden;
  }
  .meter > span { display: block; height: 100%; background: var(--accent); }

  pre {
    margin: 0;
    padding: 8px 10px;
    background: var(--bg-sunk);
    border: 1px solid var(--rule);
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 10.5px;
    line-height: 1.55;
    color: var(--ink-soft);
    overflow-x: auto;
    max-height: 260px;
    overflow-y: auto;
    white-space: pre;
  }

  .export-actions { display: flex; flex-wrap: wrap; gap: 4px; }

  .export-actions button {
    font-family: var(--mono);
    font-size: 10px;
    border-color: var(--rule);
    color: var(--ink-soft);
    padding: 4px 7px;
  }
  .export-actions button[aria-pressed='true'] {
    color: var(--bg);
    background: var(--accent);
    border-color: var(--accent);
  }

  .rule-block {
    border: 1px solid var(--rule);
    border-radius: 4px;
    overflow: hidden;
  }
  .rule-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 8px;
    background: var(--bg-raised);
    font-family: var(--mono);
    font-size: 10.5px;
  }
  .rule-selector { color: var(--accent); word-break: break-all; }
  .rule-source { color: var(--ink-mute); flex: none; font-size: 9.5px; }
  .decls { padding: 5px 8px; display: flex; flex-direction: column; gap: 2px; }
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
