/**
 * Which font actually rendered — not which one was asked for.
 *
 * `getComputedStyle(el).fontFamily` returns the authored *stack*
 * (`Inter, system-ui, sans-serif`), never the face the browser picked from it.
 * Reporting the first entry is the single most-cited reliability failure of
 * existing inspectors: they confidently name a font the machine does not have
 * installed. This module resolves the stack the way the browser does — by
 * asking whether each family can actually be used, in order.
 *
 * Everything here is pure over an injected {@link FontProbes}. The DOM-backed
 * probes live in {@link createDomFontProbes}; the detection logic itself never
 * touches a canvas, which is what makes it testable outside a browser.
 */

/** How a family's availability was established. */
export type FontEvidence = 'font-face' | 'canvas-metrics' | 'generic' | 'indeterminate';

/** How the *rendered* family was identified, as reported to the UI. */
export type FontDetectionMethod = 'font-face' | 'canvas-metrics' | 'unknown';

/** One entry of the authored stack, with the verdict on whether it can render. */
export interface FontAvailability {
  family: string;
  available: boolean;
  /**
   * Why we believe that. `'indeterminate'` means we could not tell — the
   * `available: false` beside it is a placeholder, not a finding, and it
   * suppresses `rendered` for every family after it.
   */
  evidence: FontEvidence;
}

/** The result of resolving one authored font stack. */
export interface RenderedFamilyResult {
  /** The authored stack, split and unquoted, in cascade order. */
  stack: string[];
  /** The first usable family — what the browser rendered. `null` when unknown. */
  rendered: string | null;
  availability: FontAvailability[];
  method: FontDetectionMethod;
}

/**
 * Measure a string at a given CSS `font` shorthand, in CSS pixels.
 *
 * Returns `null` when the measurement cannot be trusted (no 2D context, the
 * shorthand was rejected, a non-finite width). Injected rather than imported so
 * detection can be unit-tested against a table of widths.
 */
export type MeasureText = (text: string, font: string) => number | null;

/** Everything detection is allowed to know about the host document's fonts. */
export interface FontProbes {
  /**
   * Lowercased families backed by a `@font-face` that has finished loading.
   * A declared-but-unloaded face is deliberately excluded: it is not rendering
   * anything yet, so claiming it would be a lie for the current paint.
   */
  loadedFamilies: ReadonlySet<string>;
  /**
   * `FontFaceSet.check()`-shaped fast path, or `null` when unavailable or
   * untrustworthy. See {@link createFontFaceChecker} for why "untrustworthy"
   * is a state this has to model.
   */
  checkFamily: ((family: string) => boolean) | null;
  /** Canvas measurement, or `null` when no 2D context could be obtained. */
  measureText: MeasureText | null;
}

/** A stack detector with per-family and per-stack memoization. */
export interface FontDetector {
  detect(stack: readonly string[]): RenderedFamilyResult;
}

/**
 * Sentinels the candidate is raced against.
 *
 * Three of them, because one is not enough: a candidate that happens to be
 * metrically identical to the sentinel (Arial vs. Liberation Sans, Helvetica vs.
 * Arial on many systems) measures the same width and would be scored missing.
 * A font that matches all three generics is vanishingly rare.
 */
const SENTINELS = ['monospace', 'serif', 'sans-serif'] as const;

/**
 * Glyphs chosen to maximize width divergence between faces: the `m`/`l`/`i`
 * run separates proportional from monospaced, the capitals and digits catch
 * faces that differ only in their uppercase or tabular metrics.
 */
const SAMPLE_TEXT = 'mmmmmmmmmmlliWWMMii0123456789';

/** Large enough that a one-percent metric difference clears the noise floor. */
const SAMPLE_SIZE_PX = 72;

/**
 * Width difference that counts as "a different font rendered".
 *
 * Canvas widths are fractional and deterministic for a given face, so identical
 * faces return bit-identical widths; the epsilon only absorbs float noise.
 */
const WIDTH_EPSILON = 0.02;

