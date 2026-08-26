import { describe, expect, it } from 'vitest';
import type { RuleLike, StyleDeclarationLike, StyleSheetLike } from './collect.js';
import {
  buildStyleIndex,
  candidateEntries,
  classifyRule,
  collectElementRules,
  createElementMatcher,
  describeSheet,
  displayLayerName,
  elementKeys,
  matchEntries,
  rankLayers,
  readDeclarations,
  readInlineDeclarations,
  readSheetRules,
  selectorMatchKey,
  summarizeConditions,
} from './collect.js';

/*
 * The CSSOM is faked throughout. That is not a shortcut: no DOM implementation
 * outside a real browser gives you cascade layers, container queries, or a
 * stylesheet that throws `SecurityError` on `.cssRules` — and the last of those
 * is the single most important case in this file.
 */

interface Decl {
  readonly property: string;
  readonly value: string;
  readonly important?: boolean;
}

function styleBlock(entries: readonly Decl[]): StyleDeclarationLike {
  const find = (property: string): Decl | undefined =>
    entries.find((entry) => entry.property === property);
  return {
    length: entries.length,
    item: (index) => entries[index]?.property ?? '',
    getPropertyValue: (property) => find(property)?.value ?? '',
    getPropertyPriority: (property) => (find(property)?.important ? 'important' : ''),
  };
}

function styleRule(selectorText: string, entries: readonly Decl[], nested: RuleLike[] = []): RuleLike {
  return { type: 1, selectorText, style: styleBlock(entries), cssRules: nested };
}

function mediaRule(mediaText: string, rules: RuleLike[]): RuleLike {
  return { type: 4, media: { mediaText }, conditionText: mediaText, cssRules: rules };
}

function supportsRule(conditionText: string, rules: RuleLike[]): RuleLike {
  return { type: 12, conditionText, cssRules: rules };
}

function containerRule(containerQuery: string, rules: RuleLike[]): RuleLike {
  return { type: 0, containerName: '', containerQuery, cssRules: rules };
}

function layerBlock(name: string, rules: RuleLike[]): RuleLike {
  return { type: 0, name, cssRules: rules };
}

function layerStatement(names: readonly string[]): RuleLike {
  return { type: 0, nameList: names };
}

function keyframesRule(name: string, rules: RuleLike[]): RuleLike {
  return { type: 7, name, cssRules: rules };
}

function sheet(
  rules: RuleLike[],
  extras: { href?: string; ownerTag?: string; disabled?: boolean } = {},
): StyleSheetLike {
  return {
    href: extras.href ?? null,
    cssRules: rules,
    ownerNode: extras.ownerTag ? { tagName: extras.ownerTag } : null,
    disabled: extras.disabled ?? false,
  };
}

/** A sheet that behaves exactly like a cross-origin one. */
function crossOriginSheet(href: string): StyleSheetLike {
  return {
    href,
    get cssRules(): ArrayLike<RuleLike> {
      const error = new Error('Cannot access rules');
      error.name = 'SecurityError';
      throw error;
    },
  };
}

function indexOf(sheets: readonly StyleSheetLike[]) {
  return buildStyleIndex(sheets.map((item) => ({ sheet: item, kind: null })));
}

describe('readDeclarations', () => {
  it('reads properties, values and importance', () => {
    const block = styleBlock([
      { property: 'color', value: 'red' },
      { property: 'margin', value: '0', important: true },
    ]);

    expect(readDeclarations(block)).toEqual([
      { property: 'color', value: 'red', important: false },
      { property: 'margin', value: '0', important: true },
    ]);
  });

  it('returns nothing for a missing declaration block', () => {
    expect(readDeclarations(undefined)).toEqual([]);
  });

  it('skips blank property names rather than emitting empty rows', () => {
    const block: StyleDeclarationLike = {
      length: 2,
      item: (index) => (index === 0 ? '' : 'color'),
      getPropertyValue: () => 'red',
      getPropertyPriority: () => '',
    };
    expect(readDeclarations(block)).toEqual([{ property: 'color', value: 'red', important: false }]);
  });

  it('keeps custom properties', () => {
    const block = styleBlock([{ property: '--brand', value: '#09f' }]);
    expect(readDeclarations(block)[0]?.property).toBe('--brand');
  });
});

