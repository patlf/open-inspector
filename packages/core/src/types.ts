/**
 * Shared shapes for the inspection engine.
 *
 * Nothing in this package may import extension APIs (`chrome.*`, `browser.*`)
 * or perform network access. The engine takes a DOM and returns data; that
 * constraint is what makes it testable outside a browser extension and is
 * enforced in CI by `scripts/check-zero-egress.mjs`.
 */

/** A plain, serializable rectangle in viewport coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-side sizes, in CSS pixels. */
export interface EdgeSizes {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The four nested rectangles of the CSS box model, plus the edges between them. */
export interface BoxModel {
  margin: Rect;
  border: Rect;
  padding: Rect;
  content: Rect;
  edges: {
    margin: EdgeSizes;
    border: EdgeSizes;
    padding: EdgeSizes;
  };
}

/** A short human-readable identification of an element. */
export interface ElementDescriptor {
  tagName: string;
  id: string | null;
  classNames: string[];
  /** e.g. `div#hero.container.is-dark` */
  selectorLabel: string;
  width: number;
  height: number;
}

/**
 * Something the probe cannot see through.
 *
 * These are reported rather than silently ignored. Returning a confidently
 * wrong answer at a boundary is worse than saying "I can't read this".
 */
export type ProbeBoundary =
  | {
      kind: 'iframe';
      /** Whether this frame's document is reachable from the current frame. */
      sameOrigin: boolean;
    }
  | {
      /**
       * A custom element with no reachable shadow root and no light-DOM
       * children. A closed shadow root is indistinguishable from "no shadow
       * root at all" by design, so this is a heuristic, not a detection.
       */
      kind: 'opaque-custom-element';
    }
  | {
      /** Canvas and WebGL surfaces have no inspectable DOM inside them. */
      kind: 'canvas';
    };

/** The outcome of resolving what sits under a viewport coordinate. */
export interface ProbeResult {
  /** The deepest element the probe could reach. */
  element: Element;
  /**
   * Resolution chain from the topmost hit in the main document down to
   * `element`. Entries after the first are shadow-tree descendants.
   */
  path: Element[];
  /** How many shadow roots were crossed to reach `element`. */
  shadowDepth: number;
  /** Non-null when resolution stopped at something opaque. */
  boundary: ProbeBoundary | null;
}
