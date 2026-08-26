import { describe, expect, it } from 'vitest';
import {
  collectMediaRules,
  composeNestedSelector,
  discoverBreakpoints,
  parseMediaCondition,
  parseMediaFeature,
  selectBreakpointsForElement,
  stripPseudoElements,
  type CssRuleLike,
  type StyleSheetLike,
} from './breakpoints.js';

function styleRule(selectorText: string, properties: string[], nested: CssRuleLike[] = []): CssRuleLike {
  return {
    selectorText,
    style: { length: properties.length, item: (index: number) => properties[index] ?? '' },
    cssRules: nested,
  };
}

/** Declarations inside a nested `@media`, which the CSSOM exposes without a selector. */
function nestedDeclarations(properties: string[]): CssRuleLike {
  return { style: { length: properties.length, item: (index: number) => properties[index] ?? '' } };
}

function mediaRule(mediaText: string, rules: CssRuleLike[]): CssRuleLike {
  return { media: { mediaText }, conditionText: mediaText, cssRules: rules };
}

function containerRule(name: string, query: string, rules: CssRuleLike[]): CssRuleLike {
  return { containerName: name, containerQuery: query, cssRules: rules };
}

function sheet(href: string | null, rules: CssRuleLike[]): StyleSheetLike {
  return { href, cssRules: rules };
}

function crossOriginSheet(href: string): StyleSheetLike {
  return {
    href,
    get cssRules(): ArrayLike<CssRuleLike> {
      const error = new Error('Cannot access rules');
      error.name = 'SecurityError';
      throw error;
    },
  };
}

describe('parseMediaFeature', () => {
  it('parses the classic min/max syntax', () => {
    expect(parseMediaFeature('min-width: 768px')).toEqual([
      { kind: 'min-width', px: 768, raw: 'min-width: 768px', approximate: false },
    ]);
    expect(parseMediaFeature('max-width: 599.98px')[0]).toMatchObject({
      kind: 'max-width',
      px: 599.98,
    });
  });

  it('converts em breakpoints and flags them as approximate', () => {
    expect(parseMediaFeature('min-width: 48em')).toEqual([
      { kind: 'min-width', px: 768, raw: 'min-width: 48em', approximate: true },
    ]);
  });

  it('parses range syntax in both directions', () => {
    expect(parseMediaFeature('width >= 768px')[0]).toMatchObject({ kind: 'min-width', px: 768 });
    expect(parseMediaFeature('768px <= width')[0]).toMatchObject({ kind: 'min-width', px: 768 });
    expect(parseMediaFeature('width < 600px')[0]).toMatchObject({ kind: 'max-width', px: 600 });
  });

  it('parses a two-sided range as two features', () => {
    expect(parseMediaFeature('400px <= width <= 900px')).toEqual([
      { kind: 'min-width', px: 400, raw: '400px <= width <= 900px', approximate: false },
      { kind: 'max-width', px: 900, raw: '400px <= width <= 900px', approximate: false },
    ]);
  });

  it('parses preferences and orientation', () => {
    expect(parseMediaFeature('prefers-color-scheme: dark')).toEqual([
      { kind: 'preference', name: 'prefers-color-scheme', value: 'dark', raw: 'prefers-color-scheme: dark' },
    ]);
    expect(parseMediaFeature('orientation: landscape')[0]).toMatchObject({
      kind: 'orientation',
      value: 'landscape',
    });
    expect(parseMediaFeature('prefers-reduced-motion: reduce')[0]).toMatchObject({
      kind: 'preference',
    });
  });

  it('keeps features it cannot model instead of dropping them', () => {
    expect(parseMediaFeature('min-resolution: 2dppx')).toEqual([
      { kind: 'other', raw: 'min-resolution: 2dppx' },
    ]);
    expect(parseMediaFeature('hover')).toEqual([{ kind: 'other', raw: 'hover' }]);
  });
});

