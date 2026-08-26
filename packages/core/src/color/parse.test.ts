import { describe, expect, it } from 'vitest';
import type { Rgba } from './parse.js';
import {
  TRANSPARENT,
  compositeOver,
  formatColor,
  formatHsl,
  formatOklch,
  formatRgb,
  isOpaque,
  oklabDistance,
  oklabToRgba,
  oklchToRgba,
  parseColor,
  toHex,
  toHsl,
  toOklab,
  toOklch,
  withAlpha,
} from './parse.js';

const RED: Rgba = { r: 255, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

describe('parseColor: hex', () => {
  it('reads the three shorthand and longhand forms', () => {
    expect(parseColor('#f00')).toEqual(RED);
    expect(parseColor('#ff0000')).toEqual(RED);
    expect(parseColor('#FF0000')).toEqual(RED);
  });

  it('reads hex alpha in both lengths', () => {
    expect(parseColor('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 0.502 });
    expect(parseColor('#f00f')).toEqual(RED);
    expect(parseColor('#0000')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('refuses hex lengths that are not a shorthand for anything', () => {
    expect(parseColor('#ff00')).not.toBeNull();
    expect(parseColor('#ff000')).toBeNull();
    expect(parseColor('#ff00000')).toBeNull();
    expect(parseColor('#')).toBeNull();
    expect(parseColor('#gg0000')).toBeNull();
  });
});

describe('parseColor: rgb', () => {
  it('reads the legacy comma form and the modern space form identically', () => {
    // Chrome switched serialization between versions; both still turn up.
    expect(parseColor('rgb(255, 0, 0)')).toEqual(RED);
    expect(parseColor('rgb(255 0 0)')).toEqual(RED);
  });

  it('reads alpha from a fourth argument or after a slash', () => {
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(255 0 0 / 0.5)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(255 0 0 / 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });

  it('reads percentage channels', () => {
    expect(parseColor('rgb(100% 0% 0%)')).toEqual(RED);
    expect(parseColor('rgb(50% 50% 50%)')).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });

  it('treats a `none` component as zero', () => {
    expect(parseColor('rgb(255 none none)')).toEqual(RED);
  });

  it('clamps out-of-range channels instead of producing an invalid colour', () => {
    expect(parseColor('rgb(300, -20, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 4)')).toEqual(BLACK);
  });

  it('rejects wrong arity and junk components', () => {
    expect(parseColor('rgb(255, 0)')).toBeNull();
    expect(parseColor('rgb(255, 0, 0, 1, 1)')).toBeNull();
    expect(parseColor('rgb(255, 0, red)')).toBeNull();
    expect(parseColor('rgb(from red r g b)')).toBeNull();
  });
});

describe('parseColor: hsl and hwb', () => {
  it('reads both syntaxes', () => {
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual(RED);
    expect(parseColor('hsl(0 100% 50%)')).toEqual(RED);
    expect(parseColor('hsla(0, 100%, 50%, 0.25)')).toEqual({ r: 255, g: 0, b: 0, a: 0.25 });
  });

  it('accepts bare numbers for saturation and lightness, as CSS Color 4 allows', () => {
    expect(parseColor('hsl(120 100 25)')).toEqual({ r: 0, g: 127.5, b: 0, a: 1 });
  });

  it('accepts every angle unit and wraps hue', () => {
    expect(parseColor('hsl(0.5turn 100% 50%)')).toEqual({ r: 0, g: 255, b: 255, a: 1 });
    expect(parseColor('hsl(180deg 100% 50%)')).toEqual({ r: 0, g: 255, b: 255, a: 1 });
    expect(parseColor('hsl(200grad 100% 50%)')).toEqual({ r: 0, g: 255, b: 255, a: 1 });
    // Negative hues are legal and must wrap, not clamp.
    expect(parseColor('hsl(-60 100% 50%)')).toEqual({ r: 255, g: 0, b: 255, a: 1 });
    expect(parseColor('hsl(420 100% 50%)')).toEqual({ r: 255, g: 255, b: 0, a: 1 });
  });

  it('reads hwb, including whiteness and blackness that overflow into grey', () => {
    expect(parseColor('hwb(0 0% 0%)')).toEqual(RED);
    expect(parseColor('hwb(0 50% 50%)')).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
    expect(parseColor('hwb(0 100% 0%)')).toEqual(WHITE);
  });
});

describe('parseColor: oklch and oklab', () => {
  it('reads sRGB red back out of its oklch spelling', () => {
    const parsed = parseColor('oklch(0.6279 0.2577 29.23)');

    expect(parsed?.r).toBeCloseTo(255, 0);
    expect(parsed?.g).toBeCloseTo(0, 0);
    expect(parsed?.b).toBeCloseTo(0, 0);
  });

  it('accepts percentage lightness and chroma', () => {
    const percent = parseColor('oklch(62.79% 64.43% 29.23)');
    const numeric = parseColor('oklch(0.6279 0.2577 29.23)');

    expect(percent?.r).toBeCloseTo(numeric?.r ?? -1, 0);
    expect(percent?.g).toBeCloseTo(numeric?.g ?? -1, 0);
  });

  it('reads the slash alpha form', () => {
    expect(parseColor('oklch(0 0 0 / 0.5)')?.a).toBe(0.5);
  });

  it('reads oklab', () => {
    const parsed = parseColor('oklab(1 0 0)');

    expect(parsed?.r).toBeCloseTo(255, 0);
    expect(parsed?.g).toBeCloseTo(255, 0);
    expect(parsed?.b).toBeCloseTo(255, 0);
  });

  it('clamps colours outside the sRGB gamut rather than emitting invalid channels', () => {
    const parsed = parseColor('oklch(0.7 0.4 150)');

    expect(parsed).not.toBeNull();
    expect(parsed?.r).toBeGreaterThanOrEqual(0);
    expect(parsed?.g).toBeLessThanOrEqual(255);
  });
});

describe('parseColor: color() and refusals', () => {
  it('reads the sRGB spaces exactly', () => {
    expect(parseColor('color(srgb 1 0 0)')).toEqual(RED);
    expect(parseColor('color(srgb 1 1 1 / 50%)')).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(parseColor('color(srgb-linear 1 1 1)')).toEqual(WHITE);
  });

  it('refuses wide-gamut spaces rather than pretending they are sRGB', () => {
    // Reporting a display-p3 brand red as #ff0000 is the confident wrong
    // answer this module exists to avoid.
    expect(parseColor('color(display-p3 1 0 0)')).toBeNull();
    expect(parseColor('color(rec2020 1 0 0)')).toBeNull();
  });

  it('reads lab() and lch(), because Chrome emits them for computed colours', () => {
    // This module used to refuse both rather than commit to a white point.
    // A reliability sweep settled it: Chrome serializes computed colours as
    // `lab()` whenever the author used a modern colour space, so refusing
    // left the palette nearly empty on any Tailwind v4 site. CSS Color 4
    // specifies D50, so there was never a choice to agonise over.
    expect(parseColor('lab(50% 40 30)')).not.toBeNull();
    expect(parseColor('lch(50% 40 30)')).not.toBeNull();
  });

  it('still refuses forms whose value depends on context it cannot see', () => {
    // These need the cascade, the colour scheme, or a base colour to resolve.
    // Guessing would be exactly the confident wrong answer this module avoids.
    expect(parseColor('color-mix(in oklch, red, blue)')).toBeNull();
    expect(parseColor('light-dark(#fff, #000)')).toBeNull();
    expect(parseColor('rgb(from red r g b)')).toBeNull();
  });
});

describe('parseColor: keywords and names', () => {
  it('reads named colours case-insensitively', () => {
    expect(parseColor('red')).toEqual(RED);
    expect(parseColor('ReBeCcApUrPlE')).toEqual({ r: 102, g: 51, b: 153, a: 1 });
    expect(parseColor('  white  ')).toEqual(WHITE);
    expect(parseColor('grey')).toEqual(parseColor('gray'));
  });

  it('reads transparent as transparent black', () => {
    expect(parseColor('transparent')).toEqual(TRANSPARENT);
  });

  it('resolves currentColor only when given something to resolve it to', () => {
    expect(parseColor('currentColor')).toBeNull();
    expect(parseColor('currentColor', { currentColor: RED })).toEqual(RED);
  });

  it('returns null for empty, missing and nonsense input', () => {
    expect(parseColor(null)).toBeNull();
    expect(parseColor(undefined)).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor('   ')).toBeNull();
    expect(parseColor('inherit')).toBeNull();
    expect(parseColor('linear-gradient(red, blue)')).toBeNull();
  });
});

describe('toHsl', () => {
  it('converts the primaries', () => {
    expect(toHsl(RED)).toEqual({ h: 0, s: 100, l: 50, a: 1 });
    expect(toHsl({ r: 0, g: 255, b: 0, a: 1 })).toMatchObject({ h: 120, s: 100, l: 50 });
    expect(toHsl({ r: 0, g: 0, b: 255, a: 1 })).toMatchObject({ h: 240, s: 100, l: 50 });
  });

  it('reports greys as zero-saturation with hue zero', () => {
    expect(toHsl(WHITE)).toMatchObject({ h: 0, s: 0, l: 100 });
    expect(toHsl(BLACK)).toMatchObject({ h: 0, s: 0, l: 0 });
    expect(toHsl({ r: 128, g: 128, b: 128, a: 1 }).s).toBe(0);
  });

  it('keeps hue non-negative for colours between magenta and red', () => {
    const hue = toHsl({ r: 255, g: 0, b: 128, a: 1 }).h;

    expect(hue).toBeGreaterThan(300);
    expect(hue).toBeLessThan(360);
  });
});

describe('OKLab conversion', () => {
  it('puts white at lightness 1 and black at 0, with no chroma', () => {
    expect(toOklab(WHITE).l).toBeCloseTo(1, 3);
    expect(toOklab(BLACK).l).toBeCloseTo(0, 3);
    expect(toOklch(WHITE).c).toBeCloseTo(0, 3);
  });

  it('matches the published OKLCH coordinates of sRGB red', () => {
    const oklch = toOklch(RED);

    expect(oklch.l).toBeCloseTo(0.6279, 3);
    expect(oklch.c).toBeCloseTo(0.2577, 3);
    expect(oklch.h).toBeCloseTo(29.23, 1);
  });

  it('reports hue as zero for greys rather than an arbitrary angle', () => {
    expect(toOklch({ r: 128, g: 128, b: 128, a: 1 }).h).toBe(0);
  });

  it('round-trips through OKLCH', () => {
    for (const color of [RED, WHITE, BLACK, { r: 32, g: 96, b: 200, a: 1 }]) {
      const back = oklchToRgba(toOklch(color));

      expect(back.r).toBeCloseTo(color.r, 0);
      expect(back.g).toBeCloseTo(color.g, 0);
      expect(back.b).toBeCloseTo(color.b, 0);
    }
  });

  it('carries alpha through the round trip', () => {
    expect(oklchToRgba(toOklch({ r: 10, g: 20, b: 30, a: 0.25 })).a).toBe(0.25);
    expect(oklabToRgba({ l: 0, a: 0, b: 0 }, 0.5).a).toBe(0.5);
  });

  it('is not the naive gamma-ignoring conversion', () => {
    // Treating gamma-encoded channels as linear puts mid-grey near l=0.5;
    // a correct OKLab conversion puts it around 0.6. This pins the difference
    // down, because the wrong version still "works" for every other test.
    expect(toOklab({ r: 128, g: 128, b: 128, a: 1 }).l).toBeGreaterThan(0.58);
  });
});

describe('oklabDistance', () => {
  it('is zero for identical colours and about one across black to white', () => {
    expect(oklabDistance(RED, RED)).toBe(0);
    expect(oklabDistance(BLACK, WHITE)).toBeCloseTo(1, 1);
  });

  it('is small for greys a page author would call the same colour', () => {
    expect(oklabDistance({ r: 51, g: 51, b: 51, a: 1 }, { r: 52, g: 52, b: 52, a: 1 })).toBeLessThan(
      0.02,
    );
  });

  it('separates colours that read as different even at similar lightness', () => {
    const blue = { r: 0, g: 90, b: 255, a: 1 };
    const green = { r: 0, g: 160, b: 90, a: 1 };

    expect(oklabDistance(blue, green)).toBeGreaterThan(0.1);
  });

  it('ignores alpha, because a translucent colour has no identity until composited', () => {
    expect(oklabDistance(RED, { ...RED, a: 0.1 })).toBe(0);
  });
});

describe('compositeOver', () => {
  it('returns the source when the source is opaque', () => {
    expect(compositeOver(RED, WHITE)).toEqual(RED);
  });

  it('returns the backdrop when the source is fully transparent', () => {
    expect(compositeOver(TRANSPARENT, WHITE)).toEqual(WHITE);
  });

  it('blends half-and-half correctly', () => {
    expect(compositeOver({ ...WHITE, a: 0.5 }, BLACK)).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
      a: 1,
    });
  });

  it('stays translucent when both layers are', () => {
    const result = compositeOver({ ...WHITE, a: 0.5 }, { ...BLACK, a: 0.5 });

    expect(result.a).toBeCloseTo(0.75, 3);
    expect(isOpaque(result)).toBe(false);
  });

  it('returns transparent black when nothing is painted at all', () => {
    expect(compositeOver(TRANSPARENT, TRANSPARENT)).toEqual(TRANSPARENT);
  });
});

describe('formatting', () => {
  it('omits the alpha pair from hex when the colour is opaque', () => {
    expect(toHex(RED)).toBe('#ff0000');
    expect(toHex({ ...RED, a: 0.5 })).toBe('#ff000080');
    // Float noise from compositing must not produce a second entry for white.
    expect(toHex({ ...WHITE, a: 0.9995 })).toBe('#ffffff');
  });

  it('rounds fractional channels for display', () => {
    expect(toHex({ r: 127.5, g: 0, b: 0, a: 1 })).toBe('#800000');
    expect(formatRgb({ r: 127.5, g: 0, b: 0, a: 1 })).toBe('rgb(128, 0, 0)');
  });

  it('uses the legacy spellings for rgb and hsl and the modern one for oklch', () => {
    expect(formatRgb(RED)).toBe('rgb(255, 0, 0)');
    expect(formatRgb({ ...RED, a: 0.5 })).toBe('rgba(255, 0, 0, 0.5)');
    expect(formatHsl(RED)).toBe('hsl(0, 100%, 50%)');
    expect(formatHsl({ ...RED, a: 0.5 })).toBe('hsla(0, 100%, 50%, 0.5)');
    expect(formatOklch(RED)).toBe('oklch(0.628 0.258 29.2)');
    expect(formatOklch({ ...RED, a: 0.5 })).toBe('oklch(0.628 0.258 29.2 / 0.5)');
  });

  it('bundles every form the UI shows', () => {
    expect(formatColor(RED)).toEqual({
      hex: '#ff0000',
      rgb: 'rgb(255, 0, 0)',
      hsl: 'hsl(0, 100%, 50%)',
      oklch: 'oklch(0.628 0.258 29.2)',
    });
  });
});

describe('withAlpha', () => {
  it('replaces alpha and leaves the channels alone', () => {
    expect(withAlpha(RED, 0.25)).toEqual({ r: 255, g: 0, b: 0, a: 0.25 });
  });

  it('clamps out-of-range alpha', () => {
    expect(withAlpha(RED, 2).a).toBe(1);
    expect(withAlpha(RED, -1).a).toBe(0);
  });
});
