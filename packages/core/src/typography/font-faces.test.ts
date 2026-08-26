import { describe, expect, it } from 'vitest';
import {
  classifyFontSource,
  collectFontFaces,
  isFontFaceRule,
  parseFontFaceSrc,
  parseWeightRange,
  readFontFaceRule,
  splitTopLevel,
} from './font-faces.js';
import type { FontFaceDeclarations, FontSourceContext } from './font-faces.js';

const PAGE: FontSourceContext = { baseHref: null, pageUrl: 'https://shop.example.com/product' };

/** A `@font-face` rule's declaration block, which is all we read it through. */
function declarations(values: Record<string, string>): FontFaceDeclarations {
  return { getPropertyValue: (property: string) => values[property] ?? '' };
}

/** A `CSSRuleList` over plain objects, since jsdom-free tests have no CSSOM. */
function ruleList(rules: unknown[]): CSSRuleList {
  return {
    length: rules.length,
    item: (index: number) => rules[index] ?? null,
  } as unknown as CSSRuleList;
}

function fontFaceRule(values: Record<string, string>): unknown {
  return { type: 5, style: declarations(values) };
}

function fakeDocument(sheets: unknown[], adopted: unknown[] = []): Document {
  return {
    baseURI: 'https://shop.example.com/product',
    styleSheets: sheets,
    adoptedStyleSheets: adopted,
  } as unknown as Document;
}

describe('splitTopLevel', () => {
  it('ignores commas inside quotes and parentheses', () => {
    expect(splitTopLevel('url("a,b.woff2") format("woff2"), local("Inter, Bold")')).toEqual([
      'url("a,b.woff2") format("woff2")',
      'local("Inter, Bold")',
    ]);
  });

  it('drops empty components from a trailing comma', () => {
    expect(splitTopLevel('url(a.woff),')).toEqual(['url(a.woff)']);
  });
});

describe('parseFontFaceSrc', () => {
  it('reads a multi-source rule in priority order', () => {
    const sources = parseFontFaceSrc(
      'local("Inter"), url("/fonts/inter.woff2") format("woff2"), url(/fonts/inter.woff) format("woff")',
      PAGE,
    );

    expect(sources).toEqual([
      { url: 'Inter', format: null, kind: 'local', host: null },
      {
        url: '/fonts/inter.woff2',
        format: 'woff2',
        kind: 'self-hosted',
        host: 'shop.example.com',
      },
      { url: '/fonts/inter.woff', format: 'woff', kind: 'self-hosted', host: 'shop.example.com' },
    ]);
  });

  it('infers the format when the rule omits format()', () => {
    // Extremely common in hand-written CSS and in older generators.
    const sources = parseFontFaceSrc('url(/fonts/brand.woff2?v=3)', PAGE);
    expect(sources[0]?.format).toBe('woff2');
  });

  it('keeps a format() that disagrees with the extension', () => {
    const sources = parseFontFaceSrc('url(/f/brand.bin) format("woff2")', PAGE);
    expect(sources[0]?.format).toBe('woff2');
  });

  it('tolerates the tech() function newer variable-font rules add', () => {
    const sources = parseFontFaceSrc(
      'url("/f/var.woff2") format("woff2") tech(variations), url("/f/static.woff2") format("woff2")',
      PAGE,
    );

    expect(sources).toHaveLength(2);
    expect(sources[0]?.format).toBe('woff2');
  });

  it('recognizes an inlined data URI', () => {
    const sources = parseFontFaceSrc('url(data:font/woff2;base64,AAAA) format("woff2")', PAGE);
    expect(sources[0]).toEqual({
      url: 'data:font/woff2;base64,AAAA',
      format: 'woff2',
      kind: 'data-uri',
      host: null,
    });
  });

  it('returns nothing for an absent or unparseable descriptor', () => {
    expect(parseFontFaceSrc(null, PAGE)).toEqual([]);
    expect(parseFontFaceSrc('none', PAGE)).toEqual([]);
  });
});

