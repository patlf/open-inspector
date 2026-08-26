import { describe, expect, it } from 'vitest';
import {
  findNestedUrls,
  parseCssImageLayers,
  parseCssUrl,
  parseFontFaceSrc,
  parseImageSet,
  splitCssList,
  splitCssTokens,
  unquoteCssString,
} from './css-values.js';

describe('splitCssList', () => {
  it('ignores commas inside functions', () => {
    expect(splitCssList('linear-gradient(red, blue), url(a.png)')).toEqual([
      'linear-gradient(red, blue)',
      'url(a.png)',
    ]);
  });

  it('ignores commas inside a quoted data URI', () => {
    // The comma after `base64` is part of the payload separator. Splitting on
    // it hands the caller half an image.
    const value = 'url("data:image/png;base64,iVBORw0KGgo="), url(b.png)';
    expect(splitCssList(value)).toEqual(['url("data:image/png;base64,iVBORw0KGgo=")', 'url(b.png)']);
  });

  it('ignores commas inside an unquoted data URI', () => {
    const value = 'url(data:image/svg+xml;utf8,<svg/>), none';
    expect(splitCssList(value)).toEqual(['url(data:image/svg+xml;utf8,<svg/>)', 'none']);
  });

  it('respects an escaped closing paren', () => {
    expect(splitCssList('url(a\\).png), url(b.png)')).toEqual(['url(a\\).png)', 'url(b.png)']);
  });

  it('drops empty segments from a trailing comma', () => {
    expect(splitCssList('url(a.png), ,')).toEqual(['url(a.png)']);
  });
});

describe('splitCssTokens', () => {
  it('keeps a function with internal spaces as one token', () => {
    expect(splitCssTokens('local(Helvetica Neue) format("woff2")')).toEqual([
      'local(Helvetica Neue)',
      'format("woff2")',
    ]);
  });

  it('keeps a quoted string with spaces as one token', () => {
    expect(splitCssTokens('"my font.woff2" 2x')).toEqual(['"my font.woff2"', '2x']);
  });
});

describe('unquoteCssString', () => {
  it('strips matching quotes and unescapes', () => {
    expect(unquoteCssString('"a\\"b.png"')).toBe('a"b.png');
  });

  it('returns null for an unquoted token so descriptors are never read as URLs', () => {
    expect(unquoteCssString('2x')).toBeNull();
    expect(unquoteCssString('"mismatched\'')).toBeNull();
  });
});

describe('parseCssUrl', () => {
  it.each([
    ['url(a.png)', 'a.png'],
    ["url('a.png')", 'a.png'],
    ['url( "a.png" )', 'a.png'],
    ['URL(A.PNG)', 'A.PNG'],
    ['src("a.woff2")', 'a.woff2'],
  ])('parses %s', (input, expected) => {
    expect(parseCssUrl(input)).toBe(expected);
  });

  it('keeps the commas inside a data URI', () => {
    expect(parseCssUrl('url(data:image/svg+xml;base64,PHN2Zy8+)')).toBe(
      'data:image/svg+xml;base64,PHN2Zy8+',
    );
  });

  it('refuses a bare quoted string', () => {
    // `content: "url(fake)"` is text, not a reference to a file.
    expect(parseCssUrl('"url(fake)"')).toBeNull();
  });

  it('refuses an empty url()', () => {
    expect(parseCssUrl('url()')).toBeNull();
  });
});

