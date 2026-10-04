import { describe, expect, it } from 'vitest';
import {
  MAX_LENGTH_VARIABLES,
  declaredCustomProperties,
  parseLengthPx,
  readLengthVariables,
  variablesFor,
  type LengthVariable,
} from './variables.js';

describe('declaredCustomProperties', () => {
  it('lists each custom property once, in document order, and nothing else', () => {
    const rules = [
      { declarations: [{ property: '--space-1' }, { property: 'color' }] },
      { declarations: [{ property: '--text-sm' }, { property: '--space-1' }] },
    ];
    expect(declaredCustomProperties(rules)).toEqual(['--space-1', '--text-sm']);
  });
});

describe('parseLengthPx', () => {
  it('reads px and rem, rem against the root size', () => {
    expect(parseLengthPx('16px', 16)).toBe(16);
    expect(parseLengthPx(' 0.875rem ', 16)).toBe(14);
    expect(parseLengthPx('1.5rem', 20)).toBe(30);
    expect(parseLengthPx('.5rem', 16)).toBe(8);
  });

  it('reads one multiplication, the shape of a substituted var() * n token', () => {
    expect(parseLengthPx('calc(0.25rem * 4)', 16)).toBe(16);
    expect(parseLengthPx('calc(3 * 4px)', 16)).toBe(12);
  });

  it('refuses em, because a custom property resolves its ems where it is used', () => {
    expect(parseLengthPx('1em', 16)).toBeNull();
  });

  it('refuses what it would have to guess at', () => {
    expect(parseLengthPx('clamp(1rem, 2vw, 2rem)', 16)).toBeNull();
    expect(parseLengthPx('calc(1rem + 4px)', 16)).toBeNull();
    expect(parseLengthPx('#fff', 16)).toBeNull();
    expect(parseLengthPx('700', 16)).toBeNull();
    expect(parseLengthPx('', 16)).toBeNull();
  });
});

describe('readLengthVariables', () => {
  it('keeps the non-zero lengths and drops the rest', () => {
    const values: Record<string, string> = {
      '--space-4': '1rem',
      '--space-0': '0px',
      '--brand': '#e4743f',
      '--unset': '',
    };
    expect(readLengthVariables(Object.keys(values), (name) => values[name] ?? '', 16)).toEqual([
      { name: '--space-4', px: 16 },
    ]);
  });

  it('reads no more than the cap', () => {
    const names = Array.from({ length: MAX_LENGTH_VARIABLES + 50 }, (_, index) => `--space-${index}`);
    let reads = 0;
    readLengthVariables(names, () => {
      reads += 1;
      return '4px';
    }, 16);
    expect(reads).toBe(MAX_LENGTH_VARIABLES);
  });
});

describe('variablesFor', () => {
  const variables: LengthVariable[] = [
    { name: '--radius-md', px: 8 },
    { name: '--space-2', px: 8 },
    { name: '--spacing-2', px: 8 },
    { name: '--gap-sm', px: 8 },
    { name: '--text-sm', px: 14 },
    { name: '--font-size-base', px: 16 },
    { name: '--size-4', px: 16 },
    { name: '--border-width', px: 1 },
  ];

  it('offers spacing names for spacing, never a radius of the same length', () => {
    expect(variablesFor(8, variables, 'spacing')).toEqual(['--space-2', '--spacing-2']);
  });

  it('takes as many as asked for, in the page order', () => {
    expect(variablesFor(8, variables, 'spacing', 3)).toEqual(['--space-2', '--spacing-2', '--gap-sm']);
  });

  it('offers type names for type, and keeps them out of spacing', () => {
    expect(variablesFor(14, variables, 'type')).toEqual(['--text-sm']);
    expect(variablesFor(16, variables, 'type')).toEqual(['--font-size-base']);
    expect(variablesFor(16, variables, 'spacing')).toEqual(['--size-4']);
  });

  it('matches across rem rounding but not a different length', () => {
    expect(variablesFor(14.02, variables, 'type')).toEqual(['--text-sm']);
    expect(variablesFor(15, variables, 'type')).toEqual([]);
  });
});
