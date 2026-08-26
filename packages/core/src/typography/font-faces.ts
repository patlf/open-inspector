/**
 * The `@font-face` inventory of a document.
 *
 * Two things make this harder than "loop over the stylesheets". Cross-origin
 * sheets throw a `SecurityError` the moment `.cssRules` is touched, so a naive
 * walk dies on the first Google Fonts link and reports nothing; and `@font-face`
 * legitimately hides inside `@media`, `@supports`, `@layer` and `@import`, so a
 * flat scan of the top level misses real declarations. Unreadable sheets are
 * reported as unreadable rather than skipped — an inventory that quietly omits
 * half the fonts is worse than one that says which half it could not see.
 */

/** Where a font binary comes from, as far as the URL can tell us. */
export type FontSourceKind =
  | 'local'
  | 'data-uri'
  | 'self-hosted'
  | 'google-fonts'
  | 'cdn'
  | 'unknown';

/** One entry of a `src:` descriptor. */
export interface FontFaceSource {
  /** The URL exactly as authored, or the face name for `local()`. */
  url: string;
  /** From `format(...)`, or inferred from the file extension when omitted. */
  format: string | null;
  kind: FontSourceKind;
  /** Host of the resolved URL. `null` for `local()`, data URIs and unresolvable ones. */
  host: string | null;
}

/** A numeric weight or a variable-font weight range. */
export interface WeightRange {
  min: number;
  max: number;
}

/** One `@font-face` rule, flattened. */
export interface FontFaceRecord {
  family: string;
  sources: FontFaceSource[];
  /** The descriptor as authored, e.g. `400`, `bold`, or `100 900`. */
  weight: string;
  /** Parsed form of {@link weight}; `null` when it is not a weight we can read. */
  weightRange: WeightRange | null;
  style: string;
  stretch: string | null;
  unicodeRange: string | null;
  display: string | null;
  /** Stylesheet href; `null` for inline `<style>` and constructed sheets. */
  href: string | null;
}

/** A stylesheet whose rules could not be read, and why. */
export interface UnreadableStyleSheet {
  href: string | null;
  /**
   * `cross-origin` is the ordinary case — a third-party font or CSS host that
   * did not send CORS headers. `error` is anything else the engine threw.
   */
  reason: 'cross-origin' | 'error';
  message: string;
}

/** The result of a whole-document scan. */
export interface FontFaceInventory {
  faces: FontFaceRecord[];
  unreadable: UnreadableStyleSheet[];
}

/** Context needed to resolve and classify a `src` URL. */
export interface FontSourceContext {
  /** Absolute href of the stylesheet, used as the base for relative URLs. */
  baseHref: string | null;
  /** The inspected page's URL, used to tell self-hosted from third-party. */
  pageUrl: string | null;
}

/** Hosts that serve Google Fonts, including the binary host `fonts.gstatic.com`. */
const GOOGLE_FONT_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'themes.googleusercontent.com',
]);

/**
 * Font CDNs worth naming. Any other cross-origin host also lands on `'cdn'`;
 * this list only exists so the common ones are recognized as *known* CDNs
 * rather than as an unclassified third party.
 */
const KNOWN_CDN_HOSTS = new Set([
  'use.typekit.net',
  'p.typekit.net',
  'use.typekit.com',
  'fonts.bunny.net',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'fast.fonts.net',
  'fast.fonts.com',
  'use.fontawesome.com',
  'kit.fontawesome.com',
  'cloud.typography.com',
  'static.parastorage.com',
  'cdn.shopify.com',
  'fonts.shopifycdn.com',
]);

/** Extension to `format()` value, for the many rules that omit `format()`. */
const FORMAT_BY_EXTENSION = new Map<string, string>([
  ['woff2', 'woff2'],
  ['woff', 'woff'],
  ['ttf', 'truetype'],
  ['otf', 'opentype'],
  ['ttc', 'collection'],
  ['eot', 'embedded-opentype'],
  ['svg', 'svg'],
  ['svgz', 'svg'],
]);

