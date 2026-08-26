import { describe, expect, it } from 'vitest';
import type { Specificity } from './specificity.js';
import {
  INLINE_SPECIFICITY,
  ZERO_SPECIFICITY,
  compareSpecificity,
  computeSpecificity,
  formatSpecificity,
  maxSpecificity,
  resolveNestingSelector,
  scoreSelector,
  scoreSelectorList,
  splitPseudoElement,
  splitSelectorList,
  tokenizeSelector,
} from './specificity.js';

/** Shorthand so the expectations read like the DevTools badge. */
function score(selector: string): string {
  return formatSpecificity(computeSpecificity(selector));
}

describe('splitSelectorList', () => {
  it('splits on top-level commas only', () => {
    expect(splitSelectorList('a, b , c')).toEqual(['a', 'b', 'c']);
  });

  it('ignores commas inside functional pseudo-classes', () => {
    expect(splitSelectorList(':is(a, b), c')).toEqual([':is(a, b)', 'c']);
  });

  it('ignores commas inside attribute values', () => {
    expect(splitSelectorList('[title="a,b"], p')).toEqual(['[title="a,b"]', 'p']);
  });

  it('ignores commas inside nested parentheses', () => {
    expect(splitSelectorList(':not(:is(a, b)), c')).toEqual([':not(:is(a, b))', 'c']);
  });

  it('drops empty parts from trailing or doubled commas', () => {
    expect(splitSelectorList('a,,b,')).toEqual(['a', 'b']);
  });

  it('returns nothing for empty input', () => {
    expect(splitSelectorList('')).toEqual([]);
    expect(splitSelectorList('   ')).toEqual([]);
  });
});

describe('tokenizeSelector', () => {
  it('synthesizes descendant combinators from whitespace', () => {
    expect(tokenizeSelector('a b').map((token) => token.kind)).toEqual([
      'type',
      'combinator',
      'type',
    ]);
  });

  it('treats spaced and unspaced child combinators identically', () => {
    const spaced = tokenizeSelector('a > b').map((token) => `${token.kind}:${token.text}`);
    const tight = tokenizeSelector('a>b').map((token) => `${token.kind}:${token.text}`);
    expect(spaced).toEqual(tight);
  });

  it('does not emit a leading or trailing descendant combinator', () => {
    expect(tokenizeSelector('  a  ').map((token) => token.kind)).toEqual(['type']);
  });

  it('keeps a functional pseudo-class argument as raw text', () => {
    const [token] = tokenizeSelector(':is(a, .b)');
    expect(token?.kind).toBe('pseudo-class');
    expect(token?.name).toBe('is');
    expect(token?.argument).toBe('a, .b');
  });

  it('classifies legacy single-colon pseudo-elements as pseudo-elements', () => {
    expect(tokenizeSelector('p:before').map((token) => token.kind)).toEqual([
      'type',
      'pseudo-element',
    ]);
  });

  it('reads namespaced type selectors without counting the prefix', () => {
    expect(tokenizeSelector('svg|circle').map((token) => `${token.kind}:${token.name}`)).toEqual([
      'type:circle',
    ]);
  });

  it('distinguishes the column combinator from a namespace separator', () => {
    expect(tokenizeSelector('col || td').map((token) => token.text)).toEqual(['col', '||', 'td']);
  });

  it('survives an unterminated functional pseudo-class', () => {
    expect(() => tokenizeSelector(':is(.a')).not.toThrow();
    expect(tokenizeSelector(':is(.a').map((token) => token.kind)).toEqual(['pseudo-class']);
  });

  it('records offsets that slice back to the original text', () => {
    const selector = '.card > .title::before';
    for (const token of tokenizeSelector(selector)) {
      if (token.kind === 'combinator' && token.text === ' ') continue;
      expect(selector.slice(token.start, token.end)).toBe(token.text);
    }
  });
});

