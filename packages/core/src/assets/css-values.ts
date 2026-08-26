/**
 * Parsers for the CSS values that can hold an image or a font file.
 *
 * These are string-in, data-out on purpose. Computed styles are the only thing
 * a browser hands back here, and no DOM implementation outside a real browser
 * produces them faithfully — so the parsing has to be separable from the
 * measurement to be testable at all.
 *
 * The scanner is deliberately structural rather than a full CSS tokenizer: it
 * tracks nesting, quoting and backslash escapes, which is exactly what is
 * needed to stop a comma inside `rgba(0, 0, 0, .5)` or inside a `data:` URI
 * from splitting a value in half. That single bug is why naive harvesters
 * report half a gradient as an image URL.
 */

/** One layer of a comma-separated image property such as `background-image`. */
export interface CssImageLayer {
  /** The layer text exactly as authored. */
  raw: string;
  kind: 'url' | 'image-set' | 'gradient' | 'none' | 'other';
  candidates: CssImageCandidate[];
}

/** A single image URL found in a CSS value, with any descriptor beside it. */
export interface CssImageCandidate {
  /** The token as authored, e.g. `url("a.png")`. */
  raw: string;
  /** Unquoted, unescaped URL — still relative if it was authored that way. */
  url: string;
  /** `image-set()` descriptor such as `2x` or `600w`. */
  descriptor: string | null;
  /** Declared by `type("image/webp")` inside `image-set()`. */
  mimeType: string | null;
}

/** One entry of an `@font-face` `src` descriptor. */
export type FontFaceSource =
  | { kind: 'url'; url: string; format: string | null; tech: string | null }
  | { kind: 'local'; name: string };

function scanSegments(value: string, isSeparator: (char: string) => boolean): string[] {
  const segments: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (depth === 0 && isSeparator(char)) {
      if (current.trim().length > 0) segments.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim().length > 0) segments.push(current.trim());
  return segments;
}

/** Split a CSS value on its top-level commas, ignoring those inside `()` and quotes. */
export function splitCssList(value: string): string[] {
  return scanSegments(value, (char) => char === ',');
}

/** Split a CSS value into top-level whitespace-separated tokens. */
export function splitCssTokens(value: string): string[] {
  return scanSegments(value, (char) => /\s/.test(char));
}

/**
 * Undo CSS string escaping.
 *
 * Only the `\<char>` form is handled; the hexadecimal form (`\2014`) is left
 * alone because it essentially never appears in a URL and mis-decoding one
 * would silently corrupt the address of an asset.
 */
function unescapeCss(value: string): string {
  return value.replace(/\\([^\r\n\f0-9a-fA-F])/g, '$1');
}

/** Strip matching quotes, or return null when the token is not a quoted string. */
export function unquoteCssString(token: string): string | null {
  const trimmed = token.trim();
  if (trimmed.length < 2) return null;

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first !== '"' && first !== "'") || last !== first) return null;

  return unescapeCss(trimmed.slice(1, -1));
}

/**
 * Extract the address from a `url()` or `src()` token.
 *
 * Returns `null` for anything that is not one of those functions — including
 * bare quoted strings, so that `content: "url(fake)"` is never mistaken for a
 * reference to a file.
 */
export function parseCssUrl(token: string): string | null {
  const match = /^(?:url|src)\(([\s\S]*)\)$/i.exec(token.trim());
  if (!match) return null;

  const inner = match[1]?.trim() ?? '';
  if (inner.length === 0) return null;

  const quoted = unquoteCssString(inner);
  const url = (quoted ?? unescapeCss(inner)).trim();
  return url.length > 0 ? url : null;
}

/** Accept either a `url()` function or the bare quoted string `image-set()` allows. */
function parseImageToken(token: string): string | null {
  return parseCssUrl(token) ?? unquoteCssString(token);
}

/** Pull the argument out of a single-argument CSS function such as `type("image/webp")`. */
function functionArgument(token: string, name: string): string | null {
  const match = new RegExp(`^${name}\\(([\\s\\S]*)\\)$`, 'i').exec(token.trim());
  if (!match) return null;
  const inner = match[1]?.trim() ?? '';
  return unquoteCssString(inner) ?? unescapeCss(inner);
}

const IMAGE_SET = /^(?:-webkit-|-moz-)?image-set\(([\s\S]*)\)$/i;

/**
 * Parse `image-set()`, including the vendor-prefixed spellings still shipped
 * by build tools.
 *
 * Every candidate is reported, not just the one a given device would pick:
 * which entry wins depends on the display's pixel density and the browser's
 * format support, neither of which can be recovered from the computed value.
 */