/**
 * The CSS 2.1 generics. Every UA resolves these to *something*, so a
 * measurement that says otherwise is the measurement being wrong.
 *
 * Deliberately excludes `system-ui` and the `ui-*` family: those are newer, and
 * a UA that does not know them drops them from the stack — exactly the case
 * detection needs to catch rather than assume away.
 */
const GUARANTEED_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy']);

/** Every generic keyword, for quoting decisions and for callers that ask. */
const GENERIC_FAMILIES = new Set([
  ...GUARANTEED_FAMILIES,
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);

/** Bare identifiers CSS accepts unquoted; anything else must be quoted. */
const BARE_IDENTIFIER = /^-?[A-Za-z_][A-Za-z0-9_-]*(?: [A-Za-z0-9_-]+)*$/;

/** Case-folded, whitespace-collapsed family name used as a map/set key. */
export function normalizeFamily(family: string): string {
  return family.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * True for a CSS generic keyword.
 *
 * Generics are not font names: they must never be quoted in a font shorthand
 * (`"monospace"` asks for a face literally called that), and they cannot be
 * looked up in a `@font-face` set.
 */
export function isGenericFamily(family: string): boolean {
  return GENERIC_FAMILIES.has(normalizeFamily(family));
}

/**
 * Split an authored `font-family` value into individual families.
 *
 * Commas inside quotes do not separate — `"Ampersand, Bold", serif` is two
 * entries, not three. Quotes are stripped and backslash escapes unwrapped so
 * the result can be compared against `FontFace.family`, which is unquoted.
 */
export function parseFontStack(fontFamily: string | null | undefined): string[] {
  if (!fontFamily) return [];

  const families: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of fontFamily) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ',') {
      families.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  families.push(current);

  return families.map((entry) => entry.trim().replace(/\s+/g, ' ')).filter((entry) => entry !== '');
}

/**
 * Quote a family for use in a `font` shorthand.
 *
 * Generics stay bare or they stop being generics; names with spaces, digits at
 * the front, or punctuation get quoted or the whole shorthand is rejected and
 * the canvas silently keeps its previous font.
 */
export function quoteFamily(family: string): string {
  if (isGenericFamily(family)) return normalizeFamily(family);
  if (BARE_IDENTIFIER.test(family)) return family;
  return `"${family.replace(/(["\\])/g, '\\$1')}"`;
}

/**
 * Build the shorthand that races `family` against `sentinel`.
 *
 * The sentinel is the fallback, not a separate measurement: if the family is
 * missing the browser falls through to the sentinel and the width comes out
 * identical to the sentinel measured alone. That equality *is* the signal.
 */
export function buildFontShorthand(
  family: string,
  sentinel: string,
  sizePx: number = SAMPLE_SIZE_PX,
): string {
  if (normalizeFamily(family) === normalizeFamily(sentinel)) return `${sizePx}px ${sentinel}`;
  return `${sizePx}px ${quoteFamily(family)}, ${sentinel}`;
}

/** Probes that know nothing — every non-guaranteed family comes back indeterminate. */
export function createEmptyFontProbes(): FontProbes {
  return { loadedFamilies: new Set(), checkFamily: null, measureText: null };
}

/**
 * Build a memoized detector over a set of probes.
 *
 * A page hands the same handful of stacks to thousands of elements, and each
 * uncached family costs up to six canvas measurements. The caches are per
 * detector, not module-global, so a caller inspecting a second document does
 * not inherit the first document's font availability.
 */
export function createFontDetector(probes: FontProbes): FontDetector {
  const byFamily = new Map<string, FontAvailability>();
  const byStack = new Map<string, RenderedFamilyResult>();
  const baselines = new Map<string, number | null>();

  function baselineWidth(sentinel: string): number | null {
    const cached = baselines.get(sentinel);
    if (cached !== undefined) return cached;
    const measured = probes.measureText
      ? probes.measureText(SAMPLE_TEXT, `${SAMPLE_SIZE_PX}px ${sentinel}`)
      : null;
    baselines.set(sentinel, measured);
    return measured;
  }

  /**
   * `true`/`false` from canvas metrics, `null` when nothing could be measured.
   * A single sentinel disagreeing is enough — that can only happen if the
   * candidate overrode the fallback.
   */
  function measureAvailability(family: string): boolean | null {
    const { measureText } = probes;
    if (!measureText) return null;

    let measuredAnything = false;

    for (const sentinel of SENTINELS) {
      if (normalizeFamily(family) === sentinel) continue;

      const baseline = baselineWidth(sentinel);
      if (baseline === null) continue;

      const candidate = measureText(SAMPLE_TEXT, buildFontShorthand(family, sentinel));
      if (candidate === null) continue;

      measuredAnything = true;
      if (Math.abs(candidate - baseline) > WIDTH_EPSILON) return true;
    }

    return measuredAnything ? false : null;
  }

  function resolveFamily(family: string): FontAvailability {
    const key = normalizeFamily(family);
    const cached = byFamily.get(key);
    if (cached) return cached;

    const verdict = classify(family, key);
    byFamily.set(key, verdict);
    return verdict;
  }

  function classify(family: string, key: string): FontAvailability {
    const guaranteed = GUARANTEED_FAMILIES.has(key);
    // Generics are keywords, not faces: they are never in the font set, and
    // asking `check()` about them would label a keyword as `@font-face`
    // evidence. They go straight to measurement, which can actually tell
    // whether this engine knows `ui-rounded` or `system-ui` at all.
    const generic = isGenericFamily(family);

    // A loaded @font-face is the strongest signal there is, and it skips six
    // canvas measurements for the webfont case that matters most.
    if (!generic && probes.loadedFamilies.has(key)) {
      return { family, available: true, evidence: 'font-face' };
    }

    const checked = !generic && probes.checkFamily ? probes.checkFamily(family) : null;
    if (checked === true) return { family, available: true, evidence: 'font-face' };

    const measured = measureAvailability(family);
    if (measured === true) return { family, available: true, evidence: 'canvas-metrics' };
    if (measured === false && !guaranteed) {
      return { family, available: false, evidence: 'canvas-metrics' };
    }

    // Some systems map every generic onto the same physical face, which makes
    // the sentinel race come out flat. The spec still guarantees these resolve,
    // so structure beats measurement here.
    if (guaranteed) return { family, available: true, evidence: 'generic' };

    if (checked === false) return { family, available: false, evidence: 'font-face' };

    return { family, available: false, evidence: 'indeterminate' };
  }

  function detect(stack: readonly string[]): RenderedFamilyResult {
    const cacheKey = stack.join(',');
    const cached = byStack.get(cacheKey);
    if (cached) return cached;

    const availability = stack.map(resolveFamily);
    const result: RenderedFamilyResult = {
      stack: [...stack],
      ...resolveWinner(availability),
      availability,
    };

    byStack.set(cacheKey, result);
    return result;
  }

  return { detect };
}

/**
 * Pick the rendered family out of an evaluated stack.
 *
 * The honesty rule lives here: an indeterminate family *ahead* of the first
 * available one poisons the answer, because that unknown family may well be the
 * one that rendered. Saying "we don't know" beats naming the wrong font, which
 * is the exact failure this module exists to fix.
 */
function resolveWinner(
  availability: readonly FontAvailability[],
): { rendered: string | null; method: FontDetectionMethod } {
  let sawCanvas = false;
  let sawFontFace = false;

  for (const entry of availability) {
    if (entry.evidence === 'indeterminate') return { rendered: null, method: 'unknown' };

    if (entry.available) {
      if (entry.evidence === 'font-face') return { rendered: entry.family, method: 'font-face' };
      if (entry.evidence === 'canvas-metrics') {
        return { rendered: entry.family, method: 'canvas-metrics' };
      }
      // A guaranteed generic won by elimination: the method that got us here is
      // whatever ruled out the families ahead of it. With nothing ahead of it
      // (`font-family: monospace`) no detection ran at all, so the method — not
      // the answer — is what is unknown.
      if (sawCanvas) return { rendered: entry.family, method: 'canvas-metrics' };
      if (sawFontFace) return { rendered: entry.family, method: 'font-face' };
      return { rendered: entry.family, method: 'unknown' };
    }

    if (entry.evidence === 'canvas-metrics') sawCanvas = true;
    if (entry.evidence === 'font-face') sawFontFace = true;
  }

  return { rendered: null, method: 'unknown' };
}

/** One-shot detection. Prefer {@link createFontDetector} when scanning a page. */
export function detectRenderedFamily(
  stack: readonly string[],
  probes: FontProbes,
): RenderedFamilyResult {
  return createFontDetector(probes).detect(stack);
}

/**
 * A canvas-backed {@link MeasureText}, or `null` when 2D canvas is unavailable.
 *
 * Guards the assignment trap: assigning an invalid `font` shorthand to a 2D
 * context is a silent no-op, leaving the previous font in place — every
 * subsequent width would then be measured with the wrong face and every family
 * would look identical. Reading the value back catches that.
 */
export function createCanvasMeasurer(doc: Document): MeasureText | null {
  let context: CanvasRenderingContext2D | null = null;
  try {
    const canvas = doc.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    context = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!context) return null;

  const ctx = context;
  return (text, font) => {
    try {
      ctx.font = font;
      const readback = ctx.font;
      if (typeof readback !== 'string' || !readback.startsWith(font.split(' ')[0] ?? '')) {
        return null;
      }
      const width = ctx.measureText(text).width;
      return Number.isFinite(width) ? width : null;
    } catch {
      return null;
    }
  };
}

/** A family name no document will ever declare, used to calibrate `check()`. */
const CALIBRATION_FAMILY = '__open_inspector_absent_family__';

/**
 * Wrap `FontFaceSet.check()` — but only if this engine's `check()` can say no.
 *
 * Some engines answer `true` for *any* family, because the last-resort font can
 * always render the sample; a fast path that never returns false is worse than
 * no fast path, since it would mark every missing font as present. Calibrating
 * against a family that cannot exist detects that implementation and disables
 * it, leaving canvas metrics to do the work.
 */
export function createFontFaceChecker(
  fonts: Pick<FontFaceSet, 'check'> | undefined,
): ((family: string) => boolean) | null {
  if (!fonts || typeof fonts.check !== 'function') return null;

  const probe = (family: string): boolean | null => {
    try {
      return fonts.check(`${SAMPLE_SIZE_PX}px ${quoteFamily(family)}`);
    } catch {
      return null;
    }
  };

  const calibration = probe(CALIBRATION_FAMILY);
  if (calibration !== false) return null;

  return (family) => probe(family) === true;
}

/**
 * Lowercased families of every `@font-face` that has finished loading.
 *
 * `FontFace.family` arrives quoted when the name needs quoting, and iteration
 * shapes differ between engines, so both are normalized defensively — a font
 * panel is not worth a thrown exception.
 */
export function readLoadedFamilies(fonts: FontFaceSet | undefined): Set<string> {
  const families = new Set<string>();
  if (!fonts) return families;

  const add = (face: FontFace): void => {
    if (face.status !== 'loaded') return;
    const parsed = parseFontStack(face.family);
    const first = parsed[0];
    if (first) families.add(normalizeFamily(first));
  };

  try {
    if (typeof fonts.forEach === 'function') {
      fonts.forEach(add);
    } else if (typeof fonts[Symbol.iterator] === 'function') {
      for (const face of fonts) add(face);
    }
  } catch {
    // A partial set beats no font panel; unreadable entries just stay unknown.
  }

  return families;
}

/**
 * Assemble the real probes for a document.
 *
 * Every piece degrades independently: no canvas still leaves `@font-face` data,
 * no `FontFaceSet` still leaves canvas metrics, and neither leaves an honest
 * `rendered: null` rather than a guess.
 */
export function createDomFontProbes(doc: Document = document): FontProbes {
  const fonts: FontFaceSet | undefined = doc.fonts ?? undefined;
  return {
    loadedFamilies: readLoadedFamilies(fonts),
    checkFamily: createFontFaceChecker(fonts),
    measureText: createCanvasMeasurer(doc),
  };
}