describe('readInlineDeclarations', () => {
  it('reads the style attribute of a real element', () => {
    const element = document.createElement('div');
    element.setAttribute('style', 'color: red');
    expect(readInlineDeclarations(element)).toContainEqual({
      property: 'color',
      value: 'red',
      important: false,
    });
  });

  it('returns nothing when there is no style attribute', () => {
    expect(readInlineDeclarations(document.createElement('div'))).toEqual([]);
  });
});

describe('describeSheet', () => {
  it('labels a linked sheet with its file name', () => {
    const origin = describeSheet(sheet([], { href: 'https://x.test/css/app.min.css?v=3' }), 0);
    expect(origin.kind).toBe('linked');
    expect(origin.label).toBe('app.min.css');
  });

  it('recognises a <style> block', () => {
    const origin = describeSheet(sheet([], { ownerTag: 'style' }), 1);
    expect(origin.kind).toBe('inline');
    expect(origin.label).toBe('<style>');
  });

  it('falls back to injected when there is no owner and no href', () => {
    const origin = describeSheet(sheet([]), 2);
    expect(origin.kind).toBe('injected');
    expect(origin.label).toBe('injected');
  });

  it('lets the caller override the classification for adopted sheets', () => {
    const origin = describeSheet(sheet([]), 3, 'adopted');
    expect(origin.kind).toBe('adopted');
    expect(origin.label).toBe('adopted');
  });

  it('survives an owner node that is not an element', () => {
    const origin = describeSheet({ href: null, cssRules: [], ownerNode: 'xml-stylesheet' }, 4);
    expect(origin.kind).toBe('injected');
  });
});

describe('readSheetRules', () => {
  it('reports a cross-origin sheet as unreadable instead of throwing', () => {
    const result = readSheetRules(crossOriginSheet('https://cdn.test/vendor.css'));
    expect('unreadable' in result).toBe(true);
    if ('unreadable' in result) {
      expect(result.unreadable.reason).toBe('security');
      expect(result.unreadable.href).toBe('https://cdn.test/vendor.css');
    }
  });

  it('distinguishes a non-security failure', () => {
    const broken: StyleSheetLike = {
      href: null,
      get cssRules(): ArrayLike<RuleLike> {
        throw new TypeError('boom');
      },
    };
    const result = readSheetRules(broken);
    expect('unreadable' in result && result.unreadable.reason).toBe('error');
  });

  it('treats a null rule list as empty', () => {
    expect(readSheetRules({ cssRules: null })).toEqual({ rules: [] });
  });
});

describe('classifyRule', () => {
  it('identifies the rule kinds the walker cares about', () => {
    expect(classifyRule(styleRule('.a', [])).kind).toBe('style');
    expect(classifyRule(mediaRule('print', [])).kind).toBe('condition');
    expect(classifyRule(supportsRule('(display: grid)', [])).kind).toBe('condition');
    expect(classifyRule(layerBlock('base', [])).kind).toBe('layer-block');
    expect(classifyRule(layerStatement(['a', 'b'])).kind).toBe('layer-statement');
    expect(classifyRule({ type: 3, styleSheet: sheet([]) }).kind).toBe('import');
  });

  it('never lets @keyframes children reach the selector matcher', () => {
    // `0% { }` has a keyText, not a selectorText, but the child rules would
    // still be walked if the parent were treated as a grouping rule.
    expect(classifyRule(keyframesRule('spin', [styleRule('0%', [])])).kind).toBe('ignore');
  });

  it('ignores @page, which has a selectorText but matches no element', () => {
    expect(classifyRule({ type: 6, selectorText: ':first', style: styleBlock([]) }).kind).toBe(
      'ignore',
    );
  });

  it('prefers the container query over the generic conditionText', () => {
    const shape = classifyRule(containerRule('(min-width: 400px)', []));
    expect(shape.kind === 'condition' && shape.condition.kind).toBe('container');
  });

  it('reads the media text rather than treating a media rule as @supports', () => {
    const shape = classifyRule(mediaRule('screen and (min-width: 40em)', []));
    expect(shape.kind === 'condition' && shape.condition.text).toBe('screen and (min-width: 40em)');
  });

  it('recurses into an unrecognised grouping rule but leaves its condition unknown', () => {
    const shape = classifyRule({ type: 0, cssRules: [styleRule('.a', [])] });
    expect(shape.kind).toBe('condition');
  });
});

