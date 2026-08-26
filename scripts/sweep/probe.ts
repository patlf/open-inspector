import {
  a11y,
  assets,
  cascade,
  color,
  describeElement,
  layout,
  readBoxModel,
  tokens,
  typography,
} from '@open-inspector/core';

/**
 * The reliability probe: run every part of the engine over a real page and
 * record what breaks.
 *
 * Bundled standalone and injected into the page under test, so it exercises
 * the engine exactly as the extension would but without needing an extension —
 * the engine is the layer that meets pages nobody wrote for us, and it is
 * where the interesting failures are.
 *
 * Two kinds of finding matter here and they are reported separately:
 *   - **errors**: something threw. Always a bug.
 *   - **suspicions**: it returned, but the answer looks wrong — no rendered
 *     font on visible text, an empty palette on a colourful page. These are
 *     where silent wrongness hides, and a tool that only catches exceptions
 *     never finds them.
 */

interface Finding {
  stage: string;
  selector?: string;
  message: string;
}

interface SweepOutcome {
  elementsProbed: number;
  failures: Finding[];
  suspicions: Finding[];
  timings: Record<string, number>;
  stats: Record<string, number | string | boolean>;
}

/** How many elements to drive the per-element path over. */
const SAMPLE_SIZE = 60;
const ELEMENT_BUDGET = 2500;

function now(): number {
  return performance.now();
}

function label(element: Element): string {
  try {
    return describeElement(element).selectorLabel.slice(0, 60);
  } catch {
    return element.tagName?.toLowerCase() ?? '<unknown>';
  }
}

/**
 * Spread the sample across the document rather than taking the first N.
 *
 * The first sixty elements of any page are the header. Failures cluster in
 * the parts nobody thinks about — footers, embedded widgets, tables.
 */
function sampleElements(limit: number): Element[] {
  const all = Array.from(document.querySelectorAll<Element>('*')).filter((element) => {
    const tag = element.tagName;
    return tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'META' && tag !== 'LINK';
  });

  if (all.length <= limit) return all;

  const step = all.length / limit;
  const picked: Element[] = [];
  for (let i = 0; i < limit; i += 1) {
    const element = all[Math.floor(i * step)];
    if (element) picked.push(element);
  }
  return picked;
}

function hasVisibleText(element: Element): boolean {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 1) return true;
  }
  return false;
}