describe('classifyFontSource', () => {
  it('spots Google Fonts by its binary host', () => {
    expect(classifyFontSource('https://fonts.gstatic.com/s/inter/v12/a.woff2', PAGE)).toEqual({
      kind: 'google-fonts',
      host: 'fonts.gstatic.com',
    });
  });

  it('treats the page host and its subdomains as self-hosted', () => {
    expect(classifyFontSource('https://shop.example.com/f/a.woff2', PAGE).kind).toBe('self-hosted');
    expect(classifyFontSource('https://cdn.shop.example.com/f/a.woff2', PAGE).kind).toBe(
      'self-hosted',
    );
  });

  it('does not guess a registrable domain across siblings', () => {
    // Without a public-suffix list, calling `static.example.com` the same site
    // as `shop.example.com` would also call `evil.co.uk` the same site as
    // `bank.co.uk`. Reported as a CDN with its host shown instead.
    expect(classifyFontSource('https://static.example.com/a.woff2', PAGE)).toEqual({
      kind: 'cdn',
      host: 'static.example.com',
    });
  });

  it('names the well-known third-party font CDNs', () => {
    expect(classifyFontSource('https://use.typekit.net/af/x/l.woff2', PAGE).kind).toBe('cdn');
    expect(classifyFontSource('https://cdn.jsdelivr.net/npm/x.woff2', PAGE).kind).toBe('cdn');
  });

  it('resolves a relative URL against the stylesheet, not the page', () => {
    const result = classifyFontSource('../fonts/a.woff2', {
      baseHref: 'https://assets.other.com/css/site.css',
      pageUrl: 'https://shop.example.com/product',
    });

    expect(result).toEqual({ kind: 'cdn', host: 'assets.other.com' });
  });

  it('calls a relative URL self-hosted when there is no base at all', () => {
    expect(classifyFontSource('/fonts/a.woff2', { baseHref: null, pageUrl: null })).toEqual({
      kind: 'self-hosted',
      host: null,
    });
  });

  it('admits it cannot classify an exotic scheme', () => {
    expect(classifyFontSource('about:blank', { baseHref: null, pageUrl: null }).kind).toBe(
      'unknown',
    );
    expect(classifyFontSource('', PAGE).kind).toBe('unknown');
  });
});

describe('parseWeightRange', () => {
  it('reads a single weight', () => {
    expect(parseWeightRange('500')).toEqual({ min: 500, max: 500 });
  });

  it('reads the variable-font range', () => {
    expect(parseWeightRange('100 900')).toEqual({ min: 100, max: 900 });
  });

  it('normalizes a reversed range', () => {
    expect(parseWeightRange('900 100')).toEqual({ min: 100, max: 900 });
  });

  it('maps the keywords', () => {
    expect(parseWeightRange('normal')).toEqual({ min: 400, max: 400 });
    expect(parseWeightRange('BOLD')).toEqual({ min: 700, max: 700 });
  });

  it('returns null rather than a number it made up', () => {
    expect(parseWeightRange('')).toBeNull();
    expect(parseWeightRange(undefined)).toBeNull();
    expect(parseWeightRange('bolder')).toBeNull();
  });
});

describe('readFontFaceRule', () => {
  it('flattens a rule and unquotes the family so it matches a font stack', () => {
    const record = readFontFaceRule(
      declarations({
        'font-family': '"Inter Display"',
        src: 'url("/fonts/inter.woff2") format("woff2")',
        'font-weight': '100 900',
        'font-style': 'oblique 0deg 10deg',
        'font-stretch': '75% 125%',
        'unicode-range': 'U+0000-00FF, U+0131',
        'font-display': 'swap',
      }),
      'https://shop.example.com/style.css',
      'https://shop.example.com/product',
    );

    expect(record).toEqual({
      family: 'Inter Display',
      sources: [
        {
          url: '/fonts/inter.woff2',
          format: 'woff2',
          kind: 'self-hosted',
          host: 'shop.example.com',
        },
      ],
      weight: '100 900',
      weightRange: { min: 100, max: 900 },
      style: 'oblique 0deg 10deg',
      stretch: '75% 125%',
      unicodeRange: 'U+0000-00FF, U+0131',
      display: 'swap',
      href: 'https://shop.example.com/style.css',
    });
  });

  it('defaults the style and leaves absent descriptors null', () => {
    const record = readFontFaceRule(declarations({ 'font-family': 'Brand' }));

    expect(record.style).toBe('normal');
    expect(record.unicodeRange).toBeNull();
    expect(record.display).toBeNull();
    expect(record.weightRange).toBeNull();
    expect(record.sources).toEqual([]);
  });

  it('does not let a throwing declaration block take down the scan', () => {
    const hostile: FontFaceDeclarations = {
      getPropertyValue: (property: string) => {
        if (property === 'src') throw new Error('nope');
        return property === 'font-family' ? 'Brand' : '';
      },
    };

    expect(readFontFaceRule(hostile).family).toBe('Brand');
  });
});

describe('isFontFaceRule', () => {
  it('recognizes the rule by its legacy type constant', () => {
    expect(isFontFaceRule({ type: 5 } as unknown as CSSRule)).toBe(true);
    expect(isFontFaceRule({ type: 1 } as unknown as CSSRule)).toBe(false);
  });

  it('falls back to the constructor name when type is absent', () => {
    class CSSFontFaceRule {}
    expect(isFontFaceRule(new CSSFontFaceRule() as unknown as CSSRule)).toBe(true);
  });
});

