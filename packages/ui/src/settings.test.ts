import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.js';

describe('normalizeSettings', () => {
  it('defaults to oklch when nothing has been saved', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.colorFormat).toBe('oklch');
  });

  it('keeps a saved format it recognises', () => {
    expect(normalizeSettings({ colorFormat: 'hex' }).colorFormat).toBe('hex');
  });

  it('falls back field by field on anything it does not', () => {
    expect(normalizeSettings({ colorFormat: 'cmyk' }).colorFormat).toBe('oklch');
    expect(normalizeSettings('not an object')).toEqual(DEFAULT_SETTINGS);
  });
});

describe('normalizeSettings: the theme', () => {
  it('follows the system until one is chosen', () => {
    expect(normalizeSettings(undefined).theme).toBe('system');
    expect(normalizeSettings({ theme: 'light' }).theme).toBe('light');
    expect(normalizeSettings({ theme: 'dark' }).theme).toBe('dark');
  });

  it('falls back to the system on anything else', () => {
    expect(normalizeSettings({ theme: 'sepia' }).theme).toBe('system');
    expect(normalizeSettings({ theme: null }).theme).toBe('system');
  });
});

describe('normalizeSettings: the panel placement', () => {
  it('opens docked right by default', () => {
    expect(normalizeSettings(undefined).panel).toEqual({
      dock: 'right',
      x: 12,
      y: 12,
      width: 348,
      height: null,
    });
  });

  it('keeps a floating position it was given', () => {
    const panel = { dock: null, x: 200, y: 80, width: 420, height: 500 };
    expect(normalizeSettings({ panel }).panel).toEqual(panel);
  });

  it('replaces anything malformed with the default, field by field', () => {
    expect(normalizeSettings({ panel: { dock: 'top', x: 'far', y: 40, width: Number.NaN } }).panel).toEqual({
      dock: 'right',
      x: 12,
      y: 40,
      width: 348,
      height: null,
    });
  });
});
