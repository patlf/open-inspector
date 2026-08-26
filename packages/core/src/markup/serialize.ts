/**
 * Turn a live subtree back into source.
 *
 * `outerHTML` is not this. A rendered element carries framework bookkeeping
 * (`data-reactid`, hydration markers), the inspector's own attributes, and
 * whatever inline styles a script has set — none of which a person wants
 * pasted into their codebase. This produces markup someone would plausibly
 * have written.
 */

export type MarkupDialect = 'html' | 'jsx';

export interface SerializeOptions {
  dialect?: MarkupDialect;
  /** How deep to go. Beyond a few levels the output stops being readable. */
  maxDepth?: number;
  /** Total elements before giving up, so a whole page cannot be serialized by accident. */
  maxElements?: number;
  /** Attribute names to drop, beyond the always-dropped ones. */
  dropAttributes?: readonly string[];
  /** Keep `style="…"`. Off by default: inline styles are usually script residue. */
  keepInlineStyles?: boolean;
  indent?: string;
}

/**
 * Attributes that describe the running app, not the design.
 *
 * Framework hydration ids and our own markers are noise in every case; keeping
 * them would make the output un-pasteable and leak the inspector into it.
 */
const ALWAYS_DROP = [
  /^data-open-inspector/i,
  /^data-react/i,
  /^data-v-[0-9a-f]+$/i,
  /^data-svelte/i,
  /^data-astro/i,
  /^data-n-/i,
  /^ng-/i,
  /^_ngcontent/i,
  /^jsaction$/i,
  /^aria-owns$/i,
];

/** Void elements have no closing tag and no children. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

/** Elements whose contents are code, not markup worth reproducing. */
const OPAQUE_ELEMENTS = new Set(['script', 'style', 'noscript', 'template']);

/**
 * Attributes whose presence alone carries the meaning.
 *
 * These are the only ones worth writing bare. Collapsing every empty
 * attribute would turn `alt=""` — an explicit "this image is decorative" —
 * into `alt`, which reads like an oversight.
 */
const BOOLEAN_ATTRIBUTES = new Set([
  'checked', 'disabled', 'readonly', 'required', 'selected', 'multiple',
  'autofocus', 'autoplay', 'controls', 'loop', 'muted', 'open', 'hidden',
  'default', 'reversed', 'async', 'defer', 'novalidate', 'formnovalidate',
  'itemscope', 'playsinline', 'inert',
]);

/** HTML attribute names that differ in JSX. */
const JSX_ATTRIBUTE_NAMES: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  autocomplete: 'autoComplete',
  autofocus: 'autoFocus',
  srcset: 'srcSet',
  contenteditable: 'contentEditable',
  spellcheck: 'spellCheck',
  novalidate: 'noValidate',
  enctype: 'encType',
  crossorigin: 'crossOrigin',
};

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function shouldDrop(name: string, extra: readonly string[]): boolean {
  if (extra.includes(name)) return true;
  return ALWAYS_DROP.some((pattern) => pattern.test(name));
}

/** `background-color: red; margin: 0` → `{ backgroundColor: 'red', margin: '0' }` */
export function styleToJsxObject(cssText: string): string {
  const entries = cssText
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon === -1) return null;

      const property = declaration.slice(0, colon).trim();
      const value = declaration.slice(colon + 1).trim();

      // Custom properties keep their name verbatim; React passes them through.
      const name = property.startsWith('--')
        ? `'${property}'`
        : property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

      return `${name}: '${value.replace(/'/g, "\\'")}'`;
    })
    .filter((entry): entry is string => entry !== null);

  return entries.length > 0 ? `{{ ${entries.join(', ')} }}` : '{{}}';
}

function renderAttribute(
  name: string,
  value: string,
  dialect: MarkupDialect,
): string {
  if (dialect === 'jsx') {
    if (name === 'style') return `style=${styleToJsxObject(value)}`;
    const jsxName = JSX_ATTRIBUTE_NAMES[name] ?? name;
    return `${jsxName}="${escapeAttribute(value)}"`;
  }

  return value === '' && BOOLEAN_ATTRIBUTES.has(name)
    ? name
    : `${name}="${escapeAttribute(value)}"`;
}

interface Budget {
  remaining: number;
  truncated: boolean;
}

function serializeNode(
  node: Node,
  depth: number,
  options: Required<SerializeOptions>,
  budget: Budget,
): string[] {
  const pad = options.indent.repeat(depth);

  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    return [`${pad}${options.dialect === 'jsx' ? text.replace(/[{}]/g, (c) => `{'${c}'}`) : escapeText(text)}`];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return [];

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (OPAQUE_ELEMENTS.has(tag)) return [];

  if (budget.remaining <= 0) {
    budget.truncated = true;
    return [`${pad}<!-- … -->`];
  }
  budget.remaining -= 1;

  const attributes: string[] = [];
  for (const attribute of Array.from(element.attributes)) {
    if (shouldDrop(attribute.name, options.dropAttributes)) continue;
    if (attribute.name === 'style' && !options.keepInlineStyles) continue;
    attributes.push(renderAttribute(attribute.name, attribute.value, options.dialect));
  }

  const open = attributes.length > 0 ? `<${tag} ${attributes.join(' ')}` : `<${tag}`;

  if (VOID_ELEMENTS.has(tag)) {
    // ` />` is what Prettier and every JSX codebase writes.
    return [`${pad}${open}${options.dialect === 'jsx' ? ' />' : '>'}`];
  }

  if (depth >= options.maxDepth) {
    const hasChildren = element.childNodes.length > 0;
    budget.truncated = budget.truncated || hasChildren;
    return [`${pad}${open}>${hasChildren ? '…' : ''}</${tag}>`];
  }

  const children = Array.from(element.childNodes).flatMap((child) =>
    serializeNode(child, depth + 1, options, budget),
  );

  // Keep short single-line content on one line; it reads far better.
  if (children.length === 0) return [`${pad}${open}></${tag}>`];
  if (children.length === 1 && !children[0]?.includes('<') && children[0]!.length < 60) {
    return [`${pad}${open}>${children[0]!.trim()}</${tag}>`];
  }

  return [`${pad}${open}>`, ...children, `${pad}</${tag}>`];
}

export interface SerializedMarkup {
  text: string;
  /** True when depth or the element budget cut the output short. */
  truncated: boolean;
}

/**
 * Serialize an element and its subtree.
 *
 * Deliberately lossy: framework attributes, scripts and (by default) inline
 * styles are dropped, because the point is markup a person can paste, not a
 * faithful recording of the running DOM.
 */
export function serializeElement(
  element: Element,
  options: SerializeOptions = {},
): SerializedMarkup {
  const resolved: Required<SerializeOptions> = {
    dialect: options.dialect ?? 'html',
    maxDepth: options.maxDepth ?? 6,
    maxElements: options.maxElements ?? 120,
    dropAttributes: options.dropAttributes ?? [],
    keepInlineStyles: options.keepInlineStyles ?? false,
    indent: options.indent ?? '  ',
  };

  const budget: Budget = { remaining: resolved.maxElements, truncated: false };
  const lines = serializeNode(element, 0, resolved, budget);

  return { text: lines.join('\n'), truncated: budget.truncated };
}
