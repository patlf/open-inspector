import { serializeElement } from './serialize.js';

/**
 * The source behind an element that does not render.
 *
 * A `<style>` or `<script>` has no box, so its box model is a column of zeros
 * and its matched rules are whatever `*` happens to set. What there is to see
 * is the code it carries. Read from what the page already holds — the element's
 * text, the CSSOM — and never fetched: an external script is named, not read.
 */
export interface ElementSource {
  language: 'css' | 'javascript' | 'json' | 'html';
  text: string;
  /** Where the text came from, or why there is none, when that needs saying. */
  note: string | null;
  /** True when the text was cut at {@link SOURCE_LIMIT}. */
  truncated: boolean;
}

/**
 * Characters shown at most.
 *
 * A bundled stylesheet can run to megabytes, and the panel repaints it while
 * it is selected. Anything longer is cut, and says so.
 */
export const SOURCE_LIMIT = 100_000;

/** Head elements with no source of their own, shown as the markup they are. */
const METADATA_TAGS = new Set(['head', 'meta', 'title', 'base', 'link']);

interface RuleListLike {
  readonly length: number;
  readonly [index: number]: { readonly cssText: string } | undefined;
}

interface SheetOwner {
  readonly sheet?: { readonly cssRules: RuleListLike } | null;
}

/**
 * Take off the indentation the text inherited from the HTML around it.
 *
 * A `<style>` nested six levels into a template carries six levels of
 * indent on every line, which is the page's formatting, not the CSS's.
 */
export function dedent(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && !lines[0]?.trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1]?.trim()) lines.pop();

  const indents = lines
    .filter((line) => line.trim())
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
  const common = indents.length > 0 ? Math.min(...indents) : 0;

  return lines.map((line) => line.slice(common)).join('\n');
}

function source(
  language: ElementSource['language'],
  raw: string,
  note: string | null = null,
): ElementSource {
  const text = dedent(raw);
  const truncated = text.length > SOURCE_LIMIT;
  return { language, text: truncated ? text.slice(0, SOURCE_LIMIT) : text, note, truncated };
}

/**
 * A stylesheet's rules, as the browser holds them.
 *
 * Throws for a cross-origin sheet without CORS, exactly as `.cssRules` does;
 * callers decide what to say about that.
 */
function rulesText(owner: SheetOwner): string | null {
  const rules = owner.sheet?.cssRules;
  if (!rules) return null;

  const lines: string[] = [];
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (rule) lines.push(rule.cssText);
  }
  return lines.join('\n');
}

function readStyle(element: Element): ElementSource {
  const text = element.textContent ?? '';
  if (text.trim()) return source('css', text);

  /**
   * CSS-in-JS libraries write through `insertRule` in production and leave
   * the element empty, so its text alone would say this sheet has nothing in
   * it. The rules are in the CSSOM.
   */
  try {
    const inserted = rulesText(element as unknown as SheetOwner);
    if (inserted) {
      return source('css', inserted, 'Inserted through the CSSOM; the element itself is empty.');
    }
  } catch {
    // An inline sheet is always same-origin; nothing to report here.
  }
  return source('css', '', 'This stylesheet is empty.');
}

function readLinkedSheet(element: Element): ElementSource {
  const href = element.getAttribute('href') ?? '';
  try {
    const text = rulesText(element as unknown as SheetOwner);
    if (text === null) return source('css', '', `Not loaded yet, or not applied: ${href}`);
    return source('css', text, `Rules of ${href}, as the browser parsed them.`);
  } catch {
    return source(
      'css',
      '',
      `${href} is served cross-origin, so the browser will not let any extension read its rules.`,
    );
  }
}

function readScript(element: Element): ElementSource {
  const type = (element.getAttribute('type') ?? '').toLowerCase();
  const language = type.includes('json') ? 'json' : 'javascript';

  const src = element.getAttribute('src');
  if (src) {
    return source(
      language,
      '',
      `Loaded from ${src}. External scripts are not fetched — that would be a request of ours.`,
    );
  }
  return source(language, element.textContent ?? '');
}

/**
 * The source of a non-rendering element, or null for anything that renders.
 *
 * Decided by tag rather than by `display: none`: a hidden dialog is still a
 * box someone may want to edit back into view, while a `<style>` never is.
 */
export function readElementSource(element: Element): ElementSource | null {
  const tag = element.tagName.toLowerCase();

  switch (tag) {
    case 'style':
      return readStyle(element);
    case 'script':
      return readScript(element);
    case 'template':
      return source('html', element.innerHTML);
    case 'noscript':
      // With scripting on, a noscript's contents are parsed as plain text.
      return source('html', element.textContent ?? '');
  }

  if (tag === 'link' && /\bstylesheet\b/i.test(element.getAttribute('rel') ?? '')) {
    return readLinkedSheet(element);
  }

  if (METADATA_TAGS.has(tag)) {
    return source('html', serializeElement(element, { maxElements: 400 }).text);
  }

  return null;
}
