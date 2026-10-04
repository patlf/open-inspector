import { parseColor, toHex } from '../color/parse.js';
import { localName, type SvgDocument, type SvgElement, type SvgNode } from './parse.js';

/**
 * Making an SVG smaller without changing the picture.
 *
 * Only the passes that are safe on any file: the ones that can change what
 * renders — removing ids something might reference, dropping "default"
 * presentation attributes an ancestor overrides, rewriting paths into
 * relative commands — are left out. A smaller file that draws something else
 * is not an optimisation.
 */

export interface OptimizeOptions {
  /** Decimal places kept on coordinates and lengths. */
  precision?: number;
}

export const DEFAULT_PRECISION = 3;

/**
 * Namespaces drawing tools add for their own bookkeeping. Nothing renders
 * them; they only matter to the tool that wrote the file.
 */
const EDITOR_PREFIXES = new Set(['inkscape', 'sodipodi', 'sketch', 'i', 'x', 'graph', 'serif', 'figma']);

/** Elements that carry no picture at all. */
const DROPPED_ELEMENTS = new Set(['metadata']);

/** Attributes nothing current reads. */
const DROPPED_ATTRIBUTES = new Set(['enable-background']);

/** Attributes holding one number, optionally in px, which is what a bare number means. */
const NUMBER_ATTRIBUTES = new Set([
  'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy',
  'fx', 'fy', 'stroke-width', 'stroke-miterlimit', 'stroke-dashoffset', 'opacity', 'fill-opacity',
  'stroke-opacity', 'stop-opacity', 'offset', 'font-size', 'flood-opacity', 'pathLength',
]);

/** Attributes holding a list of numbers. */
const LIST_ATTRIBUTES = new Set(['viewBox', 'points', 'stroke-dasharray']);

const COLOR_ATTRIBUTES = new Set(['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color']);

/** Whitespace in these renders, so it is never removed from inside them. */
const TEXT_CONTENT = new Set(['text', 'tspan', 'textPath', 'title', 'desc', 'style', 'script']);

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
/** The same number, read at one position. */
const NUMBER_AT = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const LONE_NUMBER = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(px)?\s*$/;

/** A number at a precision, with no zero that does not carry a value: `0.50` → `.5`. */
export function formatNumber(value: number, precision: number): string {
  let text = String(Number(value.toFixed(precision)));
  if (text === '-0') text = '0';
  if (text.startsWith('0.')) text = text.slice(1);
  else if (text.startsWith('-0.')) text = `-${text.slice(2)}`;
  return text;
}

/** How many numbers each path command takes per repetition. */
const PATH_ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/**
 * Path data written as tightly as it can be read back.
 *
 * Numbers rounded, separators dropped where a sign or a second decimal point
 * already separates two numbers, and a command letter omitted when it repeats
 * — which includes the line-to that implicitly follows a move-to. Arc flags
 * are single digits that may be run together (`a1 1 0 011 1`), so they are
 * read one character at a time; anything that does not parse is returned
 * untouched rather than guessed at.
 */
export function minifyPathData(d: string, precision: number): string {
  const out: string[] = [];
  let index = 0;
  let previous = '';
  let last = '';

  const skipSeparators = (): void => {
    while (index < d.length && /[\s,]/.test(d[index] ?? '')) index += 1;
  };
  const readNumber = (): string | null => {
    skipSeparators();
    NUMBER_AT.lastIndex = index;
    const found = NUMBER_AT.exec(d);
    if (!found) return null;
    index = NUMBER_AT.lastIndex;
    return found[0];
  };
  const readFlag = (): string | null => {
    skipSeparators();
    const char = d[index];
    if (char !== '0' && char !== '1') return null;
    index += 1;
    return char;
  };
  const push = (token: string): void => {
    const needsSpace =
      last !== '' &&
      !/[a-zA-Z]$/.test(last) &&
      !token.startsWith('-') &&
      !(token.startsWith('.') && last.includes('.'));
    out.push(needsSpace ? ` ${token}` : token);
    last = token;
  };

  skipSeparators();
  while (index < d.length) {
    const command = d[index] ?? '';
    const arity = PATH_ARITY[command.toLowerCase()];
    if (arity === undefined) return d;
    index += 1;

    if (arity === 0) {
      out.push(command);
      last = command;
      previous = command;
      skipSeparators();
      continue;
    }

    let first = true;
    do {
      const values: string[] = [];
      for (let slot = 0; slot < arity; slot += 1) {
        const isFlag = command.toLowerCase() === 'a' && (slot === 3 || slot === 4);
        const raw = isFlag ? readFlag() : readNumber();
        if (raw === null) return d;
        values.push(isFlag ? raw : formatNumber(Number(raw), precision));
      }

      // A repeat of the same command needs no letter; nor does the line-to
      // that implicitly follows a move-to. A repeated move-to does need one:
      // without it the coordinates would read as a line.
      const effective = !first && command === 'M' ? 'L' : !first && command === 'm' ? 'l' : command;
      const implied =
        (effective === previous && effective.toLowerCase() !== 'm') ||
        (previous === 'M' && effective === 'L') ||
        (previous === 'm' && effective === 'l');
      if (!implied) {
        out.push(effective);
        last = effective;
      }
      for (const value of values) push(value);
      previous = effective;
      first = false;
      skipSeparators();
    } while (index < d.length && !/[a-zA-Z]/.test(d[index] ?? ''));
  }

  return out.join('');
}

function roundList(value: string, precision: number): string {
  return value
    .trim()
    .split(/[\s,]+/)
    .map((part) => (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(part) ? formatNumber(Number(part), precision) : part))
    .join(' ');
}