describe('parseMediaCondition', () => {
  it('separates the media type from the features', () => {
    expect(parseMediaCondition('screen and (min-width: 768px)')).toEqual([
      { kind: 'min-width', px: 768, raw: 'min-width: 768px', approximate: false },
      { kind: 'media-type', value: 'screen', raw: 'screen' },
    ]);
  });

  it('parses several features in one condition', () => {
    const features = parseMediaCondition('(min-width: 768px) and (max-width: 1023px)');
    expect(features.map((feature) => feature.kind)).toEqual(['min-width', 'max-width']);
  });

  it('recurses into grouped conditions', () => {
    const features = parseMediaCondition('not ((min-width: 400px) and (orientation: portrait))');
    expect(features.map((feature) => feature.kind)).toEqual(['min-width', 'orientation']);
  });

  it('honours a custom root font size', () => {
    expect(parseMediaCondition('(min-width: 40em)', 10)[0]).toMatchObject({ px: 400 });
  });
});

describe('composeNestedSelector / stripPseudoElements', () => {
  it('substitutes the ampersand with an :is() of the parent', () => {
    expect(composeNestedSelector('.card, .panel', '& .title')).toBe(':is(.card, .panel) .title');
    expect(composeNestedSelector('.card', '&:hover')).toBe(':is(.card):hover');
  });

  it('treats a nested selector with no ampersand as a descendant', () => {
    expect(composeNestedSelector('.card', '.title')).toBe(':is(.card) .title');
  });

  it('leaves top-level selectors alone', () => {
    expect(composeNestedSelector(null, '.card')).toBe('.card');
    expect(composeNestedSelector('', '.card')).toBe('.card');
  });

  it('drops pseudo-elements so the rule can still be matched to its element', () => {
    expect(stripPseudoElements('.card::before')).toBe('.card');
    expect(stripPseudoElements('.a::part(button)')).toBe('.a');
    expect(stripPseudoElements('li:before')).toBe('li');
    expect(stripPseudoElements('.card:hover')).toBe('.card:hover');
  });
});

describe('collectMediaRules', () => {
  it('finds media rules nested inside other grouping rules', () => {
    const scan = collectMediaRules([
      sheet('https://site.test/app.css', [
        // @layer components { @media (min-width: 768px) { .card { ... } } }
        {
          cssRules: [
            mediaRule('(min-width: 768px)', [
              styleRule('.card', ['grid-template-columns', 'padding']),
            ]),
          ],
        },
      ]),
    ]);

    expect(scan.rules).toHaveLength(1);
    expect(scan.rules[0]).toMatchObject({
      kind: 'media',
      condition: '(min-width: 768px)',
      href: 'https://site.test/app.css',
      blocks: [{ selector: '.card', properties: ['grid-template-columns', 'padding'] }],
    });
  });

  it('composes selectors for rules nested under CSS nesting', () => {
    const scan = collectMediaRules([
      sheet(null, [
        styleRule('.card', ['color'], [
          mediaRule('(min-width: 900px)', [
            nestedDeclarations(['padding']),
            styleRule('& .title', ['font-size']),
          ]),
        ]),
      ]),
    ]);

    expect(scan.rules[0]?.blocks).toEqual([
      { selector: '.card', properties: ['padding'] },
      { selector: ':is(.card) .title', properties: ['font-size'] },
    ]);
  });

  it('records container queries as their own kind', () => {
    const scan = collectMediaRules([
      sheet(null, [containerRule('sidebar', '(min-width: 400px)', [styleRule('.card', ['display'])])]),
    ]);

    expect(scan.rules[0]).toMatchObject({
      kind: 'container',
      condition: '(min-width: 400px)',
      containerName: 'sidebar',
    });
  });

  it('records an unreadable cross-origin sheet instead of throwing', () => {
    const scan = collectMediaRules([
      crossOriginSheet('https://cdn.other/app.css'),
      sheet(null, [mediaRule('(min-width: 768px)', [styleRule('.card', ['padding'])])]),
    ]);

    expect(scan.unreadable).toEqual([
      {
        href: 'https://cdn.other/app.css',
        reason: 'cross-origin',
        message: 'Cannot access rules',
      },
    ]);
    // The scan must keep going: the readable sheet still contributes.
    expect(scan.rules).toHaveLength(1);
    expect(scan.styleSheetCount).toBe(2);
  });

  it('records a sheet that exposed no rules as unreadable for an unknown reason', () => {
    const scan = collectMediaRules([{ href: 'https://site.test/late.css' }]);
    expect(scan.unreadable[0]).toMatchObject({ reason: 'unknown' });
  });

  it('follows @import into another sheet, and reports it when that one is opaque', () => {
    const scan = collectMediaRules([
      sheet(null, [
        { styleSheet: sheet('imported.css', [mediaRule('print', [styleRule('.a', ['display'])])]) },
        { styleSheet: crossOriginSheet('https://cdn.other/imported.css') },
      ]),
    ]);

    expect(scan.rules).toHaveLength(1);
    expect(scan.rules[0]?.href).toBe('imported.css');
    expect(scan.unreadable).toHaveLength(1);
  });

  it('merges repeated conditions within one sheet', () => {
    const scan = collectMediaRules([
      sheet(null, [
        mediaRule('(min-width: 768px)', [styleRule('.a', ['padding'])]),
        mediaRule('(min-width: 768px)', [styleRule('.b', ['margin'])]),
      ]),
    ]);

    expect(scan.rules).toHaveLength(1);
    expect(scan.rules[0]?.blocks).toHaveLength(2);
  });
});