describe('computeSpecificity', () => {
  it('scores the textbook cases', () => {
    expect(score('*')).toBe('0,0,0,0');
    expect(score('li')).toBe('0,0,0,1');
    expect(score('ul li')).toBe('0,0,0,2');
    expect(score('ul ol + li')).toBe('0,0,0,3');
    expect(score('h1 + *[rel=up]')).toBe('0,0,1,1');
    expect(score('ul ol li.red')).toBe('0,0,1,3');
    expect(score('li.red.level')).toBe('0,0,2,1');
    expect(score('#x34y')).toBe('0,1,0,0');
    expect(score('#s12:not(FOO)')).toBe('0,1,0,1');
  });

  it('counts attribute selectors in the class column', () => {
    expect(score('a[href]')).toBe('0,0,1,1');
    expect(score('[data-a][data-b]')).toBe('0,0,2,0');
  });

  it('counts pseudo-elements in the type column, with either colon count', () => {
    expect(score('::before')).toBe('0,0,0,1');
    expect(score('p:before')).toBe('0,0,0,2');
    expect(score('p::first-letter')).toBe('0,0,0,2');
  });

  it('gives :where() zero weight no matter what it contains', () => {
    expect(score(':where(#a, .b, c)')).toBe('0,0,0,0');
    expect(score('.x:where(#a)')).toBe('0,0,1,0');
  });

  it('scores :is() and :not() as their most specific argument', () => {
    expect(score(':is(#a, .b)')).toBe('0,1,0,0');
    expect(score(':not(.a, #b)')).toBe('0,1,0,0');
    expect(score('a:not(.b)')).toBe('0,0,1,1');
  });

  it('scores :has() like :is(), which surprises people', () => {
    expect(score('.card:has(> #main)')).toBe('0,1,1,0');
  });

  it('scores vendor-prefixed :any() like :is()', () => {
    expect(score(':-webkit-any(.a, #b)')).toBe('0,1,0,0');
  });

  it('adds the "of" selector to :nth-child()', () => {
    expect(score('p:nth-child(2)')).toBe('0,0,1,1');
    expect(score(':nth-child(2n+1)')).toBe('0,0,1,0');
    expect(score(':nth-child(odd)')).toBe('0,0,1,0');
    expect(score(':nth-child(2n of .row)')).toBe('0,0,2,0');
    expect(score(':nth-last-child(1 of #main, .row)')).toBe('0,1,1,0');
  });

  it('does not mistake :nth-of-type for the "of" form', () => {
    expect(score('li:nth-of-type(3)')).toBe('0,0,1,1');
  });

  it('adds the argument to :host() and :host-context()', () => {
    expect(score(':host')).toBe('0,0,1,0');
    expect(score(':host(.dark)')).toBe('0,0,2,0');
    expect(score(':host-context(#app)')).toBe('0,1,1,0');
  });

  it('ignores namespace prefixes but counts the local name', () => {
    expect(score('svg|circle')).toBe('0,0,0,1');
    expect(score('*|a')).toBe('0,0,0,1');
    expect(score('ns|*')).toBe('0,0,0,0');
    expect(score('|a')).toBe('0,0,0,1');
  });

  it('treats an escaped colon as part of the class name', () => {
    // Tailwind ships selectors like `.md\:flex`, which a naive parser reads as
    // a class plus a pseudo-class.
    expect(score('.md\\:flex')).toBe('0,0,1,0');
    expect(score('.hover\\:bg-red-500:hover')).toBe('0,0,2,0');
  });

  it('is not confused by punctuation inside attribute values', () => {
    expect(score('[title="a)b"]:not(.x)')).toBe('0,0,2,0');
    expect(score("[data-x=':hover']")).toBe('0,0,1,0');
  });

  it('counts every combinator-separated compound', () => {
    expect(score('a > b + c ~ d e')).toBe('0,0,0,5');
  });

  it('ignores unparseable fragments rather than throwing', () => {
    expect(() => computeSpecificity('%%% .a')).not.toThrow();
    expect(score('%%% .a')).toBe('0,0,1,0');
  });
});

