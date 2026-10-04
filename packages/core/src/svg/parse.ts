/**
 * A small XML reader and writer for SVG documents.
 *
 * Written rather than borrowed from `DOMParser` for three reasons: it behaves
 * the same in Chromium, in a Firefox content script and in a unit test (happy-
 * dom cannot parse `image/svg+xml` at all); it keeps text and attribute values
 * exactly as written, entities included, so nothing is reinterpreted on the
 * way through; and the writer controls every byte of formatting, which is the
 * point of a beautifier and a minifier.
 */

export interface SvgAttribute {
  name: string;
  /** As written, entities and all. */
  value: string;
}

export interface SvgElement {
  kind: 'element';
  name: string;
  attributes: SvgAttribute[];
  children: SvgNode[];
}

export interface SvgText {
  kind: 'text';
  /** As written, entities and all. */
  value: string;
}

export interface SvgComment {
  kind: 'comment';
  value: string;
}

export interface SvgCData {
  kind: 'cdata';
  value: string;
}

/** `<?xml …?>`, other processing instructions, and `<!DOCTYPE …>`. */
export interface SvgDirective {
  kind: 'directive';
  value: string;
}

export type SvgNode = SvgElement | SvgText | SvgComment | SvgCData | SvgDirective;

export interface SvgDocument {
  nodes: SvgNode[];
}

export type SvgParseResult =
  | { document: SvgDocument; error: null }
  | { document: null; error: string };

/** The opening tag at the cursor: name, attribute text, and a self-closing slash. */
const OPEN_TAG =
  /<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/y;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttributes(text: string): SvgAttribute[] {
  const attributes: SvgAttribute[] = [];
  for (const match of text.matchAll(ATTRIBUTE)) {
    attributes.push({ name: match[1] ?? '', value: match[2] ?? match[3] ?? match[4] ?? '' });
  }
  return attributes;
}

/** Where a doctype ends: the first `>` outside its internal `[ … ]` subset. */
function doctypeEnd(text: string, from: number): number {
  let depth = 0;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === '[') depth += 1;
    else if (char === ']') depth -= 1;
    else if (char === '>' && depth <= 0) return index;
  }
  return -1;
}

/** Local name, without a namespace prefix: `svg:svg` is an `svg`. */
export function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/**
 * Read SVG markup into a tree, or say exactly why it could not be read.
 *
 * Strict where XML is strict — every tag closed, closed in order — because a
 * tool that "repaired" broken markup would hand back a different picture.
 */
export function parseSvg(text: string): SvgParseResult {
  const nodes: SvgNode[] = [];
  const stack: SvgElement[] = [];
  const fail = (error: string): SvgParseResult => ({ document: null, error });
  const append = (node: SvgNode): void => {
    (stack[stack.length - 1]?.children ?? nodes).push(node);
  };

  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open === -1) {
      append({ kind: 'text', value: text.slice(index) });
      break;
    }
    if (open > index) append({ kind: 'text', value: text.slice(index, open) });

    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4);
      if (end === -1) return fail('A comment is never closed.');
      append({ kind: 'comment', value: text.slice(open + 4, end) });
      index = end + 3;
    } else if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9);
      if (end === -1) return fail('A CDATA section is never closed.');
      append({ kind: 'cdata', value: text.slice(open + 9, end) });
      index = end + 3;
    } else if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open + 2);
      if (end === -1) return fail('A processing instruction is never closed.');
      append({ kind: 'directive', value: text.slice(open, end + 2) });
      index = end + 2;
    } else if (text.startsWith('<!', open)) {
      const end = doctypeEnd(text, open + 2);
      if (end === -1) return fail('A doctype is never closed.');
      append({ kind: 'directive', value: text.slice(open, end + 1) });
      index = end + 1;
    } else if (text.startsWith('</', open)) {
      const end = text.indexOf('>', open + 2);
      if (end === -1) return fail('A closing tag is never finished.');
      const name = text.slice(open + 2, end).trim();
      const element = stack.pop();
      if (!element) return fail(`</${name}> closes nothing.`);
      if (element.name !== name) return fail(`</${name}> closes <${element.name}>.`);
      index = end + 1;
    } else {
      OPEN_TAG.lastIndex = open;
      const match = OPEN_TAG.exec(text);
      if (!match) return fail(`A tag near character ${open} cannot be read.`);
      const element: SvgElement = {
        kind: 'element',
        name: match[1] ?? '',
        attributes: parseAttributes(match[2] ?? ''),
        children: [],
      };
      append(element);
      if (match[3] !== '/') stack.push(element);
      index = OPEN_TAG.lastIndex;
    }
  }

  const unclosed = stack[stack.length - 1];
  if (unclosed) return fail(`<${unclosed.name}> is never closed.`);

  const roots = nodes.filter((node): node is SvgElement => node.kind === 'element');
  if (roots.length !== 1 || localName(roots[0]?.name ?? '') !== 'svg') {
    return fail('This is not an SVG document: it needs exactly one <svg> at the top.');
  }

  return { document: { nodes }, error: null };
}