describe('selectBreakpointsForElement', () => {
  const scan = collectMediaRules([
    sheet('https://site.test/app.css', [
      mediaRule('(min-width: 768px)', [styleRule('.sidebar', ['display'])]),
      mediaRule('(max-width: 480px)', [styleRule('.card', ['padding', 'font-size'])]),
      mediaRule('(min-width: 1200px)', [styleRule('.unrelated', ['width'])]),
      mediaRule('print', [styleRule('.card', ['color'])]),
      containerRule('sidebar', '(min-width: 400px)', [styleRule('.card', ['flex-direction'])]),
    ]),
    sheet('https://site.test/theme.css', [
      mediaRule('(min-width: 768px)', [styleRule('.card', ['gap'])]),
    ]),
  ]);

  const matchesCardOrSidebar = (selector: string): boolean =>
    selector === '.card' || selector === '.sidebar';

  it('keeps only the rules that touch this element or an ancestor', () => {
    const report = selectBreakpointsForElement(scan, matchesCardOrSidebar);
    expect(report.breakpoints.map((breakpoint) => breakpoint.condition)).toEqual([
      '(min-width: 400px)',
      '(max-width: 480px)',
      '(min-width: 768px)',
      'print',
    ]);
    expect(report.scanned.conditionalRules).toBe(6);
    expect(report.scanned.matched).toBe(4);
  });

  it('merges the same condition across stylesheets', () => {
    const report = selectBreakpointsForElement(scan, matchesCardOrSidebar);
    const at768 = report.breakpoints.find((breakpoint) => breakpoint.pixelValue === 768);

    expect(at768?.properties).toEqual(['display', 'gap']);
    expect(at768?.selectors).toEqual(['.sidebar', '.card']);
    expect(at768?.sources).toEqual(['https://site.test/app.css', 'https://site.test/theme.css']);
  });

  it('reports whether each breakpoint is currently active', () => {
    const report = selectBreakpointsForElement(scan, matchesCardOrSidebar, {
      evaluate: (condition) => condition === '(min-width: 768px)',
    });

    const at768 = report.breakpoints.find((breakpoint) => breakpoint.pixelValue === 768);
    expect(at768?.matches).toBe('yes');
    expect(at768?.summary).toBe('viewport ≥ 768px (active now) — changes display, gap');

    const at480 = report.breakpoints.find((breakpoint) => breakpoint.pixelValue === 480);
    expect(at480?.matches).toBe('no');
  });

  it('will not claim to know whether a container query matches', () => {
    const report = selectBreakpointsForElement(scan, matchesCardOrSidebar, {
      evaluate: () => true,
    });
    const container = report.breakpoints.find((breakpoint) => breakpoint.kind === 'container');

    expect(container?.matches).toBe('unknown');
    expect(container?.containerName).toBe('sidebar');
    expect(container?.summary).toContain('cannot be evaluated from here');
  });

  it('sorts by pixel value and pushes non-dimensional conditions last', () => {
    const report = selectBreakpointsForElement(scan, matchesCardOrSidebar);
    expect(report.breakpoints[report.breakpoints.length - 1]?.condition).toBe('print');
  });

  it('says how much it scanned when nothing matches', () => {
    const report = selectBreakpointsForElement(scan, () => false);
    expect(report.breakpoints).toEqual([]);
    expect(report.summary).toContain('no breakpoints affect this element');
    expect(report.summary).toContain(String.raw`6 conditional rule(s) scanned`);
  });

  it('warns that the answer is incomplete when a stylesheet was unreadable', () => {
    const partial = collectMediaRules([
      crossOriginSheet('https://cdn.other/app.css'),
      sheet(null, [mediaRule('(min-width: 768px)', [styleRule('.card', ['padding'])])]),
    ]);

    const report = selectBreakpointsForElement(partial, matchesCardOrSidebar);
    expect(report.summary).toContain('could not be read');
    expect(report.summary).toContain('may be incomplete');
    expect(report.unreadable).toHaveLength(1);
  });
});

