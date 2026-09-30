import { describe, expect, it } from 'vitest';
import {
  compareCascade,
  isDeclarationValid,
  resolveCascade,
  type CascadeDeclaration,
} from './resolve.js';
import type { Specificity } from './specificity.js';

/**
 * The comparator is the whole of the cascade's ordering, so each rule in the
 * module comment gets a case of its own — and the `@layer` reversal, the rule
 * people get wrong, gets several.
 */

let nextOrder = 0;

function decl(overrides: Partial<CascadeDeclaration> = {}): CascadeDeclaration {
  nextOrder += 1;
  return {
    property: 'color',
    value: 'red',
    important: false,
    elementAttached: false,
    layerOrder: null,
    specificity: [0, 0, 1, 0] as Specificity,
    order: nextOrder,
    ruleId: nextOrder,
    ...overrides,
  };
}

/** The value that wins `color` among these declarations. */
function winner(...declarations: CascadeDeclaration[]): string | undefined {
  return resolveCascade(declarations).byProperty.get('color')?.winner?.value;
}

describe('compareCascade', () => {
  it('puts !important above everything else, specificity included', () => {
    const important = decl({ value: 'important', important: true, specificity: [0, 0, 0, 1] });
    const specific = decl({ value: 'specific', specificity: [0, 3, 0, 0] });
    expect(winner(specific, important)).toBe('important');
  });

  it('lets the style attribute beat any rule of the same importance', () => {
    const inline = decl({ value: 'inline', elementAttached: true, specificity: [1, 0, 0, 0] });
    const id = decl({ value: 'id', specificity: [0, 1, 0, 0] });
    expect(winner(id, inline)).toBe('inline');
  });

  it('lets an !important rule beat a normal style attribute', () => {
    const inline = decl({ value: 'inline', elementAttached: true });
    const important = decl({ value: 'important', important: true });
    expect(winner(inline, important)).toBe('important');
  });

  describe('layers', () => {
    it('has later layers win for normal declarations', () => {
      const early = decl({ value: 'early', layerOrder: 0, specificity: [0, 1, 0, 0] });
      const late = decl({ value: 'late', layerOrder: 1 });
      expect(winner(early, late)).toBe('late');
    });

    it('has unlayered normal styles beat every layer', () => {
      const layered = decl({ value: 'layered', layerOrder: 5, specificity: [0, 2, 0, 0] });
      const unlayered = decl({ value: 'unlayered' });
      expect(winner(layered, unlayered)).toBe('unlayered');
    });

    it('reverses for !important: earlier layers win', () => {
      const early = decl({ value: 'early', layerOrder: 0, important: true });
      const late = decl({ value: 'late', layerOrder: 1, important: true, specificity: [0, 1, 0, 0] });
      expect(winner(early, late)).toBe('early');
    });

    it('reverses for !important: unlayered important loses to every layer', () => {
      const layered = decl({ value: 'layered', layerOrder: 3, important: true });
      const unlayered = decl({ value: 'unlayered', important: true, specificity: [0, 2, 0, 0] });
      expect(winner(unlayered, layered)).toBe('layered');
    });

    it('does not produce NaN comparing two unlayered declarations', () => {
      const a = decl({ value: 'a' });
      const b = decl({ value: 'b' });
      expect(compareCascade(b, a)).toBe(1);
      expect(compareCascade(a, b)).toBe(-1);
    });
  });

  it('falls back to specificity, then document order', () => {
    const lowFirst = decl({ value: 'low', specificity: [0, 0, 1, 0] });
    const highFirst = decl({ value: 'high', specificity: [0, 0, 2, 0] });
    expect(winner(highFirst, lowFirst)).toBe('high');

    const earlier = decl({ value: 'earlier' });
    const later = decl({ value: 'later' });
    expect(winner(later, earlier)).toBe('later');
  });

  it('treats an exact tie as equal', () => {
    const a = decl();
    expect(compareCascade(a, { ...a })).toBe(0);
  });
});

describe('resolveCascade', () => {
  it('skips an invalid top declaration and hands the property to the next', () => {
    const invalid = decl({ value: '', important: true });
    const valid = decl({ value: 'blue' });
    const result = resolveCascade([valid, invalid]).byProperty.get('color');

    expect(result?.winner?.value).toBe('blue');
    expect(result?.declarations.map((d) => d.status)).toEqual(['invalid', 'winning']);
  });

  it('reports no winner when every declaration is invalid', () => {
    const result = resolveCascade([decl({ value: ' ' })]).byProperty.get('color');
    expect(result?.winner).toBeNull();
  });

  it('marks the losers overridden, strongest first', () => {
    const a = decl({ value: 'a', specificity: [0, 0, 1, 0] });
    const b = decl({ value: 'b', specificity: [0, 1, 0, 0] });
    const c = decl({ value: 'c', specificity: [0, 0, 0, 1] });
    const result = resolveCascade([a, b, c]).byProperty.get('color');

    expect(result?.declarations.map((d) => [d.value, d.status])).toEqual([
      ['b', 'winning'],
      ['a', 'overridden'],
      ['c', 'overridden'],
    ]);
  });

  it('sorts properties alphabetically so the panel does not reshuffle', () => {
    const result = resolveCascade([
      decl({ property: 'margin' }),
      decl({ property: 'color' }),
      decl({ property: 'display' }),
    ]);
    expect(result.properties.map((p) => p.property)).toEqual(['color', 'display', 'margin']);
  });

  it('accepts a custom validity check', () => {
    const result = resolveCascade([decl({ value: 'nonsense' }), decl({ value: 'blue' })], {
      isValid: (d) => d.value !== 'blue',
    });
    expect(result.byProperty.get('color')?.winner?.value).toBe('nonsense');
  });
});

describe('isDeclarationValid', () => {
  it('never rejects a custom property, even an empty one', () => {
    expect(isDeclarationValid(decl({ property: '--gap', value: '' }))).toBe(true);
  });

  it('rejects an empty property name or value', () => {
    expect(isDeclarationValid(decl({ property: ' ' }))).toBe(false);
    expect(isDeclarationValid(decl({ value: '' }))).toBe(false);
  });
});
