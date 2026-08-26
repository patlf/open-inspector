import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Field } from './view-model.js';

/**
 * Filtering the panel.
 *
 * A populated Styles tab runs to well over a hundred declarations, and finding
 * `letter-spacing` in it by eye is the single most tedious thing about using
 * any inspector. The query lives here rather than in each section so that one
 * box filters every group at once.
 */
export const SearchContext = createContext<string>('');

export function useSearch(): string {
  return useContext(SearchContext);
}

/**
 * Match a row against the query.
 *
 * Every term must appear somewhere in the row, in any order — so `font size`
 * finds `font-size` and `size` alike, and the user never has to guess which
 * word we happened to put in the label. The property name is searched too:
 * people know the CSS name even when the panel shows a friendlier one.
 */
export function fieldMatches(field: Field, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = [field.label, field.value, field.detail, field.property]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

export function filterFields(fields: Field[], query: string): Field[] {
  if (!query.trim()) return fields;
  return fields.filter((field) => fieldMatches(field, query));
}
