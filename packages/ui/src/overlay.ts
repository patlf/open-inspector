import type { BoxModel, EdgeSizes, ProbeBoundary, Rect } from '@open-inspector/core';
import { isEmptyRect } from '@open-inspector/core';
import { placeChip } from './chip-placement.js';
import { OVERLAY_STYLES } from './overlay-styles.js';

/** Custom tag name so no page stylesheet targeting `div` can reach the host. */
const HOST_TAG = 'open-inspector-overlay';

/**
 * One below the panel's layer.
 *
 * The panel is an interactive surface the user reads and types into; the
 * overlay is a translucent wash that can cover the whole viewport when a
 * full-width element is selected. At equal z-index the winner is decided by
 * DOM order, which is both invisible and wrong half the time.
 */
const OVERLAY_Z_INDEX = '2147483646';

export interface OverlayTarget {
  box: BoxModel;
  selectorLabel: string;
  dimensions: string;
  boundary?: ProbeBoundary | null;
}

export interface Overlay {
  /** Draw the box-model layers and label for a target. */
  show(target: OverlayTarget): void;
  /** Hide everything without tearing down the host. */
  hide(): void;
  /** True if the element is part of this overlay. */
  owns(element: Element): boolean;
  /** Remove the overlay from the page entirely. */
  destroy(): void;
}

type LayerName = 'margin' | 'border' | 'padding' | 'content';

const LAYER_ORDER: readonly LayerName[] = ['margin', 'border', 'padding', 'content'];

/**
 * Pin down the host element's own geometry with `!important`.
 *
 * `all: initial` in the shadow stylesheet resets inherited properties, but the
 * host itself is still targetable by page CSS — a rule like
 * `body * { position: static !important }` is rare but real, and would drop the
 * overlay into the document flow. Inline `!important` is the only thing that
 * reliably wins.
 */
function lockHostGeometry(host: HTMLElement): void {
  const rules: Record<string, string> = {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    padding: '0',
    border: '0',
    display: 'block',
    'pointer-events': 'none',
    'z-index': OVERLAY_Z_INDEX,
    // Stops the page's stacking contexts and filters from affecting us.
    isolation: 'isolate',
    filter: 'none',
    transform: 'none',
    opacity: '1',
    visibility: 'visible',
  };

  for (const [property, value] of Object.entries(rules)) {
    host.style.setProperty(property, value, 'important');
  }
}

function applyStyles(shadow: ShadowRoot): void {
  // Constructed stylesheets avoid a <style> node and parse once. Supported in
  // every browser we target, but the fallback costs three lines.
  if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(OVERLAY_STYLES);
    shadow.adoptedStyleSheets = [sheet];
    return;
  }

  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;
  shadow.appendChild(style);
}

function place(layer: HTMLElement, rect: Rect): void {
  layer.style.left = `${rect.x}px`;
  layer.style.top = `${rect.y}px`;
  layer.style.width = `${rect.width}px`;
  layer.style.height = `${rect.height}px`;
}

/** The innermost region: a plain filled rectangle. */
function positionFill(layer: HTMLElement, rect: Rect): void {
  if (isEmptyRect(rect)) {
    layer.dataset['visible'] = 'false';
    return;
  }

  layer.dataset['visible'] = 'true';
  place(layer, rect);
}

/**
 * Draw one region as a ring between two nested boxes.
 *
 * The layer is placed on the outer rectangle and its border-width set to the
 * region's edge sizes; with `box-sizing: border-box` the border occupies
 * exactly the band between outer and inner. Filling the whole outer rectangle
 * instead would stack four translucent layers over the content and hide the
 * very thing being inspected.
 *
 * A region whose edges are all zero paints nothing, which is the honest
 * rendering of "this element has no margin".
 */
