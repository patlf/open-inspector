import { describe, expect, it } from 'vitest';
import {
  base64ByteLength,
  classifyAsset,
  describeByteSize,
  extensionForMimeType,
  guessAssetName,
  isUsableBase,
  measureDataUri,
  resolveAssetUrl,
} from './url.js';

const BASE = 'https://example.com/blog/post/';

describe('resolveAssetUrl', () => {
  it('resolves a relative reference against the base', () => {
    expect(resolveAssetUrl('../img/hero.png', BASE)).toEqual({
      kind: 'absolute',
      url: 'https://example.com/blog/img/hero.png',
      protocol: 'https:',
    });
  });

  it('resolves a protocol-relative reference', () => {
    const resolved = resolveAssetUrl('//cdn.example.net/a.png', BASE);
    expect(resolved).toEqual({
      kind: 'absolute',
      url: 'https://cdn.example.net/a.png',
      protocol: 'https:',
    });
  });

  it('keeps a data URI byte-for-byte instead of re-encoding it', () => {
    // Running this through `new URL` would percent-encode the spaces and the
    // angle brackets, changing the payload we are meant to be reporting.
    const raw = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>';
    expect(resolveAssetUrl(raw, BASE)).toEqual({ kind: 'data', url: raw });
  });

  it('recognises blob URLs', () => {
    const raw = 'blob:https://example.com/8f2c-4a1b';
    expect(resolveAssetUrl(raw, BASE)).toEqual({ kind: 'blob', url: raw });
  });

  it('refuses a bare fragment rather than resolving it to the page', () => {
    // `fill="url(#grad)"` is an intra-document reference, not a file.
    expect(resolveAssetUrl('#grad', BASE)).toEqual({
      kind: 'unresolvable',
      raw: '#grad',
      reason: 'fragment-only',
    });
  });

  it.each(['javascript:void(0)', 'about:blank', 'mailto:a@b.c'])('rejects %s', (raw) => {
    expect(resolveAssetUrl(raw, BASE)).toMatchObject({ reason: 'unsupported-scheme' });
  });

  it('reports an empty or whitespace-only reference', () => {
    expect(resolveAssetUrl('   ', BASE)).toMatchObject({ reason: 'empty' });
  });

  it('blames the base when the document has no usable one', () => {
    // A sandboxed iframe reports `about:blank`, under which every relative URL
    // on the page is unresolvable through no fault of the markup.
    expect(resolveAssetUrl('hero.png', 'about:blank')).toEqual({
      kind: 'unresolvable',
      raw: 'hero.png',
      reason: 'no-usable-base',
    });
  });

  it('blames the reference when the base is fine', () => {
    expect(resolveAssetUrl('http://', BASE)).toMatchObject({ reason: 'invalid-url' });
  });

  it('trims surrounding whitespace, which srcset and CSS both leave behind', () => {
    expect(resolveAssetUrl('\n  hero.png  ', BASE)).toMatchObject({
      url: 'https://example.com/blog/post/hero.png',
    });
  });
});

describe('isUsableBase', () => {
  it('accepts an http base and rejects opaque ones', () => {
    expect(isUsableBase(BASE)).toBe(true);
    expect(isUsableBase('about:blank')).toBe(false);
    expect(isUsableBase('')).toBe(false);
  });
});

describe('measureDataUri', () => {
  it('measures a padded base64 payload exactly', () => {
    // "hello world" is 11 bytes; its base64 form is 16 chars with one pad.
    const info = measureDataUri('data:text/plain;base64,aGVsbG8gd29ybGQ=');
    expect(info).toEqual({ mimeType: 'text/plain', base64: true, bytes: 11 });
  });

  it('measures a percent-encoded payload as UTF-8 bytes', () => {
    const info = measureDataUri('data:image/svg+xml,%3Csvg%3E%C3%A9%3C/svg%3E');
    // `<svg>é</svg>` is 12 characters but 13 bytes.
    expect(info?.bytes).toBe(13);
    expect(info?.base64).toBe(false);
  });

  it('survives malformed percent escapes rather than throwing', () => {
    const info = measureDataUri('data:text/plain,100%%20off');
    expect(info?.bytes).toBeGreaterThan(0);
  });

  it('reads the media type case-insensitively and ignores parameters', () => {
    expect(measureDataUri('DATA:IMAGE/PNG;charset=UTF-8;base64,AAAA')?.mimeType).toBe('image/png');
  });

  it('treats a headerless data URI as having no declared type', () => {
    expect(measureDataUri('data:,plain')).toEqual({ mimeType: null, base64: false, bytes: 5 });
  });

  it('returns null when there is no comma at all', () => {
    // Without a comma the value is not a data URI, and inventing a size for it
    // would be exactly the confident guess this module refuses to make.
    expect(measureDataUri('data:image/png;base64')).toBeNull();
  });

  it('returns null for anything that is not a data URI', () => {
    expect(measureDataUri('https://example.com/a.png')).toBeNull();
  });
});

