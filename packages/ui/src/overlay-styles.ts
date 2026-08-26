/**
 * Styles for the overlay's shadow tree.
 *
 * Colours follow the browser box-model convention — orange margin, yellow
 * border, green padding, blue content — because that mapping is already in
 * every web developer's muscle memory. Inventing a new one would be a
 * gratuitous thing to make people learn.
 *
 * There are no transitions anywhere in here. An overlay that eases into
 * position smears behind the cursor and reads as lag; instantaneous is both
 * correct and, incidentally, free of any reduced-motion concern.
 */
export const OVERLAY_STYLES = `
  :host {
    all: initial;
  }

  .layer {
    position: absolute;
    box-sizing: border-box;
    pointer-events: none;
    display: none;
    background: transparent;
    border-style: solid;
    border-color: transparent;
    border-width: 0;
  }

  .layer[data-visible='true'] {
    display: block;
  }

  /*
   * The three outer regions are drawn as RINGS, using each element's own
   * border box: the layer sits on the outer rectangle and its border-width is
   * set to that region's edge sizes, so it paints only the band between the
   * two boxes.
   *
   * Filled rectangles would be simpler and wrong. The four boxes are nested,
   * so filling all of them stacks four translucent layers over the content
   * area — 0.42, 0.45, 0.45 and 0.52 composite to 92% opaque, and the page
   * underneath becomes unreadable exactly where you are trying to look.
   */
  .margin  { border-color: rgba(246, 178, 107, 0.38); }
  .border  { border-color: rgba(253, 224, 71, 0.42); }
  .padding { border-color: rgba(147, 196, 125, 0.38); }

  /*
   * The content fill is deliberately faint.
   *
   * Its job is to show where the content box ends, not to colour the element
   * in. Anything heavier tints the text you are trying to read — and reading
   * the element is the entire point of pointing at it. The 1px outline below
   * does the work of delineating the box, so the fill does not have to.
   */
  .content {
    background: rgba(111, 168, 220, 0.16);
    outline: 1px solid rgba(59, 130, 200, 0.55);
    outline-offset: -1px;
  }

  .chip {
    position: absolute;
    display: none;
    align-items: baseline;
    gap: 8px;
    max-width: 60vw;
    padding: 4px 8px;
    border-radius: 3px;
    background: #14181c;
    color: #e6eaec;
    font-family: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.45;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  }

  .chip[data-visible='true'] {
    display: flex;
  }

  .chip .selector {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip .dimensions {
    color: #e4743f;
    font-variant-numeric: tabular-nums;
    flex: none;
  }

  .chip .boundary {
    color: #c79b4a;
    flex: none;
  }
`;
