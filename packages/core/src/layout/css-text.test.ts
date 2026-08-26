import { describe, expect, it } from 'vitest';
import { joinWithAnd, parseCssLength, splitTopLevel, unwrapFunction } from './css-text.js';

describe('splitTopLevel', () => {
  it('keeps functions intact when splitting on whitespace', () => {
    expect(splitTopLevel('repeat(auto-fit, minmax(240px, 1fr))')).toEqual([
      'repeat(auto-fit, minmax(240px, 1fr))',
    ]);
  });

  it('separates line names from tracks', () => {
    expect(splitTopLevel('[full-start] 1fr [content-start] minmax(0, 1fr) [full-end]')).toEqual([
      '[full-start]',
      '1fr',
      '[content-start]',
      'minmax(0, 1fr)',
      '[full-end]',
    ]);
  });

  it('keeps multi-word line-name groups together', () => {
    expect(splitTopLevel('[sidebar-end main-start] 1fr')).toEqual([
      '[sidebar-end main-start]',
      '1fr',
    ]);
  });

  it('does not split selector lists inside :is()', () => {
    expect(splitTopLevel(':is(.a, .b) .c, .d', 'comma')).toEqual([':is(.a, .b) .c', '.d']);
  });

  it('does not split on a comma inside an attribute selector string', () => {
    expect(splitTopLevel('[data-x="a,b"], .c', 'comma')).toEqual(['[data-x="a,b"]', '.c']);
  });

  it('honours backslash escapes in class names', () => {
    // Tailwind writes `.w-1\/2`; escaped commas show up in generated CSS too.
    expect(splitTopLevel('.a\\,b, .c', 'comma')).toEqual(['.a\\,b', '.c']);
  });

  it('collapses runs of whitespace and drops empty fragments', () => {
    expect(splitTopLevel('  1fr \n  2fr  ')).toEqual(['1fr', '2fr']);
    expect(splitTopLevel('.a, , .b,', 'comma')).toEqual(['.a', '.b']);
  });

  it('recovers from an unbalanced closing paren instead of swallowing the rest', () => {
    expect(splitTopLevel('a) , .b', 'comma')).toEqual(['a)', '.b']);
  });
});

describe('unwrapFunction', () => {
  it('splits arguments while leaving nested functions whole', () => {
    expect(unwrapFunction('minmax(240px, 1fr)')).toEqual({
      name: 'minmax',
      args: ['240px', '1fr'],
      raw: 'minmax(240px, 1fr)',
    });
    expect(unwrapFunction('repeat(auto-fit, minmax(240px, 1fr))')?.args).toEqual([
      'auto-fit',
      'minmax(240px, 1fr)',
    ]);
  });

  it('refuses two adjacent function values', () => {
    // Ends with ')' and starts with a name, but the first paren closes early.
    expect(unwrapFunction('min(1px) max(2px)')).toBeNull();
  });

  it('ignores parens inside quoted arguments', () => {
    expect(unwrapFunction('url("a)b")')).toEqual({
      name: 'url',
      args: ['"a)b"'],
      raw: 'url("a)b")',
    });
  });

  it('returns null for plain values', () => {
    expect(unwrapFunction('300px')).toBeNull();
    expect(unwrapFunction('')).toBeNull();
    expect(unwrapFunction('(1fr)')).toBeNull();
  });
});

describe('parseCssLength', () => {
  it('reads pixels exactly', () => {
    expect(parseCssLength('768px')).toEqual({ px: 768, unit: 'px', approximate: false });
    expect(parseCssLength('-8px')?.px).toBe(-8);
    expect(parseCssLength('0')).toEqual({ px: 0, unit: 'px', approximate: false });
  });

  it('converts font-relative media-query units against the root size', () => {
    expect(parseCssLength('48em')).toEqual({ px: 768, unit: 'em', approximate: true });
    expect(parseCssLength('48em', 10)?.px).toBe(480);
  });

  it('converts absolute units', () => {
    expect(parseCssLength('12pt')?.px).toBe(16);
    expect(parseCssLength('1in')?.px).toBe(96);
  });

  it('returns null for anything that is not a length', () => {
    // The whole point of not reusing parsePx: these must not become 0.
    expect(parseCssLength('1fr')).toBeNull();
    expect(parseCssLength('auto')).toBeNull();
    expect(parseCssLength('50%')).toBeNull();
    expect(parseCssLength('min(100%, 240px)')).toBeNull();
    expect(parseCssLength('')).toBeNull();
  });
});

describe('joinWithAnd', () => {
  it('builds readable phrases', () => {
    expect(joinWithAnd([])).toBe('');
    expect(joinWithAnd(['a'])).toBe('a');
    expect(joinWithAnd(['a', 'b'])).toBe('a and b');
    expect(joinWithAnd(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
