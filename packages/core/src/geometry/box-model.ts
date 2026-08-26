import type { BoxModel, EdgeSizes, Rect } from '../types.js';
import { insetRect, outsetRect, parsePx, toRect } from './rect.js';

/** The three sets of edges that separate the four box-model rectangles. */
export interface BoxEdges {
  margin: EdgeSizes;
  border: EdgeSizes;
  padding: EdgeSizes;
}

/**
 * Read the box edges off a computed style declaration.
 *
 * Split out from {@link readBoxModel} so the arithmetic can be tested without a
 * layout engine — no DOM implementation outside a real browser computes
 * `getBoundingClientRect` faithfully.
 */
export function readEdgeSizes(style: CSSStyleDeclaration): BoxEdges {
  return {
    margin: {
      top: parsePx(style.marginTop),
      right: parsePx(style.marginRight),
      bottom: parsePx(style.marginBottom),
      left: parsePx(style.marginLeft),
    },
    border: {
      top: parsePx(style.borderTopWidth),
      right: parsePx(style.borderRightWidth),
      bottom: parsePx(style.borderBottomWidth),
      left: parsePx(style.borderLeftWidth),
    },
    padding: {
      top: parsePx(style.paddingTop),
      right: parsePx(style.paddingRight),
      bottom: parsePx(style.paddingBottom),
      left: parsePx(style.paddingLeft),
    },
  };
}

/**
 * Derive the four nested rectangles from the border box and the edges.
 *
 * `borderBox` is what `getBoundingClientRect` returns: the border box in
 * viewport coordinates, already including any transforms applied to the
 * element. That is deliberate — the overlay must sit where the element
 * visually is, not where an untransformed layout would put it.
 */
export function buildBoxModel(borderBox: Rect, edges: BoxEdges): BoxModel {
  const padding = insetRect(borderBox, edges.border);
  const content = insetRect(padding, edges.padding);
  const margin = outsetRect(borderBox, edges.margin);

  return { margin, border: borderBox, padding, content, edges };
}

/**
 * Measure an element's box model in viewport coordinates.
 *
 * Caveat worth knowing: under a CSS transform the returned rectangles describe
 * the element's on-screen bounding box, so the reported width will not match
 * the element's computed `width`. The overlay wants the former; a future
 * "authored value" panel will want the latter.
 */
export function readBoxModel(element: Element, view: Window = window): BoxModel {
  const style = view.getComputedStyle(element);
  const borderBox = toRect(element.getBoundingClientRect());
  return buildBoxModel(borderBox, readEdgeSizes(style));
}