describe('base64ByteLength', () => {
  it('ignores the line breaks long inline images are wrapped with', () => {
    expect(base64ByteLength('aGVsbG8g\nd29ybGQ=')).toBe(11);
  });

  it('estimates rather than throwing on a length that is not a multiple of four', () => {
    expect(base64ByteLength('aGVsbG')).toBe(4);
  });

  it('reports an empty payload as zero', () => {
    expect(base64ByteLength('')).toBe(0);
  });
});

describe('guessAssetName', () => {
  const absolute = (url: string) => ({ kind: 'absolute' as const, url, protocol: 'https:' });

  it('drops the cache-busting query string', () => {
    expect(guessAssetName(absolute('https://x.dev/logo.png?v=3&w=200'), null)).toEqual({
      filename: 'logo.png',
      extension: 'png',
      source: 'path',
    });
  });

  it('decodes percent-encoded filenames', () => {
    expect(guessAssetName(absolute('https://x.dev/My%20Logo%402x.png'), null).filename).toBe(
      'My Logo@2x.png',
    );
  });

  it('does not mistake a dotted directory for an extension', () => {
    expect(guessAssetName(absolute('https://x.dev/v1.2/hero'), null)).toEqual({
      filename: 'hero',
      extension: null,
      source: 'path',
    });
  });

  it('falls back to the media type when the path has no extension', () => {
    expect(guessAssetName(absolute('https://x.dev/render?id=9'), 'image/webp')).toEqual({
      filename: 'render',
      extension: 'webp',
      source: 'mime',
    });
  });

  it('has no filename for a directory-style URL', () => {
    expect(guessAssetName(absolute('https://x.dev/assets/'), null)).toEqual({
      filename: null,
      extension: null,
      source: 'none',
    });
  });

  it('gives a data URI an extension but never a filename', () => {
    expect(guessAssetName({ kind: 'data', url: 'data:image/jpeg;base64,AAAA' }, null)).toEqual({
      filename: null,
      extension: 'jpg',
      source: 'mime',
    });
  });

  it('gives a blob URL neither', () => {
    expect(guessAssetName({ kind: 'blob', url: 'blob:https://x.dev/1' }, null)).toEqual({
      filename: null,
      extension: null,
      source: 'none',
    });
  });
});

describe('extensionForMimeType', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/svg+xml', 'svg'],
    ['font/woff2', 'woff2'],
    ['application/vnd.ms-fontobject', 'eot'],
    ['video/quicktime', 'mov'],
    ['image/png; charset=binary', 'png'],
    ['image/x-icon', 'ico'],
  ])('maps %s to %s', (mime, expected) => {
    expect(extensionForMimeType(mime)).toBe(expected);
  });

  it('refuses to invent an extension from an unusable subtype', () => {
    expect(extensionForMimeType('application/vnd.adobe.photoshop')).toBeNull();
    expect(extensionForMimeType(null)).toBeNull();
  });
});

describe('classifyAsset', () => {
  it('calls an SVG an SVG even inside an <img>', () => {
    // The element is an image; the asset is vector, and that is the whole
    // reason someone is harvesting it.
    expect(classifyAsset({ extension: 'svg', mimeType: null, hint: 'image' })).toBe('svg');
  });

  it('trusts the media type over a missing extension', () => {
    expect(classifyAsset({ extension: null, mimeType: 'video/mp4', hint: null })).toBe('video');
  });

  it('falls back to the markup hint when the URL says nothing', () => {
    expect(classifyAsset({ extension: null, mimeType: null, hint: 'video' })).toBe('video');
  });

  it('keeps ogg audio and ogv video apart', () => {
    expect(classifyAsset({ extension: 'ogg', mimeType: null, hint: null })).toBe('audio');
    expect(classifyAsset({ extension: 'ogv', mimeType: null, hint: null })).toBe('video');
  });

  it('recognises webfont extensions', () => {
    expect(classifyAsset({ extension: 'woff2', mimeType: null, hint: null })).toBe('font');
  });

  it('admits to not knowing', () => {
    expect(classifyAsset({ extension: null, mimeType: null, hint: null })).toBe('unknown');
  });
});

describe('describeByteSize', () => {
  it('knows the size of a data URI and nothing else', () => {
    expect(
      describeByteSize({ kind: 'data', url: 'data:,x' }, { mimeType: null, base64: false, bytes: 1 }),
    ).toEqual({ known: true, bytes: 1, basis: 'data-uri' });

    expect(describeByteSize({ kind: 'absolute', url: 'https://x/a.png', protocol: 'https:' }, null)).toEqual(
      { known: false, reason: 'requires-network-access' },
    );

    expect(describeByteSize({ kind: 'blob', url: 'blob:x' }, null)).toEqual({
      known: false,
      reason: 'opaque-blob-url',
    });
  });
});