describe('summarizeConditions', () => {
  it('reports excluded when any condition is known not to apply', () => {
    expect(
      summarizeConditions([
        { kind: 'media', text: 'print', applies: false },
        { kind: 'supports', text: '(display:grid)', applies: true },
      ]),
    ).toBe('excluded');
  });

  it('reports indeterminate when any condition cannot be evaluated', () => {
    expect(summarizeConditions([{ kind: 'container', text: '(width>0)', applies: null }])).toBe(
      'indeterminate',
    );
  });

  it('reports applies for an unconditional rule', () => {
    expect(summarizeConditions([])).toBe('applies');
  });
});

describe('rankLayers', () => {
  it('ranks layers by first declaration', () => {
    const ranks = rankLayers(['base', 'components']);
    expect((ranks.get('base') ?? 0) < (ranks.get('components') ?? 0)).toBe(true);
  });

  it('sorts a sublayer inside its parent, not after later top-level layers', () => {
    const ranks = rankLayers(['a', 'b', 'a.x']);
    expect((ranks.get('a.x') ?? 0) < (ranks.get('b') ?? 0)).toBe(true);
  });

  it('puts a layer above its own sublayers, as the implicit final sublayer rule requires', () => {
    const ranks = rankLayers(['a', 'a.x']);
    expect((ranks.get('a.x') ?? 0) < (ranks.get('a') ?? 0)).toBe(true);
  });

  it('creates intermediate layers named only through a sublayer', () => {
    const ranks = rankLayers(['a.x']);
    expect(ranks.has('a')).toBe(true);
  });
});

describe('displayLayerName', () => {
  it('names anonymous layers without pretending they are their parent', () => {
    expect(displayLayerName('anonymous#1')).toBe('(anonymous)');
    expect(displayLayerName('theme.anonymous#2')).toBe('theme.(anonymous)');
  });
});

describe('selectorMatchKey', () => {
  it('keys on the rightmost compound, not the leftmost', () => {
    expect(selectorMatchKey('#page .card')).toEqual({ kind: 'class', value: 'card' });
  });

  it('prefers an id over a class over a tag', () => {
    expect(selectorMatchKey('div.card#main')).toEqual({ kind: 'id', value: 'main' });
    expect(selectorMatchKey('div.card')).toEqual({ kind: 'class', value: 'card' });
    expect(selectorMatchKey('div')).toEqual({ kind: 'tag', value: 'div' });
  });

  it('lowercases tag keys so HTML and selector casing agree', () => {
    expect(selectorMatchKey('DIV')).toEqual({ kind: 'tag', value: 'div' });
  });

  it('refuses to key on anything inside a functional pseudo-class', () => {
    // `.b` is not required for `:not(.b)` to match, so keying on it would drop
    // rules that do apply.
    expect(selectorMatchKey(':not(.b)')).toEqual({ kind: 'universal' });
    expect(selectorMatchKey(':is(.a, .b)')).toEqual({ kind: 'universal' });
  });

  it('does not key on attribute selectors', () => {
    expect(selectorMatchKey('[data-open]')).toEqual({ kind: 'universal' });
  });
});

