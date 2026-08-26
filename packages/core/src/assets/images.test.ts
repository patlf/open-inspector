import { beforeEach, describe, expect, it } from 'vitest';
import {
  harvestCssImages,
  readAltText,
  readCanvasElement,
  readCssImageProperties,
  readImageElement,
  readInputImage,
  readNaturalSize,
} from './images.js';
import type { CssImageProperties } from './images.js';

const BASE = 'https://example.com/blog/';

/** Fake a browser-only property the DOM implementation under test does not set. */
function define(element: Element, property: string, value: unknown): void {
  Object.defineProperty(element, property, { value, configurable: true });
}

function computedStyle(values: Record<string, string>): CSSStyleDeclaration {
  return {
    getPropertyValue: (property: string) => values[property] ?? '',
  } as unknown as CSSStyleDeclaration;
}

const NO_CSS_IMAGES: CssImageProperties = {
  backgroundImage: '',
  borderImageSource: '',
  listStyleImage: '',
  maskImage: '',
  content: '',
};

describe('readImageElement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reports every srcset candidate, not just src', () => {
    document.body.innerHTML = `
      <img src="fallback.jpg" srcset="small.jpg 400w, large.jpg 1600w" sizes="50vw" alt="A cat">
    `;
    const image = document.querySelector('img')!;
    define(image, 'currentSrc', 'https://example.com/blog/fallback.jpg');
    const { image: record, references } = readImageElement(image, BASE);

    expect(record.src).toBe('https://example.com/blog/fallback.jpg');
    expect(record.candidates.map((candidate) => candidate.url)).toEqual([
      'https://example.com/blog/small.jpg',
      'https://example.com/blog/large.jpg',
    ]);
    expect(record.sizes).toBe('50vw');
    expect(record.choice).toEqual({
      status: 'src-fallback',
      url: 'https://example.com/blog/fallback.jpg',
    });
    expect(references).toHaveLength(3);
  });

  it('identifies which candidate the browser actually loaded', () => {
    document.body.innerHTML = '<img src="a.png" srcset="a.png 1x, a@2x.png 2x">';
    const image = document.querySelector('img')!;
    define(image, 'currentSrc', 'https://example.com/blog/a@2x.png');

    const { image: record, references } = readImageElement(image, BASE);

    expect(record.choice).toMatchObject({ status: 'chosen', matchedBy: 'current-src' });
    const chosen = references.filter((reference) => reference.usage.chosen);
    expect(chosen).toHaveLength(1);
    expect(chosen[0]?.raw).toBe('a@2x.png');
  });

  it('gathers the sibling <source> candidates of a <picture>', () => {
    document.body.innerHTML = `
      <picture>
        <source srcset="hero.avif 1x, hero@2x.avif 2x" type="image/avif" media="(min-width: 800px)">
        <source srcset="hero.webp" type="image/webp">
        <img src="hero.jpg" alt="">
      </picture>
    `;
    const image = document.querySelector('img')!;
    const { image: record, references } = readImageElement(image, BASE);

    expect(record.isPictureChild).toBe(true);
    expect(record.candidates).toHaveLength(3);
    expect(record.candidates[0]).toMatchObject({
      origin: 'picture-source',
      media: '(min-width: 800px)',
      type: 'image/avif',
      descriptor: '1x',
    });
    // The declared type travels with the reference so an extensionless CDN
    // URL still classifies correctly.
    expect(references.find((reference) => reference.raw === 'hero.webp')?.mimeHint).toBe(
      'image/webp',
    );
  });

  it('records a currentSrc that matches nothing in the markup', () => {
    // A lazy-loader that swapped src after load, or a rewriting service worker.
    document.body.innerHTML = '<img src="placeholder.gif" srcset="a.png 1x">';
    const image = document.querySelector('img')!;
    define(image, 'currentSrc', 'https://cdn.example.net/real.webp');

    const { image: record, references } = readImageElement(image, BASE);

    expect(record.choice).toMatchObject({ reason: 'current-src-not-in-candidates' });
    expect(references.map((reference) => reference.usage.via)).toContain('img-current-src');
  });

  it('keeps a broken src visible as authored rather than dropping it', () => {
    document.body.innerHTML = '<img src="#">';
    const record = readImageElement(document.querySelector('img')!, BASE).image;
    expect(record.src).toBe('#');
  });

  it('reports intrinsic size as not-loaded rather than as zero', () => {
    document.body.innerHTML = '<img src="a.png">';
    expect(readImageElement(document.querySelector('img')!, BASE).image.natural).toEqual({
      known: false,
      reason: 'not-loaded',
    });
  });

  it('reports a decoded size when the browser has one', () => {
    document.body.innerHTML = '<img src="a.png">';
    const image = document.querySelector('img')!;
    define(image, 'naturalWidth', 1600);
    define(image, 'naturalHeight', 900);

    expect(readImageElement(image, BASE).image.natural).toEqual({
      known: true,
      width: 1600,
      height: 900,
    });
  });

  it('carries alt and loading through', () => {
    document.body.innerHTML = '<img src="a.png" alt="Logo" loading="lazy" decoding="async">';
    const record = readImageElement(document.querySelector('img')!, BASE).image;

    expect(record.alt).toEqual({ state: 'present', text: 'Logo' });
    expect(record.loading).toBe('lazy');
    expect(record.decoding).toBe('async');
  });
});

