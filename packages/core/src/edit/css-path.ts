/**
 * Build a selector that identifies one element.
 *
 * Used when exporting edits as CSS: an override is only useful to paste back
 * into a stylesheet if it comes with a selector that finds the same element
 * again. Correctness here means *specific enough to be unique*, not *pretty* —
 * a selector that matches three elements would silently restyle two of them.
 */

/** Escape a class or id for use in a selector, falling back where unsupported. */
function escapeIdent(value: string): string {
  const escape = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS?.escape;
  if (typeof escape === 'function') return escape(value);
  // Conservative fallback: anything outside the safe set becomes an escape.
  return value.replace(/[^\w-]/g, (character) => `\\${character}`);
}

/**
 * Utility-class frameworks put dozens of classes on an element.
 *
 * Taking them all produces a selector so long it is unreadable and so specific
 * it breaks the moment a variant is added. Three is enough to disambiguate in
 * practice, and `:nth-of-type` picks up the rest.
 */
const MAX_CLASSES = 3;

/** How far up the tree to walk before giving up on uniqueness. */
const MAX_DEPTH = 5;

function localSelector(element: Element): string {
  const tag = element.tagName.toLowerCase();

  // An id, if it is one we can rely on. Generated ids from React and friends
  // frequently contain characters that need escaping, which still works.
  if (element.id) return `${tag}#${escapeIdent(element.id)}`;

  const classes = Array.from(element.classList)
    .slice(0, MAX_CLASSES)
    .map((className) => `.${escapeIdent(className)}`)
    .join('');

  return `${tag}${classes}`;
}

/** Position among same-tag siblings, when there is more than one. */
function positionalSuffix(element: Element): string {
  const parent = element.parentElement;
  if (!parent) return '';

  const sameTag = Array.from(parent.children).filter(
    (child) => child.tagName === element.tagName,
  );
  if (sameTag.length <= 1) return '';

  return `:nth-of-type(${sameTag.indexOf(element) + 1})`;
}

function matchesExactlyOne(root: ParentNode, selector: string): boolean {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    // Malformed selector — treat as not unique rather than throwing.
    return false;
  }
}

/**
 * A selector for this element, as short as uniqueness allows.
 *
 * Walks up from the element adding ancestors until the selector matches
 * exactly one node, stopping at {@link MAX_DEPTH}. Returns the best effort if
 * uniqueness is never reached — a non-unique selector is still more useful
 * than none, and the caller can say so.
 */
export function cssPath(element: Element, root?: ParentNode): string {
  const scope = root ?? element.ownerDocument ?? document;
  const parts: string[] = [];

  let current: Element | null = element;

  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    parts.unshift(`${localSelector(current)}${positionalSuffix(current)}`);

    const candidate = parts.join(' > ');
    if (matchesExactlyOne(scope, candidate)) return candidate;

    current = current.parentElement;
  }

  return parts.join(' > ');
}

/** Whether {@link cssPath} produced something that identifies exactly one node. */
export function isUniqueSelector(selector: string, root: ParentNode): boolean {
  return matchesExactlyOne(root, selector);
}
