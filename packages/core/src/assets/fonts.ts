import { parseFontFaceSrc } from './css-values.js';
import { buildAssetUsage, resolveReference } from './reference.js';
import type {
  AssetReference,
  FontFaceAsset,
  FontFaceSourceRef,
  InaccessibleStylesheet,
} from './types.js';

/** Everything the stylesheet sweep produced. */
export interface FontHarvest {
  fonts: FontFaceAsset[];
  references: AssetReference[];
  /** Sheets whose rules could not be read, so callers can qualify the result. */
  inaccessible: InaccessibleStylesheet[];
}

/**
 * `CSSRule.FONT_FACE_RULE`.
 *
 * `rule.type` is deprecated in favour of `instanceof CSSFontFaceRule`, but the
 * constructor is not reliably exposed in every environment this engine runs
 * in, and the numeric type has been stable for twenty years. Both are checked.
 */
const FONT_FACE_RULE = 5;
const IMPORT_RULE = 3;

/** Nesting limit for `@media`/`@supports`/`@import` recursion. */
const MAX_RULE_DEPTH = 8;

function isFontFaceRule(rule: CSSRule): boolean {
  return rule.type === FONT_FACE_RULE || rule.constructor?.name === 'CSSFontFaceRule';
}

function isImportRule(rule: CSSRule): boolean {
  return rule.type === IMPORT_RULE || rule.constructor?.name === 'CSSImportRule';
}

/**
 * Read the rules of a stylesheet, or say why they are unreadable.
 *
 * Accessing `cssRules` on a stylesheet loaded from another origin throws a
 * `SecurityError` unless it was served with permissive CORS headers. That is
 * not an edge case: it is the normal state of every font provider's stylesheet
 * on every site that uses one. Reporting the sheet as inaccessible is the
 * difference between "this page has no webfonts" and "this page's webfonts are
 * declared somewhere I am not allowed to look".
 */
export function readStyleSheetRules(
  sheet: CSSStyleSheet,
): { rules: CSSRule[] } | { inaccessible: InaccessibleStylesheet } {
  try {
    const rules = sheet.cssRules;
    if (!rules) {
      return { inaccessible: { href: sheet.href ?? null, reason: 'unreadable' } };
    }
    return { rules: Array.from(rules) };
  } catch {
    return { inaccessible: { href: sheet.href ?? null, reason: 'cross-origin' } };
  }
}

/**
 * Turn one `@font-face` rule into an asset record.
 *
 * Relative URLs inside a stylesheet resolve against *the stylesheet's* address,
 * not the document's. Getting this wrong is the classic webfont bug: a sheet at
 * `/assets/css/site.css` declaring `url(../fonts/x.woff2)` means
 * `/assets/fonts/x.woff2`, and resolving it against the page instead yields a
 * plausible-looking URL that points at nothing.
 */
export function readFontFaceRule(
  style: CSSStyleDeclaration,
  stylesheetHref: string | null,
  documentBaseUrl: string,
): { font: FontFaceAsset; references: AssetReference[] } {
  const read = (property: string): string | null => {
    try {
      const value = style.getPropertyValue(property);
      return value && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  };

  const baseUrl = stylesheetHref ?? documentBaseUrl;
  const family = stripQuotes(read('font-family'));
  const sources: FontFaceSourceRef[] = [];
  const references: AssetReference[] = [];

  for (const source of parseFontFaceSrc(read('src'))) {
    if (source.kind === 'local') {
      sources.push({ kind: 'local', value: source.name, raw: source.name, format: null, tech: null });
      continue;
    }

    const resolved = resolveReference(source.url, baseUrl);
    sources.push({
      kind: 'url',
      value: resolved.url,
      raw: source.url,
      format: source.format,
      tech: source.tech,
    });

    references.push({
      // Already-resolved, deliberately: the registry resolves against the
      // *document* base, which would undo the stylesheet-relative resolution
      // done above and point half the fonts at URLs that do not exist.
      raw: resolved.resolved ? resolved.url : source.url,
      kindHint: 'font',
      mimeHint: null,
      usage: buildAssetUsage('font-face-src', null, 'src', {
        descriptor: source.format,
        context: family ?? stylesheetHref,
      }),
    });
  }

  return {
    font: {
      family,
      style: read('font-style'),
      weight: read('font-weight'),
      display: read('font-display'),
      unicodeRange: read('unicode-range'),
      sources,
      stylesheet: stylesheetHref,
    },
    references,
  };
}

function stripQuotes(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const first = trimmed[0];
  if ((first === '"' || first === "'") && trimmed.endsWith(first)) return trimmed.slice(1, -1);
  return trimmed;
}

/**
 * Sweep a set of stylesheets for `@font-face` rules.
 *
 * Descends through `@media`, `@supports`, `@layer` and `@import`, because
 * webfonts routinely hide inside all four — a font declared under
 * `@supports (font-variation-settings: normal)` is invisible to a collector
 * that only reads top-level rules.
 *
 * Takes the sheets rather than a document so the recursion and the resolution
 * rules can be tested against hand-built rule trees.
 */
export function collectFontFaces(
  sheets: Iterable<CSSStyleSheet>,
  documentBaseUrl: string,
): FontHarvest {
  const fonts: FontFaceAsset[] = [];
  const references: AssetReference[] = [];
  const inaccessible: InaccessibleStylesheet[] = [];
  const visited = new Set<CSSStyleSheet>();

  const visitSheet = (sheet: CSSStyleSheet, depth: number): void => {
    if (depth > MAX_RULE_DEPTH || visited.has(sheet)) return;
    visited.add(sheet);

    const result = readStyleSheetRules(sheet);
    if ('inaccessible' in result) {
      inaccessible.push(result.inaccessible);
      return;
    }

    visitRules(result.rules, sheet.href ?? null, depth);
  };

  const visitRules = (rules: readonly CSSRule[], href: string | null, depth: number): void => {
    if (depth > MAX_RULE_DEPTH) return;

    for (const rule of rules) {
      if (isFontFaceRule(rule)) {
        const style = (rule as CSSFontFaceRule).style;
        if (!style) continue;
        const harvested = readFontFaceRule(style, href, documentBaseUrl);
        fonts.push(harvested.font);
        references.push(...harvested.references);
        continue;
      }

      if (isImportRule(rule)) {
        const imported = (rule as CSSImportRule).styleSheet;
        if (imported) visitSheet(imported, depth + 1);
        continue;
      }

      const grouped = (rule as CSSGroupingRule).cssRules;
      if (grouped) {
        try {
          visitRules(Array.from(grouped), href, depth + 1);
        } catch {
          inaccessible.push({ href, reason: 'unreadable' });
        }
      }
    }
  };

  for (const sheet of sheets) visitSheet(sheet, 0);

  return { fonts, references, inaccessible };
}

/**
 * Read the document's own stylesheets.
 *
 * The thin wrapper exists so the traversal above never has to know about a
 * `Document` — and so the `styleSheets` collection, which is live and throws
 * on iteration in some implementations, is normalized in exactly one place.
 */
export function readDocumentFontFaces(documentNode: Document, baseUrl: string): FontHarvest {
  let sheets: CSSStyleSheet[] = [];
  try {
    sheets = Array.from(documentNode.styleSheets);
  } catch {
    return { fonts: [], references: [], inaccessible: [{ href: null, reason: 'unreadable' }] };
  }
  return collectFontFaces(sheets, baseUrl);
}