describe('readAltText', () => {
  it('separates decorative from missing', () => {
    document.body.innerHTML = '<img alt=""><img alt="  "><img alt="Cat"><img>';
    const images = Array.from(document.querySelectorAll('img'));

    expect(readAltText(images[0]!)).toEqual({ state: 'empty-decorative' });
    expect(readAltText(images[1]!)).toEqual({ state: 'empty-decorative' });
    expect(readAltText(images[2]!)).toEqual({ state: 'present', text: 'Cat' });
    expect(readAltText(images[3]!)).toEqual({ state: 'missing' });
  });
});

describe('readNaturalSize', () => {
  it('says unavailable when the property is not implemented at all', () => {
    const fake = { naturalWidth: undefined, naturalHeight: undefined } as unknown as HTMLImageElement;
    expect(readNaturalSize(fake)).toEqual({ known: false, reason: 'unavailable' });
  });
});

describe('readCanvasElement', () => {
  it('records the canvas as present but only exportable by reading pixels', () => {
    document.body.innerHTML = '<canvas id="chart" width="800" height="400"></canvas>';
    const canvas = readCanvasElement(document.querySelector('canvas')!);

    expect(canvas).toMatchObject({
      element: 'canvas#chart',
      width: 800,
      height: 400,
      exportability: 'requires-pixel-read',
      crossOriginTaint: 'unknown',
    });
  });
});

describe('readCssImageProperties', () => {
  it('reads the properties that can hold an image', () => {
    const style = computedStyle({
      'background-image': 'url(bg.png)',
      'border-image-source': 'url(frame.svg)',
      'list-style-image': 'url(bullet.gif)',
      content: '"hello"',
    });

    expect(readCssImageProperties(style)).toEqual({
      backgroundImage: 'url(bg.png)',
      borderImageSource: 'url(frame.svg)',
      listStyleImage: 'url(bullet.gif)',
      maskImage: '',
      content: '"hello"',
    });
  });

  it('falls back to the prefixed mask property', () => {
    const style = computedStyle({ '-webkit-mask-image': 'url(m.png)' });
    expect(readCssImageProperties(style).maskImage).toBe('url(m.png)');
  });

  it('survives a style object that throws', () => {
    const hostile = {
      getPropertyValue: () => {
        throw new Error('detached');
      },
    } as unknown as CSSStyleDeclaration;

    expect(readCssImageProperties(hostile)).toEqual(NO_CSS_IMAGES);
  });
});

describe('harvestCssImages', () => {
  it('reports every layer of a multi-background', () => {
    const references = harvestCssImages(
      {
        ...NO_CSS_IMAGES,
        backgroundImage: 'url(top.png), linear-gradient(red, blue), url("bottom.jpg")',
      },
      { element: 'div.hero', pseudoElement: null },
    );

    expect(references.map((reference) => reference.raw)).toEqual(['top.png', 'bottom.jpg']);
    expect(references[0]?.usage).toMatchObject({
      via: 'css-background-image',
      element: 'div.hero',
      property: 'background-image',
    });
  });

  it('keeps image-set descriptors and declared types', () => {
    const references = harvestCssImages(
      { ...NO_CSS_IMAGES, backgroundImage: 'image-set(url(a.avif) type("image/avif") 1x, url(b.png) 2x)' },
      { element: 'i.icon', pseudoElement: null },
    );

    expect(references.map((reference) => [reference.raw, reference.usage.descriptor, reference.mimeHint])).toEqual([
      ['a.avif', '1x', 'image/avif'],
      ['b.png', '2x', null],
    ]);
  });

  it('tags a pseudo-element background with where it came from', () => {
    const references = harvestCssImages(
      { ...NO_CSS_IMAGES, content: 'url(icon.svg)' },
      { element: 'a.link', pseudoElement: '::before' },
    );

    expect(references[0]?.usage).toMatchObject({ via: 'css-content', context: '::before' });
  });

  it('ignores gradients, none, and text content', () => {
    const references = harvestCssImages(
      {
        ...NO_CSS_IMAGES,
        backgroundImage: 'linear-gradient(red, blue)',
        listStyleImage: 'none',
        content: '"url(not-a-file.png)"',
      },
      { element: 'p', pseudoElement: null },
    );

    expect(references).toEqual([]);
  });
});

describe('readInputImage', () => {
  it('harvests the submit-button image form controls still use', () => {
    document.body.innerHTML = '<input type="image" src="go.png" alt="Go">';
    const reference = readInputImage(document.querySelector('input')!);
    expect(reference).toMatchObject({ raw: 'go.png', kindHint: 'image' });
    expect(reference?.usage.via).toBe('input-image-src');
  });

  it('returns nothing when there is no src', () => {
    document.body.innerHTML = '<input type="image">';
    expect(readInputImage(document.querySelector('input')!)).toBeNull();
  });
});