export function parseImageSet(value: string): CssImageCandidate[] {
  const match = IMAGE_SET.exec(value.trim());
  if (!match) return [];

  const candidates: CssImageCandidate[] = [];

  for (const entry of splitCssList(match[1] ?? '')) {
    const tokens = splitCssTokens(entry);
    let url: string | null = null;
    let raw = entry;
    let descriptor: string | null = null;
    let mimeType: string | null = null;

    for (const token of tokens) {
      if (url === null) {
        const parsed = parseImageToken(token);
        if (parsed !== null) {
          url = parsed;
          raw = token;
          continue;
        }
      }

      const declaredType = functionArgument(token, 'type');
      if (declaredType !== null) {
        mimeType = declaredType;
        continue;
      }

      if (/^[\d.]+(?:x|dppx|dpi|dpcm)$/i.test(token) || /^\d+w$/i.test(token)) {
        descriptor = token;
      }
    }

    if (url !== null) candidates.push({ raw, url, descriptor, mimeType });
  }

  return candidates;
}

const GRADIENT = /(?:^|\s|-)gradient\(/i;

/**
 * Break an image-valued CSS property into its layers.
 *
 * Gradients and `none` are classified rather than dropped, because a layered
 * `background-image` is positionally meaningful — knowing that layer two of
 * three is a gradient is what lets a consumer reconstruct the stack instead of
 * silently collapsing it.
 */
export function parseCssImageLayers(value: string | null | undefined): CssImageLayer[] {
  if (!value) return [];

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === 'none') return [];

  return splitCssList(trimmed).map((raw) => {
    const lower = raw.toLowerCase();

    if (lower === 'none') return { raw, kind: 'none' as const, candidates: [] };

    const direct = parseCssUrl(raw);
    if (direct !== null) {
      return {
        raw,
        kind: 'url' as const,
        candidates: [{ raw, url: direct, descriptor: null, mimeType: null }],
      };
    }

    if (IMAGE_SET.test(raw)) {
      return { raw, kind: 'image-set' as const, candidates: parseImageSet(raw) };
    }

    if (GRADIENT.test(lower)) return { raw, kind: 'gradient' as const, candidates: [] };

    // `cross-fade()`, `image()`, `paint()` and anything a future spec adds:
    // scan for nested `url()` tokens rather than pretending to understand the
    // function. Missing a real asset is worse than reporting one without
    // knowing precisely how it composites.
    return { raw, kind: 'other' as const, candidates: findNestedUrls(raw) };
  });
}

/**
 * Collect every `url()` token nested anywhere inside a CSS value.
 *
 * Scanned rather than pattern-matched, because a regular expression cannot
 * tell a real reference from the characters `url(` sitting inside a string.
 * `content: "url(fake.png)"` is literal text, and reporting it as an asset
 * would send the user chasing a file that was never referenced.
 */
export function findNestedUrls(value: string): CssImageCandidate[] {
  const candidates: CssImageCandidate[] = [];
  let quote: string | null = null;
  let escaped = false;
  let index = 0;

  while (index < value.length) {
    const char = value[index];

    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/^(?:url|src)\($/i.test(value.slice(index, index + 4))) {
      // Guard against matching the tail of a longer identifier such as
      // `-webkit-cross-fade-url(`.
      if (!isNameChar(value[index - 1])) {
        const openIndex = index + 3;
        const closeIndex = findClosingParen(value, openIndex);
        if (closeIndex === -1) break;

        const inner = value.slice(openIndex + 1, closeIndex).trim();
        const url = (unquoteCssString(inner) ?? unescapeCss(inner)).trim();
        if (url.length > 0) {
          candidates.push({
            raw: value.slice(index, closeIndex + 1),
            url,
            descriptor: null,
            mimeType: null,
          });
        }

        index = closeIndex + 1;
        continue;
      }
    }

    index += 1;
  }

  return candidates;
}

function isNameChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_-]/.test(char);
}

/** Index of the `)` matching the `(` at `openIndex`, or -1 when unbalanced. */
function findClosingParen(value: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openIndex; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/**
 * Parse an `@font-face` `src` descriptor.
 *
 * `local()` entries are kept rather than filtered out: a face that resolves
 * locally on the author's machine and nowhere else is a real portability
 * problem, and it is invisible if the parser only reports downloadable URLs.
 */
export function parseFontFaceSrc(value: string | null | undefined): FontFaceSource[] {
  if (!value) return [];

  const sources: FontFaceSource[] = [];

  for (const entry of splitCssList(value)) {
    const tokens = splitCssTokens(entry);
    let url: string | null = null;
    let local: string | null = null;
    let format: string | null = null;
    let tech: string | null = null;

    for (const token of tokens) {
      if (url === null && local === null) {
        const parsedUrl = parseCssUrl(token);
        if (parsedUrl !== null) {
          url = parsedUrl;
          continue;
        }
        const parsedLocal = functionArgument(token, 'local');
        if (parsedLocal !== null) {
          local = parsedLocal;
          continue;
        }
      }

      const parsedFormat = functionArgument(token, 'format');
      if (parsedFormat !== null) {
        format = parsedFormat;
        continue;
      }

      const parsedTech = functionArgument(token, 'tech');
      if (parsedTech !== null) tech = parsedTech;
    }

    if (url !== null) sources.push({ kind: 'url', url, format, tech });
    else if (local !== null) sources.push({ kind: 'local', name: local });
  }

  return sources;
}
