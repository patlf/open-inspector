import { describe, expect, it } from 'vitest';
import {
  collectFontSizes,
  inferTypeScale,
  inferTypeScaleForSubtree,
  isTextBearing,
  pickBaseSize,
  tallyFontSizes,
} from './scale.js';
import type { FontSizeUsage } from './scale.js';

/** Sizes with equal usage, so the base falls out of the tie-break rules. */
function evenly(...pxValues: number[]): FontSizeUsage[] {
  return pxValues.map((px) => ({ px, count: 1 }));
}

/** A view whose computed font size comes from a data attribute. */
function sizedView(): Window {
  return {
    getComputedStyle: (element: Element) => ({
      fontSize: element.getAttribute('data-size') ?? '16px',
    }),
  } as unknown as Window;
}

describe('tallyFontSizes', () => {
  it('counts distinct sizes in ascending order', () => {
    expect(tallyFontSizes([16, 24, 16, 16, 32])).toEqual([
      { px: 16, count: 3 },
      { px: 24, count: 1 },
      { px: 32, count: 1 },
    ]);
  });

  it('folds the float noise a zoomed page produces', () => {
    // One authored size measured at 110 % zoom lands on a spray of values; left
    // alone they would look like a dozen distinct steps.
    expect(tallyFontSizes([16.000001, 15.999998, 16])).toEqual([{ px: 16, count: 3 }]);
  });

  it('drops values that cannot be sizes', () => {
    expect(tallyFontSizes([0, -12, Number.NaN, Number.POSITIVE_INFINITY, 14])).toEqual([
      { px: 14, count: 1 },
    ]);
  });
});

describe('pickBaseSize', () => {
  it('anchors on the most-used size', () => {
    expect(
      pickBaseSize([
        { px: 14, count: 2 },
        { px: 18, count: 40 },
        { px: 32, count: 1 },
      ]),
    ).toBe(18);
  });

  it('breaks a tie toward the inherited 16px', () => {
    expect(pickBaseSize(evenly(13, 16, 48))).toBe(16);
  });

  it('breaks a remaining tie deterministically toward the smaller size', () => {
    expect(pickBaseSize(evenly(12, 20))).toBe(12);
  });

  it('has nothing to anchor on when there are no sizes', () => {
    expect(pickBaseSize([])).toBeNull();
  });
});

describe('inferTypeScale', () => {
  it('recognizes a clean major third', () => {
    const result = inferTypeScale(evenly(16, 20, 25, 31.25, 39.06));

    expect(result.kind).toBe('scale');
    if (result.kind !== 'scale') return;
    expect(result.match.ratio).toBe(1.25);
    expect(result.match.name).toBe('Major Third');
    expect(result.match.base).toBe(16);
    expect(result.match.conformance).toBe(100);
    expect(result.match.steps.map((step) => step.step)).toEqual([0, 1, 2, 3, 4]);
  });

  it('recognizes a scale whose sizes were rounded to whole pixels', () => {
    // What a design system actually ships: 1.2 from 16, rounded for the CSS.
    const result = inferTypeScale(evenly(16, 19, 23, 28, 33));

    expect(result.kind).toBe('scale');
    if (result.kind !== 'scale') return;
    expect(result.match.ratio).toBe(1.2);
  });

  it('places sizes below the base at negative steps', () => {
    const result = inferTypeScale(evenly(12.8, 16, 20, 25));

    expect(result.kind).toBe('scale');
    if (result.kind !== 'scale') return;
    expect(result.match.steps.map((step) => step.step)).toEqual([-1, 0, 1, 2]);
  });

  it('refuses to call a linear ramp a modular scale', () => {
    // 16/18/20/22/24 is arithmetic, not geometric. A dense ratio like 1.125
    // would swallow it if conformance were scored loosely enough.
    const result = inferTypeScale(evenly(16, 18, 20, 22, 24));

    expect(result.kind).toBe('none');
    if (result.kind !== 'none') return;
    expect(result.reason).toBe('no-matching-ratio');
    expect(result.closest?.ratio).toBe(1.125);
    expect(result.closest?.conformance).toBeLessThan(75);
  });

  it('reports the closest candidate so the UI can show how near it got', () => {
    const result = inferTypeScale(evenly(12, 14, 16, 20, 24, 32, 48));

    expect(result.kind).toBe('none');
    if (result.kind !== 'none') return;
    expect(result.closest).not.toBeNull();
    expect(result.closest?.outliers.length).toBeGreaterThan(0);
  });

  it('names the outliers when a scale is otherwise consistent', () => {
    const result = inferTypeScale(evenly(16, 20, 25, 31.25, 39.06, 17));

    expect(result.kind).toBe('scale');
    if (result.kind !== 'scale') return;
    expect(result.match.outliers.map((outlier) => outlier.px)).toEqual([17]);
    expect(result.match.conformance).toBeCloseTo(83.3, 1);
  });

  it('will not infer anything from two sizes', () => {
    const result = inferTypeScale(evenly(16, 32));

    expect(result.kind).toBe('none');
    if (result.kind !== 'none') return;
    expect(result.reason).toBe('too-few-sizes');
    expect(result.closest).toBeNull();
  });

  it('says so when there is nothing to work with', () => {
    const result = inferTypeScale([]);

    expect(result.kind).toBe('none');
    if (result.kind !== 'none') return;
    expect(result.reason).toBe('no-sizes');
  });

  it('sorts and filters the sizes it echoes back', () => {
    const result = inferTypeScale([
      { px: 32, count: 1 },
      { px: -4, count: 9 },
      { px: 16, count: 5 },
      { px: 24, count: 2 },
    ]);

    expect(result.sizes.map((size) => size.px)).toEqual([16, 24, 32]);
  });

  it('honours a caller that wants a looser bar', () => {
    const sizes = evenly(16, 18, 20, 22, 24);
    expect(inferTypeScale(sizes, { minConformance: 50 }).kind).toBe('scale');
  });

  it('honours a restricted ratio list', () => {
    const result = inferTypeScale(evenly(16, 20, 25, 31.25), {
      ratios: [{ ratio: 1.5, name: 'Perfect Fifth' }],
    });

    expect(result.kind).toBe('none');
    if (result.kind !== 'none') return;
    expect(result.closest?.ratio).toBe(1.5);
  });

  it('ignores a nonsensical ratio instead of dividing by log(1)', () => {
    const result = inferTypeScale(evenly(16, 20, 25), { ratios: [{ ratio: 1, name: 'Unison' }] });

    expect(result.kind).toBe('none');
    if (result.kind !== 'none') return;
    expect(result.closest).toBeNull();
  });
});