describe('buildStyleIndex', () => {
  it('flattens rules in document order across sheets', () => {
    const index = indexOf([
      sheet([styleRule('.a', [{ property: 'color', value: 'red' }])], { ownerTag: 'style' }),
      sheet([styleRule('.b', [{ property: 'color', value: 'blue' }])], { href: 'https://x/y.css' }),
    ]);

    expect(index.rules.map((rule) => rule.selectorText)).toEqual(['.a', '.b']);
    expect(index.rules.map((rule) => rule.order)).toEqual([0, 1]);
    expect(index.rules[1]?.sheet.label).toBe('y.css');
  });

  it('keeps going after a cross-origin sheet and reports how many it lost', () => {
    const index = indexOf([
      crossOriginSheet('https://cdn.test/a.css'),
      sheet([styleRule('.b', [{ property: 'color', value: 'blue' }])]),
    ]);

    expect(index.unreadable).toHaveLength(1);
    expect(index.unreadable[0]?.reason).toBe('security');
    expect(index.rules.map((rule) => rule.selectorText)).toEqual(['.b']);
    // The sheet is still listed, so the UI can name what it could not read.
    expect(index.sheets).toHaveLength(2);
  });

  it('skips disabled sheets, which contribute nothing to the cascade', () => {
    const index = indexOf([sheet([styleRule('.a', [{ property: 'color', value: 'red' }])], { disabled: true })]);
    expect(index.rules).toEqual([]);
  });

  it('drops rules with no declarations', () => {
    const index = indexOf([sheet([styleRule('.a', [])])]);
    expect(index.rules).toEqual([]);
  });

  it('records the at-rules a rule sits inside', () => {
    const index = indexOf([
      sheet([
        mediaRule('print', [
          supportsRule('(display: grid)', [styleRule('.a', [{ property: 'color', value: 'red' }])]),
        ]),
      ]),
    ]);

    expect(index.rules[0]?.conditions.map((condition) => condition.kind)).toEqual([
      'media',
      'supports',
    ]);
  });

  it('leaves conditions indeterminate when no evaluator is supplied', () => {
    const index = indexOf([sheet([mediaRule('print', [styleRule('.a', [{ property: 'color', value: 'red' }])])])]);
    expect(index.rules[0]?.conditionState).toBe('indeterminate');
  });

  it('marks a rule excluded when the evaluator rejects its media query', () => {
    const index = buildStyleIndex(
      [{ sheet: sheet([mediaRule('print', [styleRule('.a', [{ property: 'color', value: 'red' }])])]), kind: null }],
      { evaluateCondition: (kind, text) => (kind === 'media' ? text !== 'print' : null) },
    );
    expect(index.rules[0]?.conditionState).toBe('excluded');
  });

  it('never claims to know whether a container query applies', () => {
    const index = buildStyleIndex(
      [
        {
          sheet: sheet([containerRule('(min-width: 400px)', [styleRule('.a', [{ property: 'color', value: 'red' }])])]),
          kind: null,
        },
      ],
      { evaluateCondition: () => true },
    );
    expect(index.rules[0]?.conditions[0]?.applies).toBeNull();
    expect(index.rules[0]?.conditionState).toBe('indeterminate');
  });

  it('assigns layer ranks so that a later layer outranks an earlier one', () => {
    const index = indexOf([
      sheet([
        layerStatement(['base', 'theme']),
        layerBlock('theme', [styleRule('.a', [{ property: 'color', value: 'red' }])]),
        layerBlock('base', [styleRule('.a', [{ property: 'color', value: 'blue' }])]),
      ]),
    ]);

    const theme = index.rules[0]?.layer;
    const base = index.rules[1]?.layer;
    expect(theme?.name).toBe('theme');
    expect(base?.name).toBe('base');
    expect((base?.order ?? 0) < (theme?.order ?? 0)).toBe(true);
  });

  it('nests layer names declared inside another layer', () => {
    const index = indexOf([
      sheet([
        layerBlock('components', [
          layerBlock('button', [styleRule('.btn', [{ property: 'color', value: 'red' }])]),
        ]),
      ]),
    ]);
    expect(index.rules[0]?.layer?.name).toBe('components.button');
  });

  it('gives each anonymous layer its own rank', () => {
    const index = indexOf([
      sheet([
        layerBlock('', [styleRule('.a', [{ property: 'color', value: 'red' }])]),
        layerBlock('', [styleRule('.a', [{ property: 'color', value: 'blue' }])]),
      ]),
    ]);
    const first = index.rules[0]?.layer;
    const second = index.rules[1]?.layer;
    expect(first?.name).toBe('(anonymous)');
    expect(first?.order).not.toBe(second?.order);
  });

  it('leaves unlayered rules with a null layer', () => {
    const index = indexOf([sheet([styleRule('.a', [{ property: 'color', value: 'red' }])])]);
    expect(index.rules[0]?.layer).toBeNull();
  });

  it('rewrites & in nested rules so they can be matched at all', () => {
    const index = indexOf([
      sheet([
        styleRule('.card', [{ property: 'color', value: 'red' }], [
          styleRule('& .title', [{ property: 'color', value: 'blue' }]),
        ]),
      ]),
    ]);

    expect(index.rules[1]?.selectorText).toBe(':is(.card) .title');
    expect(index.rules[1]?.selectors[0]?.exact).toBe(true);
  });

  it('follows @import once and does not loop on a cycle', () => {
    const imported: StyleSheetLike = sheet([styleRule('.imported', [{ property: 'color', value: 'red' }])]);
    const root = sheet([{ type: 3, styleSheet: imported }, { type: 3, styleSheet: imported }]);

    const index = indexOf([root]);
    expect(index.rules.map((rule) => rule.selectorText)).toEqual(['.imported']);
    expect(index.rules[0]?.sheet.kind).toBe('imported');
  });

  it('can be told not to follow @import at all', () => {
    const imported = sheet([styleRule('.imported', [{ property: 'color', value: 'red' }])]);
    const index = buildStyleIndex([{ sheet: sheet([{ type: 3, styleSheet: imported }]), kind: null }], {
      followImports: false,
    });
    expect(index.rules).toEqual([]);
  });

  it('stops at maxRules and admits it truncated', () => {
    const rules = Array.from({ length: 50 }, (_unused, i) =>
      styleRule(`.c${i}`, [{ property: 'color', value: 'red' }]),
    );
    const index = buildStyleIndex([{ sheet: sheet(rules), kind: null }], { maxRules: 10 });

    expect(index.rules).toHaveLength(10);
    expect(index.truncated).toBe(true);
  });

  it('buckets each selector-list part by its own key', () => {
    const index = indexOf([sheet([styleRule('#main, .card, span', [{ property: 'color', value: 'red' }])])]);

    expect(index.selectorCount).toBe(3);
    expect(index.buckets.byId.get('main')).toHaveLength(1);
    expect(index.buckets.byClass.get('card')).toHaveLength(1);
    expect(index.buckets.byTag.get('span')).toHaveLength(1);
    expect(index.buckets.universal).toHaveLength(0);
  });

  it('strips the pseudo-element from the text it will hand to matches()', () => {
    const index = indexOf([sheet([styleRule('.card::before', [{ property: 'content', value: '""' }])])]);
    const selector = index.rules[0]?.selectors[0];
    expect(selector?.matchText).toBe('.card');
    expect(selector?.pseudoElement).toBe('::before');
  });
});

