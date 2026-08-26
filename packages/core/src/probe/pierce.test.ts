import { describe, expect, it } from 'vitest';
import { pierceShadowRoots } from './pierce.js';
import type { HitTester } from './hit-test.js';

/**
 * Hit-testing is faked here on purpose. No DOM implementation outside a real
 * browser does faithful hit-testing, and the traversal loop — not the
 * geometry — is what these tests are for. The shadow roots themselves are
 * real.
 */
function hitTesterFrom(mapping: Map<DocumentOrShadowRoot, Element | null>): HitTester {
  return (root) => mapping.get(root) ?? null;
}

function hostWithShadow(child: Element): { host: HTMLElement; shadow: ShadowRoot } {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.appendChild(child);
  return { host, shadow };
}

describe('pierceShadowRoots', () => {
  it('returns just the element when there is no shadow root', () => {
    const plain = document.createElement('p');
    const path = pierceShadowRoots(plain, 0, 0, hitTesterFrom(new Map()));

    expect(path).toEqual([plain]);
  });

  it('descends through a single open shadow root', () => {
    const inner = document.createElement('span');
    const { host, shadow } = hostWithShadow(inner);

    const path = pierceShadowRoots(host, 10, 10, hitTesterFrom(new Map([[shadow, inner]])));

    expect(path).toEqual([host, inner]);
  });

  it('descends through nested shadow roots', () => {
    const deepest = document.createElement('button');
    const middle = hostWithShadow(deepest);
    const outer = hostWithShadow(middle.host);

    const path = pierceShadowRoots(
      outer.host,
      10,
      10,
      hitTesterFrom(
        new Map<DocumentOrShadowRoot, Element | null>([
          [outer.shadow, middle.host],
          [middle.shadow, deepest],
        ]),
      ),
    );

    expect(path).toEqual([outer.host, middle.host, deepest]);
  });

  it('stops when the point misses every shadow child', () => {
    const inner = document.createElement('span');
    const { host, shadow } = hostWithShadow(inner);

    // Hit-test returns null: the point is over the host's own padding.
    const path = pierceShadowRoots(host, 0, 0, hitTesterFrom(new Map([[shadow, null]])));

    expect(path).toEqual([host]);
  });

  it('does not loop when a shadow root hit-tests back to its own host', () => {
    const inner = document.createElement('span');
    const { host, shadow } = hostWithShadow(inner);

    const path = pierceShadowRoots(host, 0, 0, hitTesterFrom(new Map([[shadow, host]])));

    expect(path).toEqual([host]);
  });

  it('does not revisit an element already in the path', () => {
    const a = document.createElement('div');
    const shadowA = a.attachShadow({ mode: 'open' });
    const b = document.createElement('div');
    const shadowB = b.attachShadow({ mode: 'open' });
    shadowA.appendChild(b);

    // A cycle: A's shadow yields B, B's shadow yields A again.
    const path = pierceShadowRoots(
      a,
      0,
      0,
      hitTesterFrom(
        new Map<DocumentOrShadowRoot, Element | null>([
          [shadowA, b],
          [shadowB, a],
        ]),
      ),
    );

    expect(path).toEqual([a, b]);
  });

  it('respects the depth limit', () => {
    // Build a chain deeper than the limit we pass in.
    const leaf = document.createElement('span');
    const mapping = new Map<DocumentOrShadowRoot, Element | null>();
    let current: HTMLElement = document.createElement('div');
    const root = current;

    for (let i = 0; i < 8; i += 1) {
      const next = document.createElement('div');
      const shadow = current.attachShadow({ mode: 'open' });
      shadow.appendChild(next);
      mapping.set(shadow, next);
      current = next;
    }
    current.appendChild(leaf);

    const path = pierceShadowRoots(root, 0, 0, hitTesterFrom(mapping), 3);

    expect(path).toHaveLength(4); // start + 3 levels
  });
});