describe('isTextBearing', () => {
  it('counts an element with text of its own', () => {
    const element = document.createElement('p');
    element.textContent = 'Hello';
    expect(isTextBearing(element)).toBe(true);
  });

  it('skips a wrapper whose text belongs to a child', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<span>Hello</span>';
    expect(isTextBearing(wrapper)).toBe(false);
  });

  it('skips an element holding only whitespace between children', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '\n  <span>a</span>\n  <span>b</span>\n';
    expect(isTextBearing(wrapper)).toBe(false);
  });

  it('counts form controls, whose text is not in a child node', () => {
    const input = document.createElement('input');
    input.value = 'typed';
    expect(isTextBearing(input)).toBe(true);
  });

  it('never counts a script or style element', () => {
    const script = document.createElement('script');
    script.textContent = 'var a = 1;';
    expect(isTextBearing(script)).toBe(false);
  });
});

describe('collectFontSizes', () => {
  it('counts only elements that paint text', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <h1 data-size="32px">Title</h1>
      <div data-size="16px"><p data-size="16px">Body</p></div>
      <p data-size="16px">More body</p>
      <style data-size="99px">.a{}</style>
    `;

    expect(collectFontSizes(root, { view: sizedView() })).toEqual([
      { px: 16, count: 2 },
      { px: 32, count: 1 },
    ]);
  });

  it('descends into open shadow roots, where component text lives', () => {
    const root = document.createElement('div');
    const host = document.createElement('div');
    root.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const heading = document.createElement('h2');
    heading.setAttribute('data-size', '24px');
    heading.textContent = 'Shadow heading';
    shadow.append(heading);

    expect(collectFontSizes(root, { view: sizedView() })).toEqual([{ px: 24, count: 1 }]);
    expect(collectFontSizes(root, { view: sizedView(), pierceShadow: false })).toEqual([]);
  });

  it('stops at the element budget instead of freezing on a huge page', () => {
    const root = document.createElement('div');
    root.setAttribute('data-size', '16px');
    root.textContent = 'root text';
    for (let index = 0; index < 50; index += 1) {
      const child = document.createElement('p');
      child.setAttribute('data-size', '20px');
      child.textContent = 'child';
      root.append(child);
    }

    const limited = collectFontSizes(root, { view: sizedView(), limit: 5 });
    expect(limited.reduce((total, size) => total + size.count, 0)).toBe(5);
  });
});

describe('inferTypeScaleForSubtree', () => {
  it('goes from a subtree to a verdict in one call', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <p data-size="16px">a</p>
      <p data-size="20px">b</p>
      <p data-size="25px">c</p>
      <p data-size="31.25px">d</p>
    `;

    const result = inferTypeScaleForSubtree(root, { view: sizedView() });

    expect(result.kind).toBe('scale');
    if (result.kind !== 'scale') return;
    expect(result.match.ratio).toBe(1.25);
  });

  it('returns the honest verdict for a page that never had a scale', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <p data-size="13px">a</p>
      <p data-size="15px">b</p>
      <p data-size="16px">c</p>
      <p data-size="17px">d</p>
      <p data-size="41px">e</p>
    `;

    expect(inferTypeScaleForSubtree(root, { view: sizedView() }).kind).toBe('none');
  });
});
