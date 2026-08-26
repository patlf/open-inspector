import { describe, expect, it } from 'vitest';
import {
  analyzeSpacingScale,
  collectSpacingSamples,
  conformsToBase,
  gcdCandidate,
  inferSpacingScale,
  readSpacingFromStyle,
  type SpacingSample,
} from './spacing-scale.js';

/** Build samples from bare numbers; the property and source do not matter here. */
function samplesOf(values: readonly number[], source = 'div.card'): SpacingSample[] {
  return values.map((value) => ({ value, property: 'margin-top', source }));
}

/** A `Window` that answers `getComputedStyle` from a lookup table. */
function fakeView(styles: Map<Element, Partial<CSSStyleDeclaration>>): Window {
  return {
    getComputedStyle: (element: Element) => (styles.get(element) ?? {}) as CSSStyleDeclaration,
  } as unknown as Window;
}

describe('conformsToBase', () => {
  it('accepts multiples and forgives sub-pixel drift', () => {
    expect(conformsToBase(16, 8)).toBe(true);
    expect(conformsToBase(23.99, 8)).toBe(true);
    expect(conformsToBase(13, 8)).toBe(false);
  });

  it('treats negative margins as on-scale', () => {
    expect(conformsToBase(-24, 8)).toBe(true);
  });

  it('refuses to let a hairline conform to every base', () => {
    // Rounding to the zero multiple is not conformance.
    expect(conformsToBase(0.5, 8)).toBe(false);
    expect(conformsToBase(1, 16)).toBe(false);
  });
});

describe('gcdCandidate', () => {
  it('finds a scale nobody would have guessed', () => {
    expect(gcdCandidate([6, 12, 18, 24, 36])).toBe(6);
  });

  it('ignores fractional values that would drag the divisor to 1', () => {
    // One 13.3333px from a percentage must not hide a 6px system.
    expect(gcdCandidate([6, 12, 18, 13.3333])).toBe(6);
  });

  it('returns null when there is nothing to derive', () => {
    expect(gcdCandidate([5, 7, 11])).toBeNull();
    expect(gcdCandidate([8])).toBeNull();
    expect(gcdCandidate([])).toBeNull();
  });
});

describe('inferSpacingScale', () => {
  it('reports the base, the conformance and the specific outliers', () => {
    const samples = [
      ...samplesOf([8, 8, 8, 16, 16, 24, 32, 8, 16, 40, 48, 8, 24, 16, 8, 16, 32, 8]),
      { value: 5, property: 'padding-left', source: 'button.cta' },
      { value: 13, property: 'margin-bottom', source: 'p.lead' },
    ];

    const scale = inferSpacingScale(samples);
    expect(scale.kind).toBe('scale');
    if (scale.kind !== 'scale') return;

    expect(scale.base).toBe(8);
    expect(Math.round(scale.conformance * 100)).toBe(90);
    expect(scale.outliers.map((entry) => entry.value)).toEqual([5, 13]);
    expect(scale.outliers[0]?.sources).toEqual(['button.cta']);
    expect(scale.summary).toBe('8px scale, 90% conform, outliers: 5px, 13px');
  });

  it('prefers the largest base that still explains the values', () => {
    // 4 and 8 both "explain" these, but 16px is the real system.
    const scale = inferSpacingScale(samplesOf([16, 32, 16, 48, 64, 16, 32]));
    expect(scale.kind === 'scale' && scale.base).toBe(16);
  });

  it('does not over-claim when the larger base fails', () => {
    const scale = inferSpacingScale(samplesOf([4, 8, 12, 16, 24, 4, 12, 20]));
    expect(scale.kind === 'scale' && scale.base).toBe(4);
  });

  it('finds a 10px scale', () => {
    const scale = inferSpacingScale(samplesOf([10, 20, 30, 20, 10, 40, 60]));
    expect(scale.kind === 'scale' && scale.base).toBe(10);
  });

  it('finds a base outside the usual candidates via the GCD', () => {
    const scale = inferSpacingScale(samplesOf([6, 12, 18, 24, 6, 30, 12]));
    expect(scale.kind === 'scale' && scale.base).toBe(6);
  });

  it('says there is no scale rather than inventing one', () => {
    const scale = inferSpacingScale(samplesOf([3, 7, 11, 13, 19, 23, 29, 31]));
    expect(scale.kind).toBe('no-consistent-scale');
    if (scale.kind !== 'no-consistent-scale') return;
    expect(scale.conformance).toBeLessThan(0.75);
    expect(scale.summary).toContain('no consistent spacing scale');
    // The distinct values are still reported so the UI has something to show.
    expect(scale.values).toHaveLength(8);
  });

  it('refuses a verdict on too few values', () => {
    const scale = inferSpacingScale(samplesOf([8, 16]));
    expect(scale.kind).toBe('insufficient-data');
    if (scale.kind !== 'insufficient-data') return;
    expect(scale.sampleSize).toBe(2);
  });

  it('drops zeros, which conform to everything and mean nothing', () => {
    const scale = inferSpacingScale(samplesOf([0, 0, 0, 0, 0, 8, 16, 24, 32]));
    expect(scale.kind === 'scale' && scale.sampleSize).toBe(4);
    expect(scale.kind === 'scale' && scale.conformance).toBe(1);
  });

  it('counts occurrences, not distinct values', () => {
    // Twenty 8s and one 13 is a 95% conforming 8px scale, not a 50% one.
    const scale = inferSpacingScale(samplesOf([...Array<number>(20).fill(8), 13]));
    expect(scale.kind === 'scale' && Math.round(scale.conformance * 100)).toBe(95);
  });

  it('groups sub-pixel values by their rounded form and keeps sources', () => {
    const samples: SpacingSample[] = [
      { value: 13.3333, property: 'padding-left', source: 'div.a' },
      { value: 13.3333, property: 'padding-right', source: 'div.b' },
      ...samplesOf([8, 16, 24, 32, 8, 16, 24, 40]),
    ];

    const scale = inferSpacingScale(samples);
    expect(scale.kind === 'scale' && scale.base).toBe(8);
    if (scale.kind !== 'scale') return;
    expect(scale.outliers).toHaveLength(1);
    expect(scale.outliers[0]?.value).toBe(13.33);
    expect(scale.outliers[0]?.count).toBe(2);
    expect(scale.outliers[0]?.sources).toEqual(['div.a', 'div.b']);
  });

  it('caps the outlier list in the summary but keeps them all in the data', () => {
    const scale = inferSpacingScale(
      samplesOf([8, 16, 24, 32, 40, 48, 56, 64, 8, 16, 24, 32, 40, 48, 3, 5, 7, 9]),
      { minConformance: 0.6 },
    );
    expect(scale.kind).toBe('scale');
    if (scale.kind !== 'scale') return;
    expect(scale.outliers).toHaveLength(4);
    expect(scale.summary).toContain('and 1 more');
  });
});