export function run(): SweepOutcome {
  const failures: Finding[] = [];
  const suspicions: Finding[] = [];
  const timings: Record<string, number> = {};
  const stats: Record<string, number | string | boolean> = {};

  function stage<T>(name: string, fn: () => T): T | null {
    const started = now();
    try {
      const value = fn();
      timings[name] = Math.round(now() - started);
      return value;
    } catch (error) {
      timings[name] = Math.round(now() - started);
      failures.push({ stage: name, message: `${(error as Error).name}: ${(error as Error).message}` });
      return null;
    }
  }

  // ── page-wide passes ──────────────────────────────────────────────────────

  const palette = stage('palette', () =>
    color.collectPalette(document.documentElement, { maxElements: ELEMENT_BUDGET }),
  );
  if (palette) {
    stats['paletteEntries'] = palette.entries.length;
    stats['paletteUnreadable'] = palette.unreadable;
    stats['paletteTruncated'] = palette.truncated;
    if (palette.entries.length === 0) {
      suspicions.push({ stage: 'palette', message: 'no colours found on a rendered page' });
    }
    if (palette.unreadable > 20) {
      suspicions.push({
        stage: 'palette',
        message: `${palette.unreadable} colour values could not be parsed`,
      });
    }
  }

  const faces = stage('fontFaces', () => typography.collectFontFaces(document));
  if (faces) {
    stats['fontFaces'] = faces.faces.length;
    stats['unreadableSheets'] = faces.unreadable.length;
  }

  const typeScale = stage('typeScale', () =>
    typography.inferTypeScaleForSubtree(document.documentElement, { limit: ELEMENT_BUDGET }),
  );
  if (typeScale) stats['typeScale'] = typeScale.kind;

  const spacing = stage('spacingScale', () =>
    layout.analyzeSpacingScale(document.documentElement, { maxElements: ELEMENT_BUDGET }),
  );
  if (spacing) stats['spacingScale'] = spacing.scale.kind;

  const inventory = stage('assets', () => assets.collectAssets({ document }));
  if (inventory) {
    stats['assets'] = inventory.assets.length;
    stats['inlineSvgs'] = inventory.inlineSvgs.length;
  }

  const index = stage('styleIndex', () =>
    cascade.buildStyleIndex(Array.from(document.styleSheets, (sheet) => ({ sheet, kind: null }))),
  );
  if (index) {
    stats['indexedRules'] = index.rules.length;
    stats['unreadableStyleSheets'] = index.unreadable.length;
    stats['indexTruncated'] = index.truncated;
    if (index.rules.length === 0 && document.styleSheets.length > 0) {
      suspicions.push({
        stage: 'styleIndex',
        message: `${document.styleSheets.length} stylesheets present but zero rules indexed`,
      });
    }
  }

  // Exports must survive whatever the page produced.
  if (palette) {
    stage('tokenExport', () =>
      tokens.emitAll({
        colors: palette.entries.slice(0, 20).map((entry: color.PaletteEntry) => ({
          hex: entry.formats.hex,
          usage: entry.count,
          role: entry.role,
        })),
        fonts: [],
        fontSizes: [],
        spacing: [],
      }),
    );
  }

  // ── per-element passes ────────────────────────────────────────────────────

  const sample = sampleElements(SAMPLE_SIZE);
  let renderedFontMisses = 0;
  let textElements = 0;
  let indeterminateContrast = 0;
  let gradedContrast = 0;

  const perElementStarted = now();

  for (const element of sample) {
    const selector = label(element);

    try {
      readBoxModel(element);
    } catch (error) {
      failures.push({ stage: 'boxModel', selector, message: String((error as Error).message) });
    }

    try {
      color.readElementColors(element);
    } catch (error) {
      failures.push({ stage: 'elementColors', selector, message: String((error as Error).message) });
    }

    try {
      const type = typography.readTypography(element);
      if (hasVisibleText(element)) {
        textElements += 1;
        if (!type.family.rendered) renderedFontMisses += 1;
      }
    } catch (error) {
      failures.push({ stage: 'typography', selector, message: String((error as Error).message) });
    }

    try {
      layout.readContainerAnatomy(element);
    } catch (error) {
      failures.push({ stage: 'containerAnatomy', selector, message: String((error as Error).message) });
    }

    try {
      const backdrop = color.resolveEffectiveBackground(element);
      if (hasVisibleText(element)) {
        const colors = color.readElementColors(element);
        if (colors.text) {
          const style = getComputedStyle(element);
          const verdict = a11y.assessContrast({
            foreground: colors.text,
            background:
              backdrop.kind === 'resolved'
                ? { kind: 'solid', color: backdrop.color }
                : { kind: 'indeterminate', reason: 'unknown', detail: null },
            fontSizePx: Number.parseFloat(style.fontSize) || 16,
            fontWeight: a11y.normalizeFontWeight(style.fontWeight),
          });
          if (verdict.status === 'indeterminate') indeterminateContrast += 1;
          else gradedContrast += 1;
        }
      }
    } catch (error) {
      failures.push({ stage: 'contrast', selector, message: String((error as Error).message) });
    }

    if (index) {
      try {
        cascade.explainElementCascade(element, index);
      } catch (error) {
        failures.push({ stage: 'cascade', selector, message: String((error as Error).message) });
      }
    }
  }

  timings['perElement'] = Math.round(now() - perElementStarted);
  timings['perElementAvg'] = sample.length
    ? Math.round((timings['perElement'] ?? 0) / sample.length)
    : 0;

  // Breakpoints walk every stylesheet, so they run once rather than per element.
  const breakpointTarget = sample.find((element) => element.tagName === 'DIV') ?? sample[0];
  if (breakpointTarget) {
    const report = stage('breakpoints', () => layout.discoverBreakpoints(breakpointTarget));
    if (report) stats['breakpoints'] = report.breakpoints.length;
  }

  stats['textElementsSampled'] = textElements;
  stats['renderedFontMisses'] = renderedFontMisses;
  stats['contrastGraded'] = gradedContrast;
  stats['contrastIndeterminate'] = indeterminateContrast;

  // A rendered font should be resolvable for nearly all visible text. A high
  // miss rate means the detector is failing, not that the page is odd.
  if (textElements >= 5 && renderedFontMisses / textElements > 0.25) {
    suspicions.push({
      stage: 'typography',
      message: `rendered font unresolved for ${renderedFontMisses}/${textElements} text elements`,
    });
  }

  const slowest = Math.max(timings['palette'] ?? 0, timings['styleIndex'] ?? 0, timings['assets'] ?? 0);
  if (slowest > 3000) {
    suspicions.push({ stage: 'performance', message: `a page-wide pass took ${slowest}ms` });
  }

  return { elementsProbed: sample.length, failures, suspicions, timings, stats };
}

declare global {
  interface Window {
    __openInspectorSweep?: { run: typeof run };
  }
}

window.__openInspectorSweep = { run };