describe('collectFontFaces', () => {
  it('collects rules from a readable sheet', () => {
    const doc = fakeDocument([
      {
        href: 'https://shop.example.com/site.css',
        cssRules: ruleList([
          { type: 1, selectorText: '.a' },
          fontFaceRule({ 'font-family': 'Brand', src: 'url(/f/brand.woff2)' }),
        ]),
      },
    ]);

    const inventory = collectFontFaces(doc);

    expect(inventory.faces).toHaveLength(1);
    expect(inventory.faces[0]?.family).toBe('Brand');
    expect(inventory.faces[0]?.href).toBe('https://shop.example.com/site.css');
    expect(inventory.unreadable).toEqual([]);
  });

  it('records a cross-origin sheet instead of failing the whole scan', () => {
    const hostile = {
      href: 'https://fonts.googleapis.com/css2?family=Inter',
      get cssRules(): CSSRuleList {
        const error = new Error('Cannot access rules');
        error.name = 'SecurityError';
        throw error;
      },
    };
    const readable = {
      href: null,
      cssRules: ruleList([fontFaceRule({ 'font-family': 'Local Brand', src: 'url(/f/a.woff2)' })]),
    };

    const inventory = collectFontFaces(fakeDocument([hostile, readable]));

    expect(inventory.faces.map((face) => face.family)).toEqual(['Local Brand']);
    expect(inventory.unreadable).toEqual([
      {
        href: 'https://fonts.googleapis.com/css2?family=Inter',
        reason: 'cross-origin',
        message: 'Cannot access rules',
      },
    ]);
  });

  it('distinguishes an unexpected failure from a cross-origin one', () => {
    const broken = {
      href: 'https://shop.example.com/broken.css',
      get cssRules(): CSSRuleList {
        throw new Error('boom');
      },
    };

    expect(collectFontFaces(fakeDocument([broken])).unreadable[0]?.reason).toBe('error');
  });

  it('finds rules nested inside @media and @supports', () => {
    const doc = fakeDocument([
      {
        href: null,
        cssRules: ruleList([
          {
            type: 4,
            cssRules: ruleList([
              {
                type: 12,
                cssRules: ruleList([
                  fontFaceRule({ 'font-family': 'Nested', src: 'url(/f/n.woff2)' }),
                ]),
              },
            ]),
          },
        ]),
      },
    ]);

    expect(collectFontFaces(doc).faces.map((face) => face.family)).toEqual(['Nested']);
  });

  it('follows @import into another sheet', () => {
    const imported = {
      href: 'https://shop.example.com/fonts.css',
      cssRules: ruleList([fontFaceRule({ 'font-family': 'Imported', src: 'url(/f/i.woff2)' })]),
    };
    const doc = fakeDocument([
      {
        href: 'https://shop.example.com/site.css',
        cssRules: ruleList([{ type: 3, styleSheet: imported }]),
      },
    ]);

    const inventory = collectFontFaces(doc);

    expect(inventory.faces.map((face) => face.family)).toEqual(['Imported']);
    expect(inventory.faces[0]?.href).toBe('https://shop.example.com/fonts.css');
  });

  it('does not loop forever on a circular @import', () => {
    const a: { href: string; cssRules: CSSRuleList } = {
      href: 'https://shop.example.com/a.css',
      cssRules: ruleList([]),
    };
    const b = {
      href: 'https://shop.example.com/b.css',
      cssRules: ruleList([{ type: 3, styleSheet: a }]),
    };
    a.cssRules = ruleList([
      { type: 3, styleSheet: b },
      fontFaceRule({ 'font-family': 'Cycled', src: 'url(/f/c.woff2)' }),
    ]);

    expect(collectFontFaces(fakeDocument([a])).faces.map((face) => face.family)).toEqual(['Cycled']);
  });

  it('includes constructed sheets adopted by the document', () => {
    // Design systems that render into shadow roots keep their @font-face here,
    // and these sheets never appear in document.styleSheets.
    const doc = fakeDocument(
      [],
      [
        {
          href: null,
          cssRules: ruleList([fontFaceRule({ 'font-family': 'Adopted', src: 'url(/f/a.woff2)' })]),
        },
      ],
    );

    expect(collectFontFaces(doc).faces.map((face) => face.family)).toEqual(['Adopted']);
  });

  it('reports a sheet that exposes no rules at all', () => {
    const inventory = collectFontFaces(fakeDocument([{ href: null, cssRules: null }]));

    expect(inventory.faces).toEqual([]);
    expect(inventory.unreadable[0]?.reason).toBe('error');
  });
});
