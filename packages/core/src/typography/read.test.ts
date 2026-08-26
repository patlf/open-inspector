import { describe, expect, it } from 'vitest';
import {
  buildTypography,
  describeFontWeight,
  readKeywordLength,
  readRootFontSize,
  readTypography,
} from './read.js';
import { createFontDetector, detectRenderedFamily } from './rendered-family.js';
import type { FontProbes, RenderedFamilyResult } from './rendered-family.js';

const RESOLVED: RenderedFamilyResult = {
  stack: ['Inter', 'sans-serif'],
  rendered: 'Inter',
  availability: [
    { family: 'Inter', available: true, evidence: 'font-face' },
    { family: 'sans-serif', available: true, evidence: 'generic' },
  ],
  method: 'font-face',
};

/** A computed style with the vendor-property lookup real engines expose. */
function computed(values: Record<string, string>): CSSStyleDeclaration {
  return {
    ...values,
    getPropertyValue: (property: string) => values[property] ?? '',
  } as unknown as CSSStyleDeclaration;
}

describe('describeFontWeight', () => {
  it('names the standard stops', () => {
    expect(describeFontWeight('400')).toEqual({ value: 400, name: 'Regular', exact: true });
    expect(describeFontWeight('600')).toEqual({ value: 600, name: 'Semi Bold', exact: true });
    expect(describeFontWeight('900')).toEqual({ value: 900, name: 'Black', exact: true });
  });

  it('maps the legacy keywords some CSSOM shims still return', () => {
    expect(describeFontWeight('normal')).toEqual({ value: 400, name: 'Regular', exact: true });
    expect(describeFontWeight('bold')).toEqual({ value: 700, name: 'Bold', exact: true });
  });

  it('marks an in-between variable weight as approximate', () => {
    expect(describeFontWeight('450')).toEqual({ value: 450, name: 'Medium', exact: false });
    expect(describeFontWeight('340')).toEqual({ value: 340, name: 'Light', exact: false });
  });

  it('clamps a name for weights outside the named range', () => {
    expect(describeFontWeight('1000')).toEqual({ value: 1000, name: 'Black', exact: false });
    expect(describeFontWeight('1')).toEqual({ value: 1, name: 'Thin', exact: false });
  });

  it('refuses to resolve a relative keyword it cannot resolve', () => {
    // `lighter` depends on the parent's weight, which is not in this style.
    expect(describeFontWeight('lighter')).toEqual({ value: null, name: null, exact: false });
    expect(describeFontWeight('')).toEqual({ value: null, name: null, exact: false });
    expect(describeFontWeight(undefined)).toEqual({ value: null, name: null, exact: false });
  });
});

describe('readKeywordLength', () => {
  it('derives the unitless ratio designers author', () => {
    expect(readKeywordLength('24px', 16)).toEqual({ kind: 'length', px: 24, ratio: 1.5 });
  });

  it('reports `normal` as a keyword rather than inventing 1.2', () => {
    expect(readKeywordLength('normal', 16)).toEqual({ kind: 'normal', px: null, ratio: null });
  });

  it('treats a missing value as unknown, not as zero', () => {
    expect(readKeywordLength('', 16)).toEqual({ kind: 'normal', px: null, ratio: null });
  });

  it('handles negative letter spacing', () => {
    expect(readKeywordLength('-0.32px', 16)).toEqual({ kind: 'length', px: -0.32, ratio: -0.02 });
  });

  it('gives up on the ratio when the basis is unusable', () => {
    expect(readKeywordLength('24px', 0)).toEqual({ kind: 'length', px: 24, ratio: null });
  });

  it('keeps fractional line heights from zoomed layouts', () => {
    expect(readKeywordLength('27.2px', 17)).toEqual({ kind: 'length', px: 27.2, ratio: 1.6 });
  });
});

