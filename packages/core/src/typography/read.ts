/**
 * Everything about how one element's text is set.
 *
 * The split is deliberate: {@link buildTypography} is pure over a computed
 * style declaration and a font-detection result, and {@link readTypography} is
 * the thin DOM wrapper that produces those two inputs. No DOM implementation
 * outside a real browser resolves `line-height: 1.5` into pixels, so the
 * arithmetic has to be separable from the measurement to be testable at all.
 */

import { parsePx, round } from '../geometry/rect.js';
import type { FontDetector, RenderedFamilyResult } from './rendered-family.js';
import { createDomFontProbes, createFontDetector, parseFontStack } from './rendered-family.js';

/** A length reported both in pixels and in root-relative units. */
export interface RemLength {
  px: number;
  /** `null` when the root font size is unusable, so the ratio would be a lie. */
  rem: number | null;
}

/**
 * A length whose computed value may be the keyword `normal`.
 *
 * `normal` is not zero and not a number: for `line-height` it is a
 * font-metrics-derived value the CSSOM never exposes, and for `letter-spacing`
 * it permits the engine to apply its own kerning. Both are reported as
 * `kind: 'normal'` with null numbers rather than a made-up `1.2`.
 */
export interface KeywordLength {
  kind: 'normal' | 'length';
  px: number | null;
  /** For line height, the unitless ratio designers actually author. */
  ratio: number | null;
}

/** Numeric weight plus the name a designer would call it. */
export interface FontWeightInfo {
  /** `null` when the engine reported a relative keyword we cannot resolve. */
  value: number | null;
  /** Nearest named stop, e.g. `Semi Bold`. `null` when `value` is null. */
  name: string | null;
  /** False for in-between variable-font weights like 450, where `name` is approximate. */
  exact: boolean;
}

/** The decoration longhands, read individually because the shorthand is unreliable. */
export interface TextDecorationInfo {
  line: string;
  style: string;
  color: string;
  thickness: string;
}

/** OpenType-facing properties, the ones that explain "why does it look different". */
export interface FontVariantInfo {
  variant: string;
  caps: string;
  numeric: string;
  ligatures: string;
  featureSettings: string;
  variationSettings: string;
  kerning: string;
}

/** Vendor smoothing hints. `null` when the engine does not expose the property. */
export interface FontSmoothingInfo {
  webkit: string | null;
  mozOsx: string | null;
}

/**
 * The full type readout for one element.
 *
 * Keyword-valued fields are plain strings; an empty string means the engine did
 * not report that property at all, which is distinct from the CSS keyword
 * `'normal'`.
 */
export interface Typography {
  family: RenderedFamilyResult;
  size: RemLength;
  weight: FontWeightInfo;
  style: string;
  lineHeight: KeywordLength;
  letterSpacing: KeywordLength;
  wordSpacing: KeywordLength;
  textTransform: string;
  textAlign: string;
  textDecoration: TextDecorationInfo;
  variant: FontVariantInfo;
  smoothing: FontSmoothingInfo;
}

/** Options for {@link readTypography}. */
export interface TypographyOptions {
  /** Defaults to the element's own `defaultView`, falling back to `window`. */
  view?: Window;
  /** Share one detector across a scan so font probing is measured once per family. */
  detector?: FontDetector;
  /** Override the `rem` basis; otherwise read from the document element. */
  rootFontSizePx?: number;
}

/** The CSS default, used only when the document element reports nothing usable. */
const FALLBACK_ROOT_FONT_SIZE = 16;

/** Named weight stops. Variable fonts land between them; see {@link FontWeightInfo}. */
const WEIGHT_NAMES = new Map<number, string>([
  [100, 'Thin'],
  [200, 'Extra Light'],
  [300, 'Light'],
  [400, 'Regular'],
  [500, 'Medium'],
  [600, 'Semi Bold'],
  [700, 'Bold'],
  [800, 'Extra Bold'],
  [900, 'Black'],
]);

