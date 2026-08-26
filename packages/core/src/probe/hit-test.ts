/**
 * Hit-testing is isolated behind this interface so the traversal logic can be
 * exercised in tests with a fake tree. No DOM implementation outside a real
 * browser performs faithful hit-testing, and traversal is exactly the part
 * that needs coverage.
 */
export type HitTester = (root: DocumentOrShadowRoot, x: number, y: number) => Element | null;

export interface HitTestOptions {
  /**
   * Elements to look straight through — our own overlay, chiefly.
   *
   * The overlay already sets `pointer-events: none`, so this is defence in
   * depth for anything that renders into the page and must not be inspectable.
   */
  ignore?: (element: Element) => boolean;
}

/** Build a hit tester backed by the real `elementFromPoint` APIs. */
export function createHitTester(options: HitTestOptions = {}): HitTester {
  const { ignore } = options;

  return (root, x, y) => {
    if (ignore && typeof root.elementsFromPoint === 'function') {
      for (const candidate of root.elementsFromPoint(x, y)) {
        if (!ignore(candidate)) return candidate;
      }
      return null;
    }

    if (typeof root.elementFromPoint !== 'function') return null;
    return root.elementFromPoint(x, y);
  };
}
