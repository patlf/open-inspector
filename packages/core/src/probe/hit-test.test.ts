import { describe, expect, it, vi } from 'vitest';
import { createHitTester } from './hit-test.js';

function fakeRoot(init: {
  elementFromPoint?: (x: number, y: number) => Element | null;
  elementsFromPoint?: (x: number, y: number) => Element[];
}): DocumentOrShadowRoot {
  return init as unknown as DocumentOrShadowRoot;
}

describe('createHitTester', () => {
  it('delegates to elementFromPoint when nothing is ignored', () => {
    const target = document.createElement('div');
    const elementFromPoint = vi.fn(() => target as Element | null);

    const hit = createHitTester()(fakeRoot({ elementFromPoint }), 12, 34);

    expect(hit).toBe(target);
    expect(elementFromPoint).toHaveBeenCalledWith(12, 34);
  });

  it('skips ignored elements and returns the first one underneath', () => {
    const overlay = document.createElement('div');
    overlay.id = 'open-inspector-overlay';
    const real = document.createElement('p');

    const hit = createHitTester({ ignore: (el) => el === overlay })(
      fakeRoot({ elementsFromPoint: () => [overlay, real] }),
      0,
      0,
    );

    expect(hit).toBe(real);
  });

  it('returns null when every candidate is ignored', () => {
    const overlay = document.createElement('div');

    const hit = createHitTester({ ignore: () => true })(
      fakeRoot({ elementsFromPoint: () => [overlay] }),
      0,
      0,
    );

    expect(hit).toBeNull();
  });

  it('returns null when the root cannot hit-test at all', () => {
    // Detached shadow roots and some non-browser DOMs lack these methods
    // entirely; the probe must degrade rather than throw.
    expect(createHitTester()(fakeRoot({}), 0, 0)).toBeNull();
  });
});
