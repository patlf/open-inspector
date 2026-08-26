import { describe, expect, it } from 'vitest';
import { fieldMatches, filterFields } from './search.js';
import type { Field } from './view-model.js';

function field(partial: Partial<Field> & { label: string; value: string }): Field {
  return partial as Field;
}

describe('fieldMatches', () => {
  it('matches on the label', () => {
    expect(fieldMatches(field({ label: 'letter spacing', value: 'normal' }), 'letter')).toBe(true);
  });

  it('matches on the value, so you can find who is using a colour', () => {
    expect(fieldMatches(field({ label: 'background', value: '#3b82f6' }), '3b82')).toBe(true);
  });

  it('matches on the CSS property even when the panel shows a friendlier label', () => {
    // People know `letter-spacing`; the panel writes "letter spacing".
    const row = field({ label: 'letter spacing', value: '0px', property: 'letter-spacing' });
    expect(fieldMatches(row, 'letter-spacing')).toBe(true);
  });

  it('requires every term but not their order', () => {
    const row = field({ label: 'size', value: '16px', property: 'font-size' });

    expect(fieldMatches(row, 'font size')).toBe(true);
    expect(fieldMatches(row, 'size font')).toBe(true);
    expect(fieldMatches(row, 'font weight')).toBe(false);
  });

  it('ignores case', () => {
    expect(fieldMatches(field({ label: 'Display', value: 'Flex' }), 'flex')).toBe(true);
  });

  it('searches the detail text too', () => {
    const row = field({ label: 'size', value: '16px', detail: '1rem' });
    expect(fieldMatches(row, 'rem')).toBe(true);
  });

  it('matches everything when the query is blank', () => {
    // An empty box must not hide the panel.
    expect(fieldMatches(field({ label: 'a', value: 'b' }), '')).toBe(true);
    expect(fieldMatches(field({ label: 'a', value: 'b' }), '   ')).toBe(true);
  });
});

describe('filterFields', () => {
  const fields = [
    field({ label: 'size', value: '16px', property: 'font-size' }),
    field({ label: 'weight', value: '700', property: 'font-weight' }),
    field({ label: 'color', value: '#111827', property: 'color' }),
  ];

  it('keeps only what matched', () => {
    expect(filterFields(fields, 'font').map((row) => row.label)).toEqual(['size', 'weight']);
  });

  it('returns the same array when there is no query', () => {
    // Identity, not a copy: this runs on every keystroke and every repaint.
    expect(filterFields(fields, '')).toBe(fields);
  });

  it('can filter everything out', () => {
    expect(filterFields(fields, 'grid-template')).toEqual([]);
  });
});