describe('readSpacingFromStyle', () => {
  it('reads margins, paddings and both gaps', () => {
    const style = {
      marginTop: '8px',
      marginRight: '0px',
      marginBottom: '-16px',
      marginLeft: 'auto',
      paddingTop: '24px',
      paddingRight: '',
      paddingBottom: '24px',
      paddingLeft: '24px',
      columnGap: 'normal',
      rowGap: '12px',
    } as CSSStyleDeclaration;

    const samples = readSpacingFromStyle(style, 'div.card');
    expect(samples.map((sample) => sample.value)).toEqual([8, -16, 24, 24, 24, 12]);
    expect(samples.map((sample) => sample.property)).toEqual([
      'margin-top',
      'margin-bottom',
      'padding-top',
      'padding-bottom',
      'padding-left',
      'row-gap',
    ]);
    expect(samples[0]?.source).toBe('div.card');
  });

  it('survives a style object that knows nothing about gaps', () => {
    expect(readSpacingFromStyle({ marginTop: '8px' } as CSSStyleDeclaration, 'div')).toEqual([
      { value: 8, property: 'margin-top', source: 'div' },
    ]);
  });
});

describe('collectSpacingSamples', () => {
  it('walks the subtree and labels every sample with its element', () => {
    const root = document.createElement('section');
    root.id = 'main';
    const card = document.createElement('article');
    card.className = 'card';
    root.append(card);

    const styles = new Map<Element, Partial<CSSStyleDeclaration>>([
      [root, { paddingTop: '32px' }],
      [card, { marginBottom: '16px' }],
    ]);

    const collection = collectSpacingSamples(root, { view: fakeView(styles) });
    expect(collection.elementsVisited).toBe(2);
    expect(collection.truncated).toBe(false);
    expect(collection.samples).toEqual([
      { value: 32, property: 'padding-top', source: 'section#main' },
      { value: 16, property: 'margin-bottom', source: 'article.card' },
    ]);
  });

  it('descends into open shadow roots when asked, and stops when told not to', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    shadow.append(inner);

    const styles = new Map<Element, Partial<CSSStyleDeclaration>>([
      [host, { marginTop: '8px' }],
      [inner, { paddingTop: '4px' }],
    ]);

    expect(collectSpacingSamples(host, { view: fakeView(styles) }).samples).toHaveLength(2);
    expect(
      collectSpacingSamples(host, { view: fakeView(styles), pierceShadow: false }).samples,
    ).toHaveLength(1);
  });

  it('reports truncation instead of pretending it walked everything', () => {
    const root = document.createElement('div');
    for (let index = 0; index < 10; index += 1) root.append(document.createElement('div'));

    const styles = new Map<Element, Partial<CSSStyleDeclaration>>();
    for (const element of [root, ...Array.from(root.children)]) {
      styles.set(element, { marginTop: '8px' });
    }

    const collection = collectSpacingSamples(root, { view: fakeView(styles), maxElements: 4 });
    expect(collection.elementsVisited).toBe(4);
    expect(collection.truncated).toBe(true);
  });
});

describe('analyzeSpacingScale', () => {
  it('walks and infers in one call', () => {
    const root = document.createElement('div');
    const styles = new Map<Element, Partial<CSSStyleDeclaration>>([
      [root, { marginTop: '8px', paddingTop: '16px', paddingBottom: '24px', rowGap: '32px' }],
    ]);

    const report = analyzeSpacingScale(root, { view: fakeView(styles) });
    expect(report.scale.kind === 'scale' && report.scale.base).toBe(8);
    expect(report.elementsVisited).toBe(1);
    expect(report.truncated).toBe(false);
  });
});