describe('buildTypography', () => {
  const style = computed({
    fontSize: '14px',
    fontWeight: '600',
    fontStyle: 'italic',
    lineHeight: '21px',
    letterSpacing: '-0.14px',
    wordSpacing: 'normal',
    textTransform: 'uppercase',
    textAlign: 'center',
    textDecorationLine: 'underline',
    textDecorationStyle: 'wavy',
    textDecorationColor: 'rgb(255, 0, 0)',
    textDecorationThickness: '2px',
    fontVariant: 'small-caps',
    fontVariantCaps: 'small-caps',
    fontVariantNumeric: 'tabular-nums',
    fontVariantLigatures: 'no-common-ligatures',
    fontFeatureSettings: '"ss01" 1',
    fontVariationSettings: '"wght" 620',
    fontKerning: 'auto',
    '-webkit-font-smoothing': 'antialiased',
    '-moz-osx-font-smoothing': 'grayscale',
  });

  it('reports size in px and in rem against the real root size', () => {
    // The `html { font-size: 62.5% }` trick makes one rem 10px, not 16.
    expect(buildTypography(style, RESOLVED, 10).size).toEqual({ px: 14, rem: 1.4 });
    expect(buildTypography(style, RESOLVED, 16).size).toEqual({ px: 14, rem: 0.875 });
  });

  it('reports the line height as both pixels and the authored ratio', () => {
    expect(buildTypography(style, RESOLVED, 16).lineHeight).toEqual({
      kind: 'length',
      px: 21,
      ratio: 1.5,
    });
  });

  it('reports letter spacing in ems as well as pixels', () => {
    expect(buildTypography(style, RESOLVED, 16).letterSpacing).toEqual({
      kind: 'length',
      px: -0.14,
      ratio: -0.01,
    });
  });

  it('reads the decoration longhands instead of the unreliable shorthand', () => {
    expect(buildTypography(style, RESOLVED, 16).textDecoration).toEqual({
      line: 'underline',
      style: 'wavy',
      color: 'rgb(255, 0, 0)',
      thickness: '2px',
    });
  });

  it('carries the OpenType settings that explain an unexpected look', () => {
    expect(buildTypography(style, RESOLVED, 16).variant).toEqual({
      variant: 'small-caps',
      caps: 'small-caps',
      numeric: 'tabular-nums',
      ligatures: 'no-common-ligatures',
      featureSettings: '"ss01" 1',
      variationSettings: '"wght" 620',
      kerning: 'auto',
    });
  });

  it('reads vendor smoothing through getPropertyValue', () => {
    expect(buildTypography(style, RESOLVED, 16).smoothing).toEqual({
      webkit: 'antialiased',
      mozOsx: 'grayscale',
    });
  });

  it('reports smoothing as null on engines that do not implement it', () => {
    const bare = computed({ fontSize: '16px' });
    expect(buildTypography(bare, RESOLVED, 16).smoothing).toEqual({ webkit: null, mozOsx: null });
  });

  it('survives a style declaration missing most properties', () => {
    const style0 = { fontSize: '16px' } as CSSStyleDeclaration;
    const result = buildTypography(style0, RESOLVED, 16);

    expect(result.weight).toEqual({ value: null, name: null, exact: false });
    expect(result.textAlign).toBe('');
    expect(result.smoothing).toEqual({ webkit: null, mozOsx: null });
  });

  it('refuses a rem figure when the root size is unusable', () => {
    expect(buildTypography(computed({ fontSize: '16px' }), RESOLVED, 0).size).toEqual({
      px: 16,
      rem: null,
    });
  });

  it('passes the font detection result straight through', () => {
    expect(buildTypography(style, RESOLVED, 16).family).toBe(RESOLVED);
  });
});

describe('readRootFontSize', () => {
  it('reads the document element rather than assuming 16', () => {
    const doc = { documentElement: {} } as unknown as Document;
    const view = {
      getComputedStyle: () => ({ fontSize: '10px' }),
    } as unknown as Window;

    expect(readRootFontSize(doc, view)).toBe(10);
  });

  it('falls back to 16 when the engine reports nothing usable', () => {
    const doc = { documentElement: {} } as unknown as Document;
    const view = { getComputedStyle: () => ({ fontSize: '' }) } as unknown as Window;

    expect(readRootFontSize(doc, view)).toBe(16);
  });
});

describe('readTypography', () => {
  const probes: FontProbes = {
    loadedFamilies: new Set(['inter']),
    checkFamily: null,
    measureText: null,
  };

  it('resolves the rendered family for the element it reads', () => {
    const element = document.createElement('p');
    document.body.append(element);

    const view = {
      getComputedStyle: () =>
        computed({ fontSize: '18px', fontWeight: '400', fontFamily: 'Inter, sans-serif' }),
    } as unknown as Window;

    const result = readTypography(element, {
      view,
      detector: createFontDetector(probes),
      rootFontSizePx: 16,
    });

    expect(result.family.stack).toEqual(['Inter', 'sans-serif']);
    expect(result.family.rendered).toBe('Inter');
    expect(result.size).toEqual({ px: 18, rem: 1.125 });
  });

  it('parses a quoted stack off the computed value', () => {
    const element = document.createElement('span');
    const view = {
      getComputedStyle: () =>
        computed({ fontSize: '16px', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }),
    } as unknown as Window;

    const result = readTypography(element, {
      view,
      detector: createFontDetector(probes),
      rootFontSizePx: 16,
    });

    expect(result.family.stack).toEqual(['Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif']);
    // Nothing here can be verified without a canvas, so no font is claimed.
    expect(result.family.rendered).toBeNull();
    expect(result.family.method).toBe('unknown');
  });
});

describe('degrading honestly end to end', () => {
  it('never names a font when detection was impossible', () => {
    const family = detectRenderedFamily(['Brand Sans', 'Georgia', 'serif'], {
      loadedFamilies: new Set(),
      checkFamily: null,
      measureText: null,
    });

    const result = buildTypography(computed({ fontSize: '16px' }), family, 16);

    expect(result.family.rendered).toBeNull();
    expect(result.family.stack).toEqual(['Brand Sans', 'Georgia', 'serif']);
  });
});
