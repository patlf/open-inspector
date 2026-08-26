import { describe, expect, it } from 'vitest';
import type { BackdropStep } from './element-colors.js';
import {
  backdropAncestors,
  collectElementColors,
  compositeBackdrop,
  hasDirectText,
  readBackdropStep,
  resolveEffectiveBackground,
  scanColors,
} from './element-colors.js';
import type { Rgba } from './parse.js';

const RED: Rgba = { r: 255, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/** Computed styles are read property-by-property, so a partial cast is enough. */
function styleOf(properties: Partial<CSSStyleDeclaration>): CSSStyleDeclaration {
  return properties as CSSStyleDeclaration;
}

function step(overrides: Partial<BackdropStep> = {}): BackdropStep {
  return { color: TRANSPARENT, paint: 'none', opacity: 1, blended: false, ...overrides };
}

describe('scanColors', () => {
  it('finds the colour of every box-shadow layer', () => {
    const scan = scanColors(
      'rgba(0, 0, 0, 0.1) 0px 1px 2px 0px, rgb(255 0 0) 0px 0px 0px 1px inset',
    );

    expect(scan.tokens.map((token) => token.color)).toEqual([
      { r: 0, g: 0, b: 0, a: 0.1 },
      RED,
    ]);
  });

  it('finds gradient stops without being confused by direction keywords', () => {
    const scan = scanColors('linear-gradient(to right bottom, rgb(255, 0, 0) 0%, #0000ff 100%)');

    expect(scan.tokens.map((token) => token.color)).toEqual([RED, { r: 0, g: 0, b: 255, a: 1 }]);
  });

  it('descends into nested gradients and colour-mix', () => {
    const scan = scanColors('repeating-radial-gradient(circle, red 0 10px, color-mix(in oklab, blue, white) 10px 20px)');

    expect(scan.tokens).toHaveLength(3);
  });

  it('never reads a colour out of a url(), however tempting the filename', () => {
    // `tan`, `linen` and `plum` are all named colours; a scanner that walks
    // into url() invents a palette the page does not have.
    const scan = scanColors('url("/assets/tan-linen-plum.png?x=red")');

    expect(scan.tokens).toEqual([]);
  });

  it('survives a quoted parenthesis inside a url', () => {
    const scan = scanColors('url("logo(1).png"), linear-gradient(red, red)');

    expect(scan.tokens).toHaveLength(2);
  });

  it('does not treat every bare keyword as a colour', () => {
    const scan = scanColors('inset 0 1px 0 solid');

    expect(scan.tokens).toEqual([]);
    expect(scan.unreadable).toEqual([]);
  });

  it('reports colour functions it refuses rather than dropping them silently', () => {
    // Wide-gamut spaces, so nothing nested inside is separately readable.
    const scan = scanColors('linear-gradient(color(rec2020 1 0 0), color(display-p3 1 0 0))');

    expect(scan.tokens).toEqual([]);
    expect(scan.unreadable).toEqual(['color(rec2020 1 0 0)', 'color(display-p3 1 0 0)']);
  });

  it('resolves currentColor when the caller supplies one', () => {
    const scan = scanColors('currentcolor 0 1px 2px', { currentColor: RED });

    expect(scan.tokens.map((token) => token.color)).toEqual([RED]);
  });

  it('does not hang or throw on unbalanced or empty input', () => {
    expect(scanColors('').tokens).toEqual([]);
    expect(scanColors('linear-gradient(red, blue').tokens).toHaveLength(2);
    expect(scanColors('url("unterminated').tokens).toEqual([]);
    expect(scanColors('###').tokens).toEqual([]);
  });
});

describe('collectElementColors', () => {
  it('reads text and background colours', () => {
    const colors = collectElementColors(
      styleOf({ color: 'rgb(255, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)' }),
    );

    expect(colors.text).toEqual(RED);
    expect(colors.background).toEqual(TRANSPARENT);
  });

  it('ignores border colours on sides that paint nothing', () => {
    // Every element has a computed border-*-color even with no border at all;
    // counting them buries the palette in copies of the text colour.
    const colors = collectElementColors(
      styleOf({
        color: 'rgb(0, 0, 0)',
        borderTopColor: 'rgb(255, 0, 0)',
        borderTopWidth: '1px',
        borderTopStyle: 'solid',
        borderRightColor: 'rgb(255, 0, 0)',
        borderRightWidth: '0px',
        borderRightStyle: 'solid',
        borderBottomColor: 'rgb(255, 0, 0)',
        borderBottomWidth: '3px',
        borderBottomStyle: 'none',
        borderLeftColor: 'rgb(0, 0, 255)',
        borderLeftWidth: '2px',
        borderLeftStyle: 'dashed',
      }),
    );

    expect(colors.border).toEqual({
      top: RED,
      right: null,
      bottom: null,
      left: { r: 0, g: 0, b: 255, a: 1 },
    });
    expect(colors.usages.filter((usage) => usage.source === 'border')).toHaveLength(2);
  });

  it('records the longhand each border colour came from', () => {
    const colors = collectElementColors(
      styleOf({
        borderLeftColor: 'red',
        borderLeftWidth: '2px',
        borderLeftStyle: 'solid',
      }),
    );

    expect(colors.usages[0]).toEqual({
      color: RED,
      property: 'border-left-color',
      source: 'border',
      raw: 'red',
    });
  });

  it('ignores a hidden border even when it has a width', () => {
    const colors = collectElementColors(
      styleOf({ borderTopColor: 'red', borderTopWidth: '4px', borderTopStyle: 'hidden' }),
    );

    expect(colors.border.top).toBeNull();
  });

  it('reads outline only when one is painted, and never guesses at `auto`', () => {
    const painted = collectElementColors(
      styleOf({ outlineColor: 'red', outlineWidth: '2px', outlineStyle: 'solid' }),
    );
    const none = collectElementColors(
      styleOf({ outlineColor: 'red', outlineWidth: '2px', outlineStyle: 'none' }),
    );
    const auto = collectElementColors(
      styleOf({ outlineColor: 'auto', outlineWidth: '1px', outlineStyle: 'auto' }),
    );

    expect(painted.outline).toEqual(RED);
    expect(none.outline).toBeNull();
    expect(auto.outline).toBeNull();
    // The platform focus ring is not a CSS colour, so it is not an error either.
    expect(auto.unreadable).toEqual([]);
  });

  it('collects shadow and gradient colours with their provenance', () => {
    const colors = collectElementColors(
      styleOf({
        boxShadow: 'rgba(0, 0, 0, 0.2) 0px 2px 4px',
        backgroundImage: 'linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 0, 255))',
      }),
    );

    expect(colors.shadows).toEqual([{ r: 0, g: 0, b: 0, a: 0.2 }]);
    expect(colors.gradientStops).toHaveLength(2);
    expect(colors.usages.map((usage) => usage.source)).toEqual([
      'shadow',
      'gradient',
      'gradient',
    ]);
  });

  it('resolves currentColor in later properties from the element own colour', () => {
    // Firefox leaves `currentColor` unresolved in box-shadow.
    const colors = collectElementColors(
      styleOf({ color: 'rgb(255, 0, 0)', boxShadow: 'currentcolor 0 1px 2px' }),
    );

    expect(colors.shadows).toEqual([RED]);
  });

  it('counts declarations it cannot read instead of dropping them', () => {
    const colors = collectElementColors(styleOf({ color: 'color(display-p3 1 0 0)' }));

    expect(colors.text).toBeNull();
    expect(colors.unreadable).toEqual(['color(display-p3 1 0 0)']);
  });

  it('treats an empty style object as no colours rather than throwing', () => {
    const colors = collectElementColors(styleOf({}));

    expect(colors.usages).toEqual([]);
    expect(colors.unreadable).toEqual([]);
  });
});

describe('hasDirectText', () => {
  it('is true only for elements with their own non-whitespace text', () => {
    const withText = document.createElement('p');
    withText.textContent = 'hello';

    const whitespaceOnly = document.createElement('div');
    whitespaceOnly.textContent = '\n  ';

    const wrapperOnly = document.createElement('div');
    wrapperOnly.appendChild(withText.cloneNode(true));

    expect(hasDirectText(withText)).toBe(true);
    expect(hasDirectText(whitespaceOnly)).toBe(false);
    expect(hasDirectText(wrapperOnly)).toBe(false);
  });

  it('treats form controls as text-bearing even with no child nodes', () => {
    expect(hasDirectText(document.createElement('input'))).toBe(true);
    expect(hasDirectText(document.createElement('select'))).toBe(true);
  });
});

describe('readBackdropStep', () => {
  it('classifies what paints over the background colour', () => {
    expect(readBackdropStep(styleOf({ backgroundImage: 'none' })).paint).toBe('none');
    expect(readBackdropStep(styleOf({ backgroundImage: '' })).paint).toBe('none');
    expect(readBackdropStep(styleOf({ backgroundImage: 'linear-gradient(red, blue)' })).paint).toBe(
      'gradient',
    );
    expect(readBackdropStep(styleOf({ backgroundImage: 'url(hero.png)' })).paint).toBe('image');
    // An image on top of a gradient is still an image in the way that matters.
    expect(
      readBackdropStep(styleOf({ backgroundImage: 'url(a.png), linear-gradient(red, blue)' })).paint,
    ).toBe('image');
    expect(readBackdropStep(styleOf({ backgroundImage: 'paint(worklet)' })).paint).toBe('image');
  });

  it('flags anything that makes compositing unknowable', () => {
    expect(readBackdropStep(styleOf({ mixBlendMode: 'multiply' })).blended).toBe(true);
    expect(readBackdropStep(styleOf({ filter: 'blur(4px)' })).blended).toBe(true);
    expect(readBackdropStep(styleOf({ backdropFilter: 'saturate(2)' })).blended).toBe(true);
    expect(
      readBackdropStep(styleOf({ mixBlendMode: 'normal', filter: 'none', backdropFilter: 'none' }))
        .blended,
    ).toBe(false);
  });

  it('defaults opacity to 1 when it is missing or unreadable', () => {
    expect(readBackdropStep(styleOf({})).opacity).toBe(1);
    expect(readBackdropStep(styleOf({ opacity: '' })).opacity).toBe(1);
    expect(readBackdropStep(styleOf({ opacity: '0.4' })).opacity).toBe(0.4);
  });
});

describe('compositeBackdrop', () => {
  it('stops at the first opaque layer', () => {
    const result = compositeBackdrop([
      step({ color: TRANSPARENT }),
      step({ color: WHITE }),
      step({ color: BLACK }),
    ]);

    expect(result).toEqual({ kind: 'resolved', color: WHITE, depth: 2, assumedCanvas: false });
  });

  it('composites translucent layers in order', () => {
    const result = compositeBackdrop([step({ color: { ...WHITE, a: 0.5 } }), step({ color: BLACK })]);

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.color).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
    }
  });

  it('falls through to the canvas colour and says so', () => {
    const result = compositeBackdrop([step(), step()]);

    expect(result).toEqual({ kind: 'resolved', color: WHITE, depth: 2, assumedCanvas: true });
  });

  it('uses a caller-supplied canvas colour, for dark color-scheme pages', () => {
    const result = compositeBackdrop([step({ color: { ...WHITE, a: 0.1 } })], {
      canvasColor: BLACK,
    });

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.color.r).toBeCloseTo(25.5, 1);
      expect(result.assumedCanvas).toBe(true);
    }
  });

  it('refuses to guess when a gradient shows through', () => {
    const result = compositeBackdrop([
      step({ color: { ...WHITE, a: 0.5 } }),
      step({ paint: 'gradient' }),
    ]);

    expect(result).toMatchObject({ kind: 'indeterminate', reason: 'gradient', depth: 1 });
    if (result.kind === 'indeterminate') {
      expect(result.partial).toEqual({ ...WHITE, a: 0.5 });
    }
  });

  it('refuses when an image shows through', () => {
    expect(compositeBackdrop([step({ paint: 'image' })])).toMatchObject({
      kind: 'indeterminate',
      reason: 'image',
      depth: 0,
      partial: null,
    });
  });

  it('ignores a gradient that sits behind something already opaque', () => {
    // The whole point of stopping early: a hero gradient two levels up cannot
    // affect an element sitting on an opaque card.
    const result = compositeBackdrop([step({ color: WHITE }), step({ paint: 'gradient' })]);

    expect(result).toMatchObject({ kind: 'resolved', color: WHITE });
  });

  it('refuses when a blend mode or filter is in play', () => {
    expect(compositeBackdrop([step({ color: WHITE, blended: true })])).toMatchObject({
      kind: 'indeterminate',
      reason: 'blend',
    });
  });

  it('refuses when a background colour could not be read', () => {
    expect(compositeBackdrop([step({ color: null })])).toMatchObject({
      kind: 'indeterminate',
      reason: 'unreadable',
    });
  });

  it('folds ancestor opacity into the layer alpha', () => {
    const result = compositeBackdrop([
      step({ color: WHITE, opacity: 0.5 }),
      step({ color: BLACK }),
    ]);

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.color).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
    }
  });

  it('says depth-limit rather than assuming the canvas when the chain was cut short', () => {
    const result = compositeBackdrop([step()], { chainTruncated: true });

    expect(result).toMatchObject({ kind: 'indeterminate', reason: 'depth-limit', depth: 1 });
  });

  it('resolves an empty chain to the canvas', () => {
    expect(compositeBackdrop([])).toEqual({
      kind: 'resolved',
      color: WHITE,
      depth: 0,
      assumedCanvas: true,
    });
  });
});