/**
 * Elements whose text is content, where whitespace can render as a space and
 * line breaks are not formatting: text and its runs, plus the elements whose
 * contents are code or prose.
 */
const TEXT_CONTENT = new Set(['text', 'tspan', 'textPath', 'title', 'desc', 'style', 'script']);

function isBlank(node: SvgNode): boolean {
  return node.kind === 'text' && node.value.trim() === '';
}

function writeAttributes(attributes: SvgAttribute[]): string {
  // Values were read raw, so only a quote that a single-quoted value carried
  // needs escaping to sit inside double quotes.
  return attributes.map(({ name, value }) => ` ${name}="${value.replace(/"/g, '&quot;')}"`).join('');
}

/** One node exactly as minified output writes it, whitespace in text content kept. */
function writeCompact(node: SvgNode, keepComments: boolean, inText: boolean): string {
  switch (node.kind) {
    case 'text':
      return inText || !isBlank(node) ? node.value : '';
    case 'cdata':
      return `<![CDATA[${node.value}]]>`;
    case 'comment':
      return keepComments ? `<!--${node.value}-->` : '';
    case 'directive':
      return node.value;
    case 'element': {
      const text = inText || TEXT_CONTENT.has(localName(node.name));
      const children = node.children.map((child) => writeCompact(child, keepComments, text)).join('');
      const open = `<${node.name}${writeAttributes(node.attributes)}`;
      return children === '' ? `${open}/>` : `${open}>${children}</${node.name}>`;
    }
  }
}

/** All the bytes that are not the picture: blank text between tags, and comments. */
export function minifySvg(document: SvgDocument): string {
  return document.nodes.map((node) => writeCompact(node, false, false)).join('');
}

/**
 * One element per line, children indented.
 *
 * Anything inside a text element is written exactly as it was: a line break
 * between two `<tspan>`s renders as a space, so reflowing them would change
 * the picture rather than its formatting.
 */
export function beautifySvg(document: SvgDocument, indent = '  '): string {
  const lines: string[] = [];

  const write = (node: SvgNode, depth: number): void => {
    const pad = indent.repeat(depth);
    if (node.kind === 'text') {
      const value = node.value.trim();
      if (value) lines.push(`${pad}${value}`);
      return;
    }
    if (node.kind !== 'element') {
      lines.push(`${pad}${writeCompact(node, true, false)}`);
      return;
    }

    const open = `<${node.name}${writeAttributes(node.attributes)}`;
    const children = node.children.filter((child) => !isBlank(child));
    const textual =
      TEXT_CONTENT.has(localName(node.name)) ||
      children.every((child) => child.kind === 'text' || child.kind === 'cdata');

    if (children.length === 0) {
      lines.push(`${pad}${open}/>`);
    } else if (textual) {
      lines.push(`${pad}${writeCompact(node, true, false)}`);
    } else {
      lines.push(`${pad}${open}>`);
      for (const child of children) write(child, depth + 1);
      lines.push(`${pad}</${node.name}>`);
    }
  };

  for (const node of document.nodes) write(node, 0);
  return lines.join('\n');
}