describe('scoreSelector', () => {
  it('reports an unresolved nesting selector as inexact', () => {
    const result = scoreSelector('& .title');
    expect(result.exact).toBe(false);
    expect(formatSpecificity(result.specificity)).toBe('0,0,1,0');
  });

  it('folds the parent specificity in when it is supplied', () => {
    const result = scoreSelector('& .title', { nesting: [0, 1, 0, 0] });
    expect(result.exact).toBe(true);
    expect(formatSpecificity(result.specificity)).toBe('0,1,1,0');
  });

  it('propagates inexactness out of a nested functional pseudo-class', () => {
    expect(scoreSelector(':is(&, .a)').exact).toBe(false);
  });

  it('stops following selectors nested absurdly deep', () => {
    const deep = ':is('.repeat(20) + '.a' + ')'.repeat(20);
    const result = scoreSelector(deep);
    expect(result.exact).toBe(false);
  });
});

describe('scoreSelectorList', () => {
  it('scores each part separately, because a list has no single specificity', () => {
    const scores = scoreSelectorList('#a, p');
    expect(scores.map((entry) => formatSpecificity(entry.specificity))).toEqual([
      '0,1,0,0',
      '0,0,0,1',
    ]);
    expect(scores.map((entry) => entry.selector)).toEqual(['#a', 'p']);
  });
});

describe('compareSpecificity', () => {
  it('never lets a lower column outweigh a higher one', () => {
    expect(compareSpecificity([0, 1, 0, 0], [0, 0, 99, 99])).toBe(1);
    expect(compareSpecificity([0, 0, 1, 0], [0, 0, 0, 99])).toBe(1);
  });

  it('ranks the inline column above everything', () => {
    expect(compareSpecificity(INLINE_SPECIFICITY, [0, 9, 9, 9])).toBe(1);
  });

  it('returns zero for identical tuples', () => {
    expect(compareSpecificity([0, 1, 2, 1], [0, 1, 2, 1])).toBe(0);
  });
});

describe('maxSpecificity', () => {
  it('returns zero for an empty list', () => {
    expect(maxSpecificity([])).toEqual(ZERO_SPECIFICITY);
  });

  it('picks the strongest', () => {
    const values: Specificity[] = [
      [0, 0, 2, 0],
      [0, 1, 0, 0],
      [0, 0, 9, 9],
    ];
    expect(formatSpecificity(maxSpecificity(values))).toBe('0,1,0,0');
  });
});

describe('splitPseudoElement', () => {
  it('separates a trailing pseudo-element from a matchable base', () => {
    expect(splitPseudoElement('.btn::before')).toEqual({
      base: '.btn',
      pseudoElement: '::before',
    });
  });

  it('normalizes legacy single-colon syntax', () => {
    expect(splitPseudoElement('p:after')).toEqual({ base: 'p', pseudoElement: '::after' });
  });

  it('leaves pseudo-classes alone', () => {
    expect(splitPseudoElement('.btn:hover')).toEqual({
      base: '.btn:hover',
      pseudoElement: null,
    });
  });

  it('falls back to the universal selector for a bare pseudo-element', () => {
    expect(splitPseudoElement('::selection')).toEqual({
      base: '*',
      pseudoElement: '::selection',
    });
  });

  it('drops pseudo-classes attached after the pseudo-element', () => {
    // `.a::before:hover` cannot be matched at all; the base still can.
    expect(splitPseudoElement('.a::before:hover').base).toBe('.a');
  });

  it('does not treat a pseudo-element inside :is() as trailing', () => {
    expect(splitPseudoElement('.a:not(.b)')).toEqual({ base: '.a:not(.b)', pseudoElement: null });
  });
});

describe('resolveNestingSelector', () => {
  it('rewrites & as :is(parent), which matches and scores the same', () => {
    expect(resolveNestingSelector('& .title', '.card')).toBe(':is(.card) .title');
  });

  it('handles a compound & with no space', () => {
    expect(resolveNestingSelector('&.active', '.card, .panel')).toBe(':is(.card, .panel).active');
  });

  it('rewrites every occurrence', () => {
    expect(resolveNestingSelector('& > &', '.a')).toBe(':is(.a) > :is(.a)');
  });

  it('leaves selectors without & untouched, object identity included', () => {
    const selector = '.title';
    expect(resolveNestingSelector(selector, '.card')).toBe(selector);
  });
});