describe('backdropAncestors', () => {
  it('starts at the element itself and walks to the root', () => {
    const grandparent = document.createElement('section');
    const parent = document.createElement('div');
    const child = document.createElement('span');
    grandparent.appendChild(parent);
    parent.appendChild(child);
    document.body.appendChild(grandparent);

    const chain = backdropAncestors(child);

    expect(chain.slice(0, 3)).toEqual([child, parent, grandparent]);
    expect(chain.at(-1)).toBe(document.documentElement);

    grandparent.remove();
  });

  it('crosses a shadow boundary to the host', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    root.appendChild(inner);

    expect(backdropAncestors(inner).slice(0, 2)).toEqual([inner, host]);

    host.remove();
  });

  it('honours the depth limit', () => {
    let deepest = document.createElement('div');
    const outermost = deepest;
    for (let index = 0; index < 10; index += 1) {
      const next = document.createElement('div');
      deepest.appendChild(next);
      deepest = next;
    }
    document.body.appendChild(outermost);

    expect(backdropAncestors(deepest, 3)).toHaveLength(3);

    outermost.remove();
  });
});

describe('resolveEffectiveBackground', () => {
  function buildTree(): { card: Element; page: Element } {
    const page = document.createElement('div');
    const card = document.createElement('div');
    page.appendChild(card);
    document.body.appendChild(page);
    return { card, page };
  }

  it('walks up past transparent ancestors to the first opaque background', () => {
    const { card, page } = buildTree();

    const result = resolveEffectiveBackground(card, {
      readStyle: (element) =>
        styleOf(
          element === card
            ? { backgroundColor: 'rgba(0, 0, 0, 0)' }
            : { backgroundColor: 'rgb(255, 255, 255)' },
        ),
    });

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.color).toEqual(WHITE);
      expect(result.assumedCanvas).toBe(false);
      expect(result.chain).toEqual([card, page]);
    }

    page.remove();
  });

  it('composites a translucent element over its opaque ancestor', () => {
    const { card, page } = buildTree();

    const result = resolveEffectiveBackground(card, {
      readStyle: (element) =>
        styleOf(
          element === card
            ? { backgroundColor: 'rgba(255, 255, 255, 0.5)' }
            : { backgroundColor: 'rgb(0, 0, 0)' },
        ),
    });

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.color).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
    }

    page.remove();
  });

  it('points at the element that made the answer unknowable', () => {
    const { card, page } = buildTree();

    const result = resolveEffectiveBackground(card, {
      readStyle: (element) =>
        styleOf(
          element === card
            ? { backgroundColor: 'rgba(0, 0, 0, 0)' }
            : { backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'linear-gradient(red, blue)' },
        ),
    });

    expect(result.kind).toBe('indeterminate');
    if (result.kind === 'indeterminate') {
      expect(result.reason).toBe('gradient');
      expect(result.blockedBy).toBe(page);
      expect(result.chain).toEqual([card]);
    }

    page.remove();
  });

  it('reports the canvas assumption when the whole chain is transparent', () => {
    const { card, page } = buildTree();

    const result = resolveEffectiveBackground(card, {
      readStyle: () => styleOf({ backgroundColor: 'transparent' }),
    });

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.color).toEqual(WHITE);
      expect(result.assumedCanvas).toBe(true);
    }

    page.remove();
  });

  it('stops honestly when the depth limit cuts the chain short', () => {
    const { card, page } = buildTree();

    const result = resolveEffectiveBackground(card, {
      maxDepth: 1,
      readStyle: () => styleOf({ backgroundColor: 'transparent' }),
    });

    expect(result).toMatchObject({ kind: 'indeterminate', reason: 'depth-limit' });

    page.remove();
  });
});
