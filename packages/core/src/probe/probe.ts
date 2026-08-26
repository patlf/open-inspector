import type { ProbeResult } from '../types.js';
import { createHitTester, type HitTester } from './hit-test.js';
import { detectBoundary } from './boundary.js';
import { MAX_SHADOW_DEPTH, pierceShadowRoots } from './pierce.js';

export interface ProbeOptions {
  /** Elements to look through. See {@link createHitTester}. */
  ignore?: (element: Element) => boolean;
  /** Tree to start from. Defaults to the current document. */
  root?: DocumentOrShadowRoot;
  /** Override hit-testing entirely. Used by tests. */
  hitTest?: HitTester;
  /** Shadow nesting limit. Defaults to {@link MAX_SHADOW_DEPTH}. */
  maxShadowDepth?: number;
}

/**
 * Resolve what sits under a viewport coordinate, piercing open shadow roots.
 *
 * Coordinates are viewport-relative (as from a `MouseEvent`'s `clientX` /
 * `clientY`), which is also the frame `elementFromPoint` works in — so the
 * same pair can be passed unchanged into every nested shadow root.
 *
 * Returns `null` when the point is outside the viewport or hits nothing.
 */
export function probeAtPoint(x: number, y: number, options: ProbeOptions = {}): ProbeResult | null {
  const root = options.root ?? document;
  const hitTest =
    options.hitTest ?? createHitTester(options.ignore ? { ignore: options.ignore } : {});

  const start = hitTest(root, x, y);
  if (!start) return null;

  const path = pierceShadowRoots(start, x, y, hitTest, options.maxShadowDepth ?? MAX_SHADOW_DEPTH);
  const element = path[path.length - 1] ?? start;

  return {
    element,
    path,
    shadowDepth: path.length - 1,
    boundary: detectBoundary(element),
  };
}
