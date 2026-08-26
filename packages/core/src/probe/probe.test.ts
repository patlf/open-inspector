import { describe, expect, it, vi } from 'vitest';
import { probeAtPoint } from './probe.js';
import type { HitTester } from './hit-test.js';

function hitTesterFrom(mapping: Map<DocumentOrShadowRoot, Element | null>): HitTester {
  return (root) => mapping.get(root) ?? null;
}

describe('probeAtPoint', () => {
  it('returns null when the point hits nothing', () => {
    // Off-screen coordinates and empty regions both land here.
    const result = probeAtPoint(10, 10, { hitTest: () => null });

    expect(result).toBeNull();
  });

  it('resolves a plain element with no shadow depth and no boundary', () => {
    const target = document.createElement('p');

    const result = probeAtPoint(10, 10, { hitTest: () => target });

    expect(result?.element).toBe(target);
    expect(result?.path).toEqual([target]);
    expect(result?.shadowDepth).toBe(0);
    expect(result?.boundary).toBeNull();
  });

  it('reports depth after descending through shadow roots', () => {
    const inner = document.createElement('span');
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(inner);

    const mapping = new Map<DocumentOrShadowRoot, Element | null>([
      [document, host],
      [shadow, inner],
    ]);

    const result = probeAtPoint(10, 10, { hitTest: hitTesterFrom(mapping) });

    expect(result?.element).toBe(inner);
    expect(result?.shadowDepth).toBe(1);
    expect(result?.path).toEqual([host, inner]);
  });

  it('attaches a boundary when it lands on something opaque', () => {
    const canvas = document.createElement('canvas');

    const result = probeAtPoint(10, 10, { hitTest: () => canvas });

    expect(result?.boundary).toEqual({ kind: 'canvas' });
  });

  it('passes viewport coordinates through unchanged to every root', () => {
    // Shadow roots hit-test in the same viewport coordinate space as the
    // document, so the same pair must be forwarded untranslated. Getting this
    // wrong produces an off-by-scroll-offset bug that only shows up on long
    // pages.
    const inner = document.createElement('span');
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(inner);

    const hitTest = vi.fn<HitTester>((root) => (root === shadow ? inner : host));

    probeAtPoint(123, 456, { hitTest });

    for (const call of hitTest.mock.calls) {
      expect(call[1]).toBe(123);
      expect(call[2]).toBe(456);
    }
  });

  it('honours the shadow depth limit', () => {
    const a = document.createElement('div');
    const shadowA = a.attachShadow({ mode: 'open' });
    const b = document.createElement('div');
    const shadowB = b.attachShadow({ mode: 'open' });
    const c = document.createElement('div');
    shadowA.appendChild(b);
    shadowB.appendChild(c);

    const mapping = new Map<DocumentOrShadowRoot, Element | null>([
      [document, a],
      [shadowA, b],
      [shadowB, c],
    ]);

    const result = probeAtPoint(0, 0, {
      hitTest: hitTesterFrom(mapping),
      maxShadowDepth: 1,
    });

    expect(result?.element).toBe(b);
    expect(result?.shadowDepth).toBe(1);
  });

  it('skips ignored elements via the real hit tester', () => {
    const overlay = document.createElement('open-inspector-overlay');
    const real = document.createElement('p');

    const elementsFromPoint = vi.fn(() => [overlay, real]);
    const fakeDocument = { elementsFromPoint } as unknown as DocumentOrShadowRoot;

    const result = probeAtPoint(5, 5, {
      root: fakeDocument,
      ignore: (element) => element === overlay,
    });

    expect(result?.element).toBe(real);
  });
});