function positionRing(layer: HTMLElement, outer: Rect, edges: EdgeSizes): void {
  const hasBand = edges.top > 0 || edges.right > 0 || edges.bottom > 0 || edges.left > 0;

  if (isEmptyRect(outer) || !hasBand) {
    layer.dataset['visible'] = 'false';
    return;
  }

  layer.dataset['visible'] = 'true';
  place(layer, outer);
  layer.style.borderTopWidth = `${edges.top}px`;
  layer.style.borderRightWidth = `${edges.right}px`;
  layer.style.borderBottomWidth = `${edges.bottom}px`;
  layer.style.borderLeftWidth = `${edges.left}px`;
}

function boundaryNote(boundary: ProbeBoundary | null | undefined): string {
  if (!boundary) return '';

  switch (boundary.kind) {
    case 'iframe':
      return boundary.sameOrigin ? 'iframe' : 'iframe · cross-origin';
    case 'opaque-custom-element':
      return 'closed shadow root?';
    case 'canvas':
      return 'canvas · no DOM inside';
  }
}

/**
 * Create the inspection overlay.
 *
 * The shadow root is **closed**: page scripts cannot reach into it, which
 * matters because the overlay renders into pages we do not control. The host
 * is a custom tag with `pointer-events: none`, so it is invisible to the page's
 * own hit-testing as well as to ours.
 */
export function createOverlay(doc: Document = document): Overlay {
  const host = doc.createElement(HOST_TAG);
  host.setAttribute('aria-hidden', 'true');
  lockHostGeometry(host as HTMLElement);

  const shadow = host.attachShadow({ mode: 'closed' });
  applyStyles(shadow);

  const layers = new Map<LayerName, HTMLElement>();
  for (const name of LAYER_ORDER) {
    const layer = doc.createElement('div');
    layer.className = `layer ${name}`;
    layer.dataset['visible'] = 'false';
    shadow.appendChild(layer);
    layers.set(name, layer);
  }

  const chip = doc.createElement('div');
  chip.className = 'chip';
  chip.dataset['visible'] = 'false';

  const selectorEl = doc.createElement('span');
  selectorEl.className = 'selector';
  const dimensionsEl = doc.createElement('span');
  dimensionsEl.className = 'dimensions';
  const boundaryEl = doc.createElement('span');
  boundaryEl.className = 'boundary';

  chip.append(selectorEl, dimensionsEl, boundaryEl);
  shadow.appendChild(chip);

  let attached = false;

  function attach(): void {
    // Single-page apps replace large subtrees; re-check rather than assume the
    // host survived since the last hover.
    if (!attached || !host.isConnected) {
      doc.documentElement.appendChild(host);
      attached = true;
    }
  }

  return {
    show(target) {
      attach();

      const { box } = target;
      const margin = layers.get('margin');
      const border = layers.get('border');
      const padding = layers.get('padding');
      const content = layers.get('content');

      // Each ring spans from its own box inward to the next one.
      if (margin) positionRing(margin, box.margin, box.edges.margin);
      if (border) positionRing(border, box.border, box.edges.border);
      if (padding) positionRing(padding, box.padding, box.edges.padding);
      if (content) positionFill(content, box.content);

      selectorEl.textContent = target.selectorLabel;
      dimensionsEl.textContent = target.dimensions;

      const note = boundaryNote(target.boundary);
      boundaryEl.textContent = note;
      boundaryEl.style.display = note ? 'inline' : 'none';

      // Make the chip measurable before asking where it fits.
      chip.dataset['visible'] = 'true';
      chip.style.left = '0px';
      chip.style.top = '0px';

      const chipRect = chip.getBoundingClientRect();
      const placement = placeChip(
        target.box.margin,
        { width: chipRect.width, height: chipRect.height },
        { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight },
      );

      chip.style.left = `${placement.x}px`;
      chip.style.top = `${placement.y}px`;
    },

    hide() {
      for (const layer of layers.values()) layer.dataset['visible'] = 'false';
      chip.dataset['visible'] = 'false';
    },

    owns(element) {
      // The shadow root is closed, so the host is the only part of this
      // overlay the outside world can ever see.
      return element === host;
    },

    destroy() {
      host.remove();
      attached = false;
    },
  };
}