function roundTransform(value: string, precision: number): string {
  return value
    .replace(NUMBER, (number) => formatNumber(Number(number), precision))
    .replace(/\s*,\s*/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The shortest hex that names the same opaque colour, or the value unchanged. */
function shortenColor(value: string): string {
  const trimmed = value.trim();
  if (/^(none|currentcolor|transparent|inherit)$/i.test(trimmed) || trimmed.startsWith('url(')) {
    return trimmed;
  }
  const parsed = parseColor(trimmed);
  if (!parsed || parsed.a < 1) return trimmed;
  const hex = toHex(parsed);
  const short = /^#(.)\1(.)\2(.)\3$/.test(hex) ? `#${hex[1]}${hex[3]}${hex[5]}` : hex;
  return short.length < trimmed.length ? short : trimmed.toLowerCase();
}

/**
 * An inline style with the declarations nothing reads taken out — today just
 * `enable-background`, which Illustrator writes into every file. Empty
 * afterwards, the attribute goes too.
 */
function cleanStyle(value: string): string {
  return value
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== '' && !/^enable-background\s*:/i.test(declaration))
    .join(';');
}

function prefixOf(name: string): string | null {
  const colon = name.indexOf(':');
  return colon === -1 ? null : name.slice(0, colon);
}

function isEditorName(name: string): boolean {
  const prefix = prefixOf(name);
  if (prefix === 'xmlns') return EDITOR_PREFIXES.has(name.slice(6));
  return prefix !== null && EDITOR_PREFIXES.has(prefix);
}

function optimizeValue(name: string, value: string, precision: number): string {
  if (name === 'd') return minifyPathData(value, precision);
  if (name === 'style') return cleanStyle(value);
  if (name === 'transform' || name === 'gradientTransform' || name === 'patternTransform') {
    return roundTransform(value, precision);
  }
  if (LIST_ATTRIBUTES.has(name)) return roundList(value, precision);
  if (COLOR_ATTRIBUTES.has(name)) return shortenColor(value);
  if (NUMBER_ATTRIBUTES.has(name)) {
    const match = LONE_NUMBER.exec(value);
    if (match) return formatNumber(Number(match[1]), precision);
  }
  return value;
}

/**
 * Attributes on the outermost `<svg>` that no renderer reads there: its
 * position (it is not inside anything to be positioned in) and the spec
 * version it targets.
 */
const IGNORED_ON_ROOT = new Set(['version', 'x', 'y']);

function optimizeNodes(nodes: SvgNode[], precision: number, inText: boolean, root: boolean): SvgNode[] {
  const out: SvgNode[] = [];

  for (const node of nodes) {
    if (node.kind === 'comment' || node.kind === 'directive') continue;
    if (node.kind === 'text') {
      if (inText || node.value.trim() !== '') out.push(node);
      continue;
    }
    if (node.kind === 'cdata') {
      out.push(node);
      continue;
    }

    const name = localName(node.name);
    if (DROPPED_ELEMENTS.has(name) || isEditorName(node.name)) continue;

    const text = inText || TEXT_CONTENT.has(name);
    const element: SvgElement = {
      kind: 'element',
      name: node.name,
      attributes: node.attributes
        .filter(({ name: attribute }) => !isEditorName(attribute) && !DROPPED_ATTRIBUTES.has(attribute))
        .filter(({ name: attribute }) => !(root && IGNORED_ON_ROOT.has(attribute)))
        .map(({ name: attribute, value }) => ({
          name: attribute,
          value: optimizeValue(attribute, value, precision),
        }))
        .filter(({ name: attribute, value }) => !(attribute === 'style' && value === '')),
      children: optimizeNodes(node.children, precision, text, false),
    };

    // An empty group or definitions block draws nothing. One with an id is
    // kept: something may point at it.
    const hasId = element.attributes.some((attribute) => attribute.name === 'id');
    if ((name === 'g' || name === 'defs') && element.children.length === 0 && !hasId) continue;

    // A group with no attributes changes nothing about its children.
    if (name === 'g' && element.attributes.length === 0) {
      out.push(...element.children);
      continue;
    }

    out.push(element);
  }

  return out;
}

/** Does any element render text, where `xml:space` decides what whitespace shows? */
function hasText(nodes: SvgNode[]): boolean {
  return nodes.some(
    (node) =>
      node.kind === 'element' &&
      (['text', 'tspan', 'textPath'].includes(localName(node.name)) || hasText(node.children)),
  );
}

function usesXlink(nodes: SvgNode[]): boolean {
  return nodes.some(
    (node) =>
      node.kind === 'element' &&
      (node.attributes.some((attribute) => attribute.name.startsWith('xlink:')) ||
        usesXlink(node.children)),
  );
}

/** A smaller copy of the document; the original is left as it was. */
export function optimizeSvg(document: SvgDocument, options: OptimizeOptions = {}): SvgDocument {
  const precision = options.precision ?? DEFAULT_PRECISION;
  const nodes = optimizeNodes(document.nodes, precision, false, true);

  // The xlink declaration only means something while an xlink attribute uses
  // it, and xml:space only while there is text for it to govern.
  const dropXlink = !usesXlink(nodes);
  const dropSpace = !hasText(nodes);
  for (const node of nodes) {
    if (node.kind !== 'element') continue;
    node.attributes = node.attributes.filter(
      ({ name }) => !(dropXlink && name === 'xmlns:xlink') && !(dropSpace && name === 'xml:space'),
    );
  }

  return { nodes };
}
