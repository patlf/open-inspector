import { describe, expect, it } from 'vitest';
import { formatHexColor, parseCssColor, parseHexColor } from './css-color.js';

describe('parseHexColor', () => {
  it('expands shorthand', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255, alpha: 1 });
    expect(parseHexColor('#f00')).toEqual({ r: 255, g: 0, b: 0, alpha: 1 });
  });

  it('accepts long form and is case-insensitive', () => {
    expect(parseHexColor('#AABBCC')).toEqual({ r: 170, g: 187, b: 204, alpha: 1 });
    expect(parseHexColor('aabbcc')).toEqual({ r: 170, g: 187, b: 204, alpha: 1 });
  });

  it('reads alpha from the 4- and 8-digit forms', () => {
    expect(parseHexColor('#0000')).toEqual({ r: 0, g: 0, b: 0, alpha: 0 });
    const half = parseHexColor('#ff000080');
    expect(half?.r).toBe(255);
    expect(half?.alpha).toBeCloseTo(128 / 255, 6);
  });

  it('rejects lengths that are typos rather than colours', () => {
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('#1')).toBeNull();
    expect(parseHexColor('#')).toBeNull();
    expect(parseHexColor('#gggggg')).toBeNull();
    expect(parseHexColor('rebeccapurple')).toBeNull();
  });
});

describe('formatHexColor', () => {
  it('pads, rounds and clamps', () => {
    expect(formatHexColor({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(formatHexColor({ r: 255, g: 255, b: 255 })).toBe('#ffffff');
    expect(formatHexColor({ r: 127.5, g: 10.4, b: 1 })).toBe('#800a01');
    expect(formatHexColor({ r: -20, g: 900, b: Number.NaN })).toBe('#00ff00');
  });
});

describe('parseCssColor', () => {
  it('reads the legacy comma syntax computed styles usually return', () => {
    expect(parseCssColor('rgb(17, 34, 51)')).toEqual({ r: 17, g: 34, b: 51, alpha: 1 });
    expect(parseCssColor('rgba(17, 34, 51, 0.5)')).toEqual({ r: 17, g: 34, b: 51, alpha: 0.5 });
  });

  it('reads the modern space syntax with a slash alpha', () => {
    expect(parseCssColor('rgb(17 34 51 / 50%)')).toEqual({ r: 17, g: 34, b: 51, alpha: 0.5 });
    expect(parseCssColor('rgb(17 34 51)')).toEqual({ r: 17, g: 34, b: 51, alpha: 1 });
  });

  it('treats percentage channels as fractions of 255, not 100', () => {
    expect(parseCssColor('rgb(100%, 0%, 50%)')).toEqual({ r: 255, g: 0, b: 127.5, alpha: 1 });
  });

  it('recognises transparent as a real colour with zero alpha', () => {
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, alpha: 0 });
  });

  it('clamps out-of-range channels and alpha the way browsers do', () => {
    expect(parseCssColor('rgb(300, -20, 0)')).toEqual({ r: 255, g: 0, b: 0, alpha: 1 });
    expect(parseCssColor('rgba(0, 0, 0, 4)')).toEqual({ r: 0, g: 0, b: 0, alpha: 1 });
  });

  it('returns null for colour spaces it does not model, instead of guessing', () => {
    expect(parseCssColor('oklch(0.7 0.15 250)')).toBeNull();
    expect(parseCssColor('color(display-p3 1 0 0)')).toBeNull();
    expect(parseCssColor('hsl(200 50% 50%)')).toBeNull();
    expect(parseCssColor('rebeccapurple')).toBeNull();
    expect(parseCssColor('rgb(1, 2)')).toBeNull();
    expect(parseCssColor('rgb(a, b, c)')).toBeNull();
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor(null)).toBeNull();
    expect(parseCssColor(undefined)).toBeNull();
  });
});