describe('candidateEntries', () => {
  const index = indexOf([
    sheet([
      styleRule('.card', [{ property: 'color', value: 'red' }]),
      styleRule('#main', [{ property: 'color', value: 'blue' }]),
      styleRule('span', [{ property: 'color', value: 'green' }]),
      styleRule(':not(.x)', [{ property: 'color', value: 'teal' }]),
      styleRule('.unrelated', [{ property: 'color', value: 'pink' }]),
    ]),
  ]);

  it('pulls only the buckets an element can reach', () => {
    const candidates = candidateEntries(index, {
      tagName: 'div',
      id: 'main',
      classNames: ['card'],
    });

    expect(candidates.map((entry) => entry.selector.selector).sort()).toEqual([
      '#main',
      '.card',
      ':not(.x)',
    ]);
  });

  it('always includes the universal bucket', () => {
    const candidates = candidateEntries(index, { tagName: 'p', id: null, classNames: [] });
    expect(candidates.map((entry) => entry.selector.selector)).toEqual([':not(.x)']);
  });

  it('returns candidates in document order', () => {
    const candidates = candidateEntries(index, {
      tagName: 'span',
      id: 'main',
      classNames: ['card', 'card'],
    });
    const orders = candidates.map((entry) => entry.rule.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });
});

describe('matchEntries', () => {
  const index = indexOf([
    sheet([
      styleRule('#main, .card', [{ property: 'color', value: 'red' }]),
      styleRule('.card::before', [{ property: 'content', value: '""' }]),
      styleRule('.other', [{ property: 'color', value: 'blue' }]),
    ]),
  ]);

  const all = [
    ...index.buckets.universal,
    ...(index.buckets.byId.get('main') ?? []),
    ...(index.buckets.byClass.get('card') ?? []),
    ...(index.buckets.byClass.get('other') ?? []),
  ];

  it('reports a rule once, carrying its most specific matching part', () => {
    const matched = matchEntries(all, (selector) => selector === '#main' || selector === '.card');
    const first = matched.find((match) => match.rule.id === 0);
    expect(matched.filter((match) => match.rule.id === 0)).toHaveLength(1);
    expect(first?.matched.selector).toBe('#main');
  });

  it('keeps pseudo-element matches as separate entries', () => {
    const matched = matchEntries(all, (selector) => selector === '.card');
    expect(matched.map((match) => match.pseudoElement)).toEqual([null, '::before']);
  });

  it('returns nothing when nothing matches', () => {
    expect(matchEntries(all, () => false)).toEqual([]);
  });
});

describe('createElementMatcher', () => {
  it('answers ordinary selectors', () => {
    const element = document.createElement('div');
    element.className = 'card';
    const matches = createElementMatcher(element);
    expect(matches('.card')).toBe(true);
    expect(matches('.other')).toBe(false);
  });

  it('treats a selector the engine rejects as a non-match instead of aborting', () => {
    const element = document.createElement('div');
    expect(createElementMatcher(element)(':::nonsense(')).toBe(false);
  });

  it('treats an empty selector as a non-match', () => {
    expect(createElementMatcher(document.createElement('div'))('')).toBe(false);
  });
});

describe('elementKeys', () => {
  it('lowercases the tag name and reads classes off classList', () => {
    const element = document.createElement('div');
    element.id = 'main';
    element.className = 'a b';
    expect(elementKeys(element)).toEqual({ tagName: 'div', id: 'main', classNames: ['a', 'b'] });
  });

  it('reports a missing id as null rather than an empty string', () => {
    expect(elementKeys(document.createElement('p')).id).toBeNull();
  });
});

describe('collectElementRules', () => {
  it('matches an element against a prebuilt index and reports what it could not read', () => {
    const index = indexOf([
      crossOriginSheet('https://cdn.test/a.css'),
      sheet([
        styleRule('.card', [{ property: 'color', value: 'red' }]),
        styleRule('.nope', [{ property: 'color', value: 'blue' }]),
      ]),
    ]);

    const element = document.createElement('div');
    element.className = 'card';
    element.setAttribute('style', 'color: green');

    const result = collectElementRules(element, index);

    expect(result.matched.map((match) => match.rule.selectorText)).toEqual(['.card']);
    expect(result.inline).toContainEqual({ property: 'color', value: 'green', important: false });
    expect(result.unreadableSheetCount).toBe(1);
  });

  it('tests far fewer selectors than the index holds', () => {
    const rules = Array.from({ length: 200 }, (_unused, i) =>
      styleRule(`.c${i}`, [{ property: 'color', value: 'red' }]),
    );
    const index = indexOf([sheet(rules)]);

    const element = document.createElement('div');
    element.className = 'c7';

    const result = collectElementRules(element, index);
    expect(result.candidatesTested).toBe(1);
    expect(result.matched).toHaveLength(1);
  });
});