describe('parseCssImageLayers', () => {
  it('returns nothing for none or an empty value', () => {
    expect(parseCssImageLayers('none')).toEqual([]);
    expect(parseCssImageLayers('')).toEqual([]);
    expect(parseCssImageLayers(null)).toEqual([]);
  });

  it('keeps layer order and classifies each layer', () => {
    const layers = parseCssImageLayers(
      'url("top.png"), linear-gradient(rgba(0,0,0,.5), transparent), url(bottom.jpg)',
    );

    expect(layers.map((layer) => layer.kind)).toEqual(['url', 'gradient', 'url']);
    expect(layers[0]?.candidates[0]?.url).toBe('top.png');
    expect(layers[2]?.candidates[0]?.url).toBe('bottom.jpg');
  });

  it('reports every image-set candidate rather than picking one', () => {
    const layers = parseCssImageLayers(
      'image-set(url(a.avif) type("image/avif") 1x, "a@2x.png" 2x)',
    );

    expect(layers[0]?.kind).toBe('image-set');
    expect(layers[0]?.candidates).toEqual([
      { raw: 'url(a.avif)', url: 'a.avif', descriptor: '1x', mimeType: 'image/avif' },
      { raw: '"a@2x.png"', url: 'a@2x.png', descriptor: '2x', mimeType: null },
    ]);
  });

  it('handles the vendor-prefixed spelling build tools still emit', () => {
    const layers = parseCssImageLayers('-webkit-image-set(url(a.png) 1x, url(b.png) 2x)');
    expect(layers[0]?.kind).toBe('image-set');
    expect(layers[0]?.candidates).toHaveLength(2);
  });

  it('digs a url out of an unrecognised function instead of dropping it', () => {
    const layers = parseCssImageLayers('cross-fade(url(a.png) 50%, url(b.png))');
    expect(layers[0]?.kind).toBe('other');
    expect(layers[0]?.candidates.map((candidate) => candidate.url)).toEqual(['a.png', 'b.png']);
  });

  it('does not treat a quoted string in content as a url', () => {
    expect(parseCssImageLayers('"url(fake.png)"')[0]?.candidates).toEqual([]);
  });

  it('marks an explicit none layer without inventing a candidate', () => {
    const layers = parseCssImageLayers('none, url(a.png)');
    expect(layers[0]).toEqual({ raw: 'none', kind: 'none', candidates: [] });
  });
});

describe('parseImageSet', () => {
  it('reads dppx and w descriptors', () => {
    const candidates = parseImageSet('image-set(url(a.png) 2dppx, url(b.png) 600w)');
    expect(candidates.map((candidate) => candidate.descriptor)).toEqual(['2dppx', '600w']);
  });

  it('returns nothing when the value is not an image-set', () => {
    expect(parseImageSet('url(a.png)')).toEqual([]);
  });
});

describe('findNestedUrls', () => {
  it('finds every url token in an arbitrary value', () => {
    expect(findNestedUrls("a url(one.png) b url('two.png') c url(\"three.png\")").map((c) => c.url)).toEqual([
      'one.png',
      'two.png',
      'three.png',
    ]);
  });
});

describe('parseFontFaceSrc', () => {
  it('parses the full url/format/local fallback chain', () => {
    const sources = parseFontFaceSrc(
      `local("Inter"), url(/f/inter.woff2) format("woff2"), url('../f/inter.woff') format('woff')`,
    );

    expect(sources).toEqual([
      { kind: 'local', name: 'Inter' },
      { kind: 'url', url: '/f/inter.woff2', format: 'woff2', tech: null },
      { kind: 'url', url: '../f/inter.woff', format: 'woff', tech: null },
    ]);
  });

  it('keeps an unquoted local() family with spaces intact', () => {
    expect(parseFontFaceSrc('local(Helvetica Neue Bold)')).toEqual([
      { kind: 'local', name: 'Helvetica Neue Bold' },
    ]);
  });

  it('reads the CSS Fonts 4 tech() descriptor', () => {
    expect(parseFontFaceSrc('url(v.woff2) format("woff2") tech(variations)')).toEqual([
      { kind: 'url', url: 'v.woff2', format: 'woff2', tech: 'variations' },
    ]);
  });

  it('handles a base64 font inlined into the stylesheet', () => {
    const sources = parseFontFaceSrc('url(data:font/woff2;base64,d09GMg==) format("woff2")');
    expect(sources).toEqual([
      { kind: 'url', url: 'data:font/woff2;base64,d09GMg==', format: 'woff2', tech: null },
    ]);
  });

  it('returns nothing for an absent descriptor', () => {
    expect(parseFontFaceSrc(null)).toEqual([]);
    expect(parseFontFaceSrc('')).toEqual([]);
  });
});