describe('discoverBreakpoints', () => {
  it('matches rules against the element and its ancestors', () => {
    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    const card = document.createElement('div');
    card.className = 'card';
    sidebar.append(card);

    const doc = {
      styleSheets: [
        sheet(null, [
          // Matches an ancestor: still this element's breakpoint.
          mediaRule('(min-width: 768px)', [styleRule('.sidebar', ['display'])]),
          // Matches the element itself, through a pseudo-element rule.
          mediaRule('(max-width: 480px)', [styleRule('.card::after', ['content'])]),
          mediaRule('(min-width: 1400px)', [styleRule('.nowhere', ['width'])]),
        ]),
      ],
    } as unknown as Document;

    const view = {
      matchMedia: (condition: string) => ({ matches: condition.includes('768') }),
    } as unknown as Window;

    const report = discoverBreakpoints(card, { document: doc, view });

    expect(report.breakpoints.map((breakpoint) => breakpoint.pixelValue)).toEqual([480, 768]);
    expect(report.breakpoints[1]?.matches).toBe('yes');
    expect(report.breakpoints[0]?.properties).toEqual(['content']);
  });

  it('survives selectors the browser cannot parse', () => {
    const card = document.createElement('div');
    card.className = 'card';

    const doc = {
      styleSheets: [
        sheet(null, [
          mediaRule('(min-width: 768px)', [
            styleRule('.card:-moz-broken((', ['color']),
            styleRule('.card', ['padding']),
          ]),
        ]),
      ],
    } as unknown as Document;

    const view = { matchMedia: () => ({ matches: false }) } as unknown as Window;

    const report = discoverBreakpoints(card, { document: doc, view });
    expect(report.breakpoints).toHaveLength(1);
    expect(report.breakpoints[0]?.properties).toEqual(['padding']);
  });

  it('degrades to unknown when matchMedia itself throws', () => {
    const card = document.createElement('div');
    card.className = 'card';

    const doc = {
      styleSheets: [sheet(null, [mediaRule('(min-width: 768px)', [styleRule('.card', ['gap'])])])],
    } as unknown as Document;

    const view = {
      matchMedia: () => {
        throw new Error('not supported');
      },
    } as unknown as Window;

    expect(discoverBreakpoints(card, { document: doc, view }).breakpoints[0]?.matches).toBe(
      'unknown',
    );
  });
});
