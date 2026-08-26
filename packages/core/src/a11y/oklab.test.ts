import { describe, expect, it } from 'vitest';
import type { Srgb } from './contrast.js';
import { oklabLightness, withOklabLightness } from './oklab.js';

const SAMPLES: Srgb[] = [
  { r: 0, g: 0, b: 0 },
  { r: 255, g: 255, b: 255 },
  { r: 51, g: 102, b: 204 },
  { r: 255, g: 136, b: 0 },
  { r: 18, g: 52, b: 86 },
  { r: 200, g: 30, b: 90 },
];

describe('oklabLightness', () => {
  it('anchors black at 0 and white at 1', () => {
    expect(oklabLightness({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 6);
    expect(oklabLightness({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6);
  });

  it('is monotonic along a grey ramp', () => {
    const ramp = [0, 64, 128, 192, 255].map((value) =>
      oklabLightness({ r: value, g: value, b: value }),
    );
    for (let index = 1; index < ramp.length; index += 1) {
      expect(ramp[index] ?? 0).toBeGreaterThan(ramp[index - 1] ?? 0);
    }
  });

  it('places mid-grey near the perceptual middle, unlike relative luminance', () => {
    // sRGB 128 has a relative luminance of ~0.216 but an OKLab L of ~0.6.
    expect(oklabLightness({ r: 128, g: 128, b: 128 })).toBeCloseTo(0.6, 1);
  });
});

describe('withOklabLightness', () => {
  it('round-trips a colour through its own lightness', () => {
    for (const sample of SAMPLES) {
      const result = withOklabLightness(sample, oklabLightness(sample));
      expect(Math.abs(result.r - sample.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(result.g - sample.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(result.b - sample.b)).toBeLessThanOrEqual(1);
    }
  });

  it('drives achromatic colours to black and white at the extremes', () => {
    expect(withOklabLightness({ r: 128, g: 128, b: 128 }, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(withOklabLightness({ r: 128, g: 128, b: 128 }, 1)).toEqual({
      r: 255,
      g: 255,
      b: 255,
    });
  });

  it('keeps the hue recognisable while moving lightness', () => {
    const orange = { r: 255, g: 136, b: 0 };
    for (const lightness of [0.3, 0.5, 0.7, 0.9]) {
      const shifted = withOklabLightness(orange, lightness);
      // Still orange: red dominant, blue last. `>=` on the lower pair because
      // holding chroma constant at low lightness pushes green and blue out of
      // gamut, where both clamp to 0.
      expect(shifted.r).toBeGreaterThan(shifted.g);
      expect(shifted.g).toBeGreaterThanOrEqual(shifted.b);
      expect(shifted.r).toBeGreaterThan(shifted.b);
    }
  });

  it('returns in-gamut integer channels even when the request is out of gamut', () => {
    const result = withOklabLightness({ r: 255, g: 0, b: 0 }, 0.99);
    for (const channel of [result.r, result.g, result.b]) {
      expect(Number.isInteger(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });

  it('clamps a nonsense lightness instead of producing NaN channels', () => {
    // L is clamped into 0–1, but L=0 on a chromatic colour is out of gamut and
    // resolves to a very dark version of the hue rather than pure black.
    const floored = withOklabLightness({ r: 51, g: 102, b: 204 }, -3);
    expect(Number.isInteger(floored.r)).toBe(true);
    expect(floored.r + floored.g + floored.b).toBeLessThan(60);
    expect(floored.b).toBeGreaterThan(floored.r);

    const unchanged = withOklabLightness({ r: 51, g: 102, b: 204 }, Number.NaN);
    expect(Math.abs(unchanged.r - 51)).toBeLessThanOrEqual(1);
  });
});