/** `CSSRule.FONT_FACE_RULE`. Deprecated in the spec, still the most portable check. */
const FONT_FACE_RULE_TYPE = 5;

/** `CSSRule.IMPORT_RULE`. */
const IMPORT_RULE_TYPE = 3;

/** Guards against `@import` cycles, which are legal and do occur. */
const MAX_SHEET_DEPTH = 16;

/**
 * Split a CSS value on top-level commas.
 *
 * Commas inside `url("a,b.woff")` or inside a `format(...)` argument are part of
 * the value, not separators — splitting naively produces phantom sources.
 */
export function splitTopLevel(value: string, separator = ','): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | null = null;
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
    if (quote) {
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** Strip matching quotes and unwrap backslash escapes from a CSS string token. */
function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  if ((first === '"' || first === "'") && trimmed.endsWith(first) && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return trimmed.replace(/\\(.)/g, '$1');
}

/**
 * Pull `name(argument)` pairs out of one `src` component.
 *
 * Hand-scanned rather than matched with a regular expression because an
 * unquoted `url(...)` may contain parentheses and quoted arguments may contain
 * anything at all.
 */
function parseFunctions(component: string): Array<{ name: string; argument: string }> {
  const functions: Array<{ name: string; argument: string }> = [];
  let index = 0;

  while (index < component.length) {
    const open = component.indexOf('(', index);
    if (open === -1) break;

    const name = component.slice(index, open).trim().replace(/^[,\s]+/, '').toLowerCase();

    let depth = 1;
    let quote: '"' | "'" | null = null;
    let cursor = open + 1;
    for (; cursor < component.length && depth > 0; cursor += 1) {
      const char = component[cursor];
      if (quote) {
        if (char === '\\') cursor += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
    }

    functions.push({ name, argument: component.slice(open + 1, Math.max(open + 1, cursor - 1)) });
    index = cursor;
  }

  return functions;
}

/** Best-effort `format()` from a file extension, for rules that omit it. */
function inferFormat(url: string): string | null {
  const withoutQuery = url.split(/[?#]/)[0] ?? '';
  const extension = withoutQuery.split('.').pop()?.toLowerCase() ?? '';
  return FORMAT_BY_EXTENSION.get(extension) ?? null;
}

/** True when `host` is the page host or a subdomain of it (or vice versa). */
function isSameSite(host: string, pageHost: string): boolean {
  if (host === pageHost) return true;
  return host.endsWith(`.${pageHost}`) || pageHost.endsWith(`.${host}`);
}

/**
 * Decide where a font is served from.
 *
 * The self-hosted test is deliberately conservative: exact host or a
 * parent/child subdomain relationship, never a guessed registrable domain.
 * Guessing needs a public-suffix list, and without one `evil.co.uk` would be
 * scored as the same site as `example.co.uk`. A sibling host such as
 * `static.example.com` alongside `www.example.com` is reported as a CDN with
 * its host shown, which is honest and lets the reader decide.
 */
export function classifyFontSource(
  rawUrl: string,
  context: FontSourceContext = { baseHref: null, pageUrl: null },
): { kind: FontSourceKind; host: string | null } {
  const url = rawUrl.trim();
  if (url === '') return { kind: 'unknown', host: null };
  if (/^data:/i.test(url)) return { kind: 'data-uri', host: null };

  const base = context.baseHref ?? context.pageUrl ?? undefined;
  let host: string;
  let protocol: string;
  try {
    const resolved = new URL(url, base);
    host = resolved.host.toLowerCase();
    protocol = resolved.protocol.toLowerCase();
  } catch {
    // A relative URL with no base still tells us something: it can only resolve
    // against the document that declared it.
    return /^[a-z][a-z0-9+.-]*:/i.test(url)
      ? { kind: 'unknown', host: null }
      : { kind: 'self-hosted', host: null };
  }

  // A hostless URL is either a local file — still the page's own — or an opaque
  // scheme such as `about:` or `blob:`, which says nothing about provenance.
  if (host === '') {
    return protocol === 'file:'
      ? { kind: 'self-hosted', host: null }
      : { kind: 'unknown', host: null };
  }
  if (GOOGLE_FONT_HOSTS.has(host)) return { kind: 'google-fonts', host };

  let pageHost: string | null = null;
  if (context.pageUrl) {
    try {
      pageHost = new URL(context.pageUrl).host.toLowerCase();
    } catch {
      pageHost = null;
    }
  }

  if (pageHost && isSameSite(host, pageHost)) return { kind: 'self-hosted', host };
  if (KNOWN_CDN_HOSTS.has(host)) return { kind: 'cdn', host };
  if (!pageHost) return { kind: 'unknown', host };
  return { kind: 'cdn', host };
}

/**
 * Parse a `src:` descriptor into its individual sources.
 *
 * Handles the shapes that actually appear in the wild: quoted and unquoted
 * `url()`, `local()` name fallbacks, missing `format()`, and the `tech()`
 * function that newer variable-font rules add after the format.
 */
export function parseFontFaceSrc(
  src: string | null | undefined,
  context: FontSourceContext = { baseHref: null, pageUrl: null },
): FontFaceSource[] {
  if (!src) return [];

  const sources: FontFaceSource[] = [];

  for (const component of splitTopLevel(src)) {
    const functions = parseFunctions(component);
    const target = functions.find((entry) => entry.name === 'url' || entry.name === 'local');
    if (!target) continue;

    const value = unquote(target.argument);
    if (value === '') continue;

    const formatFunction = functions.find((entry) => entry.name === 'format');
    const format = formatFunction ? unquote(formatFunction.argument) || null : null;

    if (target.name === 'local') {
      sources.push({ url: value, format, kind: 'local', host: null });
      continue;
    }

    const { kind, host } = classifyFontSource(value, context);
    sources.push({ url: value, format: format ?? inferFormat(value), kind, host });
  }

  return sources;
}

/**
 * Parse a `font-weight` descriptor, which unlike the property may be a range.
 *
 * `100 900` is how variable fonts declare their axis; reporting only the first
 * number would hide the entire point of the font.
 */
export function parseWeightRange(value: string | null | undefined): WeightRange | null {
  const raw = (value ?? '').trim().toLowerCase();
  if (raw === '') return null;
  if (raw === 'normal') return { min: 400, max: 400 };
  if (raw === 'bold') return { min: 700, max: 700 };

  const numbers = raw
    .split(/\s+/)
    .map((part) => Number.parseFloat(part))
    .filter((part) => Number.isFinite(part));

  const min = numbers[0];
  if (min === undefined) return null;
  const max = numbers[1] ?? min;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

/** The subset of `CSSStyleDeclaration` a `@font-face` rule is read through. */
export interface FontFaceDeclarations {
  getPropertyValue(property: string): string;
}

function descriptor(style: FontFaceDeclarations, property: string): string {
  try {
    const value = style.getPropertyValue(property);
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

function optionalDescriptor(style: FontFaceDeclarations, property: string): string | null {
  const value = descriptor(style, property);
  return value === '' ? null : value;
}

/**
 * Flatten one `@font-face` rule.
 *
 * The family arrives quoted in most engines (`"Inter Display"`), so it is
 * unquoted here to match what `font-family` stacks and `FontFace.family` say —
 * otherwise cross-referencing the two never matches.
 */
export function readFontFaceRule(
  style: FontFaceDeclarations,
  href: string | null = null,
  pageUrl: string | null = null,
): FontFaceRecord {
  const weight = descriptor(style, 'font-weight');
  const context: FontSourceContext = { baseHref: href, pageUrl };

  return {
    family: unquote(descriptor(style, 'font-family')),
    sources: parseFontFaceSrc(descriptor(style, 'src'), context),
    weight,
    weightRange: parseWeightRange(weight),
    style: descriptor(style, 'font-style') || 'normal',
    stretch: optionalDescriptor(style, 'font-stretch'),
    unicodeRange: optionalDescriptor(style, 'unicode-range'),
    display: optionalDescriptor(style, 'font-display'),
    href,
  };
}

/** True for a `@font-face` rule, across engines that disagree about how to tell. */
export function isFontFaceRule(rule: CSSRule): boolean {
  if (rule.type === FONT_FACE_RULE_TYPE) return true;
  const name: unknown = (rule as { constructor?: { name?: string } }).constructor?.name;
  return name === 'CSSFontFaceRule';
}

/** Nested rule containers: `@media`, `@supports`, `@layer`, `@container`. */
function childRules(rule: CSSRule): CSSRuleList | null {
  const rules: unknown = (rule as { cssRules?: unknown }).cssRules;
  return rules ? (rules as CSSRuleList) : null;
}

/** `@import`ed sheets are separate sheets and need the same cross-origin guard. */
function importedSheet(rule: CSSRule): CSSStyleSheet | null {
  if (rule.type !== IMPORT_RULE_TYPE) return null;
  try {
    return (rule as CSSImportRule).styleSheet ?? null;
  } catch {
    return null;
  }
}

/**
 * Walk every stylesheet in a document and collect its `@font-face` rules.
 *
 * Includes `document.adoptedStyleSheets`, where design systems that render into
 * shadow roots keep their font declarations — those sheets have no `href` and
 * never appear in `document.styleSheets`.
 */
export function collectFontFaces(doc: Document = document): FontFaceInventory {
  const faces: FontFaceRecord[] = [];
  const unreadable: UnreadableStyleSheet[] = [];
  const visited = new Set<CSSStyleSheet>();
  const pageUrl = typeof doc.baseURI === 'string' && doc.baseURI !== '' ? doc.baseURI : null;

  function visitRules(rules: CSSRuleList, href: string | null, depth: number): void {
    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules.item(index);
      if (!rule) continue;

      if (isFontFaceRule(rule)) {
        faces.push(readFontFaceRule((rule as CSSFontFaceRule).style, href, pageUrl));
        continue;
      }

      const imported = importedSheet(rule);
      if (imported) {
        visitSheet(imported, depth + 1);
        continue;
      }

      const nested = childRules(rule);
      if (nested) visitRules(nested, href, depth);
    }
  }

  function visitSheet(sheet: CSSStyleSheet, depth: number): void {
    if (depth > MAX_SHEET_DEPTH || visited.has(sheet)) return;
    visited.add(sheet);

    const href = sheet.href ?? null;
    let rules: CSSRuleList | null = null;

    try {
      rules = sheet.cssRules;
    } catch (error) {
      // The whole point of the try: one uncaught SecurityError here is the
      // difference between a partial inventory and no inventory at all.
      const name = error instanceof Error ? error.name : '';
      const message = error instanceof Error ? error.message : String(error);
      unreadable.push({
        href,
        reason: name === 'SecurityError' ? 'cross-origin' : 'error',
        message,
      });
      return;
    }

    if (!rules) {
      unreadable.push({ href, reason: 'error', message: 'stylesheet exposed no rules' });
      return;
    }

    visitRules(rules, href, depth);
  }

  const sheets: CSSStyleSheet[] = [];
  try {
    sheets.push(...Array.from(doc.styleSheets));
  } catch {
    // Accessing the list itself should not throw, but a hostile page can
    // shadow it; an empty list is still a usable answer.
  }
  const adopted: readonly CSSStyleSheet[] = doc.adoptedStyleSheets ?? [];
  sheets.push(...adopted);

  for (const sheet of sheets) visitSheet(sheet, 0);

  return { faces, unreadable };
}
