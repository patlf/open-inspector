import type { HitTester } from './hit-test.js';

/**
 * Upper bound on shadow-root nesting we will follow.
 *
 * Deeply nested web components are real (design systems routinely nest three
 * or four levels), but an unbounded loop over an adversarial or cyclic tree is
 * not something a hover handler should ever risk.
 */
export const MAX_SHADOW_DEPTH = 32;

/**
 * Walk from an element down through any open shadow roots under the point.
 *
 * Returns the full chain, outermost first. When the element has no shadow root
 * — or has a *closed* one, which is indistinguishable from none — the chain is
 * just the starting element.
 */
export function pierceShadowRoots(
  start: Element,
  x: number,
  y: number,
  hitTest: HitTester,
  maxDepth: number = MAX_SHADOW_DEPTH,
): Element[] {
  const path: Element[] = [start];
  let current = start;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const shadowRoot = current.shadowRoot;
    if (!shadowRoot) break;

    const inner = hitTest(shadowRoot, x, y);

    // `null` means the point missed every shadow child; identity and
    // membership checks guard against a host that hit-tests back to itself,
    // which would otherwise spin until maxDepth.
    if (!inner || inner === current || path.includes(inner)) break;

    path.push(inner);
    current = inner;
  }

  return path;
}