/** Trim a computed keyword, mapping absent values to `''`. */
function keyword(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read a property the CSSOM interface does not type.
 *
 * Vendor smoothing properties are absent from `CSSStyleDeclaration`, and the
 * engines that do not implement them return `''` rather than throwing — which
 * is exactly the distinction the caller needs.
 */
function customProperty(style: CSSStyleDeclaration, property: string): string | null {
  const read = style.getPropertyValue;
  if (typeof read !== 'function') return null;
  try {
    const value = read.call(style, property);
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Turn a computed `font-weight` into a number and a name.
 *
 * Computed values are numeric in every current engine, but `normal` and `bold`
 * still come back from some CSSOM shims, and the relative keywords
 * `lighter`/`bolder` are unresolvable without the parent's weight — reported as
 * null rather than silently assumed to be 400.
 */
export function describeFontWeight(value: string | null | undefined): FontWeightInfo {
  const raw = keyword(value).toLowerCase();
  if (raw === '') return { value: null, name: null, exact: false };

  const numeric =
    raw === 'normal' ? 400 : raw === 'bold' ? 700 : Number.parseFloat(raw);

  if (!Number.isFinite(numeric)) return { value: null, name: null, exact: false };

  const exactName = WEIGHT_NAMES.get(numeric);
  if (exactName) return { value: numeric, name: exactName, exact: true };

  // Variable fonts hand out weights like 450. Round to the nearest stop and say
  // so, rather than inventing a name nobody uses.
  const nearest = Math.min(900, Math.max(100, Math.round(numeric / 100) * 100));
  return { value: numeric, name: WEIGHT_NAMES.get(nearest) ?? null, exact: false };
}

/**
 * Interpret a length that may be the keyword `normal`.
 *
 * `basisPx` is the element's font size; it converts a pixel line height into
 * the unitless ratio and a pixel letter spacing into ems. A zero or missing
 * basis yields a null ratio instead of `Infinity`.
 */
export function readKeywordLength(
  value: string | null | undefined,
  basisPx: number,
): KeywordLength {
  const raw = keyword(value);
  if (raw === '' || raw.toLowerCase() === 'normal') {
    return { kind: 'normal', px: null, ratio: null };
  }

  const px = round(parsePx(raw));
  const ratio = basisPx > 0 ? round(px / basisPx, 3) : null;
  return { kind: 'length', px, ratio };
}

/**
 * Assemble the readout from a computed style.
 *
 * Worth knowing about `textDecoration`: an underline set on an ancestor paints
 * through its descendants, but the descendant's own computed
 * `text-decoration-line` is still `none`. This reports what the element
 * declares, not what is painted over it.
 */
export function buildTypography(
  style: CSSStyleDeclaration,
  family: RenderedFamilyResult,
  rootFontSizePx: number = FALLBACK_ROOT_FONT_SIZE,
): Typography {
  const sizePx = round(parsePx(style.fontSize));
  const rootPx = rootFontSizePx > 0 ? rootFontSizePx : 0;

  return {
    family,
    size: { px: sizePx, rem: rootPx > 0 ? round(sizePx / rootPx, 4) : null },
    weight: describeFontWeight(style.fontWeight),
    style: keyword(style.fontStyle),
    lineHeight: readKeywordLength(style.lineHeight, sizePx),
    letterSpacing: readKeywordLength(style.letterSpacing, sizePx),
    wordSpacing: readKeywordLength(style.wordSpacing, sizePx),
    textTransform: keyword(style.textTransform),
    textAlign: keyword(style.textAlign),
    textDecoration: {
      line: keyword(style.textDecorationLine),
      style: keyword(style.textDecorationStyle),
      color: keyword(style.textDecorationColor),
      thickness: keyword(style.textDecorationThickness),
    },
    variant: {
      variant: keyword(style.fontVariant),
      caps: keyword(style.fontVariantCaps),
      numeric: keyword(style.fontVariantNumeric),
      ligatures: keyword(style.fontVariantLigatures),
      featureSettings: keyword(style.fontFeatureSettings),
      variationSettings: keyword(style.fontVariationSettings),
      kerning: keyword(style.fontKerning),
    },
    smoothing: {
      webkit: customProperty(style, '-webkit-font-smoothing'),
      mozOsx: customProperty(style, '-moz-osx-font-smoothing'),
    },
  };
}

/**
 * The pixel value one `rem` resolves to.
 *
 * Never assume 16: the `html { font-size: 62.5% }` trick makes it 10, and a
 * user's browser font-size setting moves it for everyone. Getting this wrong
 * misreports every size in the panel.
 */
export function readRootFontSize(doc: Document, view: Window): number {
  const root = doc.documentElement;
  if (!root) return FALLBACK_ROOT_FONT_SIZE;
  const size = parsePx(view.getComputedStyle(root).fontSize);
  return size > 0 ? size : FALLBACK_ROOT_FONT_SIZE;
}

/**
 * Read one element's typography, including which font really rendered.
 *
 * Pass a shared `detector` when reading more than one element: font probing is
 * the expensive part, and the detector caches per family across the page.
 */
export function readTypography(element: Element, options: TypographyOptions = {}): Typography {
  const doc = element.ownerDocument;
  const view = options.view ?? doc.defaultView ?? window;
  const style = view.getComputedStyle(element);

  const detector = options.detector ?? createFontDetector(createDomFontProbes(doc));
  const family = detector.detect(parseFontStack(style.fontFamily));

  const rootFontSize = options.rootFontSizePx ?? readRootFontSize(doc, view);
  return buildTypography(style, family, rootFontSize);
}
