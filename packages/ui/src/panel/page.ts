import { a11y, assets, color, describeElement, layout, round, tokens, typography } from '@open-inspector/core';
import { BACKDROP_REASONS } from './collect.js';
import type {
  AssetEntry,
  BreakpointInfo,
  ColorEntry,
  ExportFormat,
  PageData,
  ScaleInfo,
} from './view-model.js';

/**
 * The page-wide half of the panel: palette, fonts, scales, breakpoints, assets
 * and the token exports built from them.
 *
 * Everything here walks the whole document, so none of it may run on the hover
 * path. The scanner caches the element-independent parts — a page's palette
 * does not change because the pointer moved — and recomputes only the
 * per-element breakpoint report.
 */

/** Keeps a hover from ever costing a full-document walk. */
const ELEMENT_BUDGET = 2500;

/** Enough to be representative; more would flood the panel and the clipboard. */
const MAX_PALETTE = 24;
const MAX_ASSETS = 60;
const MAX_SCALE_VALUES = 12;

export interface PageScanOptions {
  doc?: Document;
  view?: Window;
  /** Skip the inspector's own UI, or it would appear in its own results. */
  ignore?: (element: Element) => boolean;
}

// ── palette ─────────────────────────────────────────────────────────────────

function toPalette(result: color.PaletteResult): ColorEntry[] {
  return result.entries.slice(0, MAX_PALETTE).map((entry) => ({
    hex: entry.formats.hex,
    rgb: entry.formats.rgb,
    hsl: entry.formats.hsl,
    oklch: entry.formats.oklch,
    role: entry.role,
    usage: entry.count,
    merged: entry.mergedCount > 0 ? entry.mergedCount : undefined,
  }));
}

// ── scales ──────────────────────────────────────────────────────────────────

function toTypeScale(result: typography.TypeScaleResult): ScaleInfo {
  if (result.kind === 'none') {
    return { kind: 'none' };
  }

  return {
    kind: 'detected',
    base: `${round(result.match.ratio, 3)}× (${result.match.name})`,
    conformance: Math.round(result.match.conformance),
    values: result.sizes
      .slice(0, MAX_SCALE_VALUES)
      .map((size) => ({ value: `${round(size.px)}px`, count: size.count })),
  };
}

function toSpacingScale(scale: layout.SpacingScale): ScaleInfo {
  if (scale.kind !== 'scale') return { kind: 'none' };

  return {
    kind: 'detected',
    base: `${round(scale.base)}px`,
    conformance: Math.round(scale.conformance * 100),
    values: scale.values
      .slice(0, MAX_SCALE_VALUES)
      .map((entry) => ({ value: `${round(entry.value)}px`, count: entry.count })),
    outliers: scale.outliers.slice(0, 6).map((entry) => `${round(entry.value)}px`),
  };
}

// ── breakpoints ─────────────────────────────────────────────────────────────

function toBreakpoints(report: layout.BreakpointReport): BreakpointInfo[] {
  return report.breakpoints.map((breakpoint) => ({
    condition: breakpoint.condition,
    px: breakpoint.pixelValue ?? undefined,
    // `unknown` is container-query territory: matchMedia cannot evaluate those,
    // and claiming "inactive" would be a guess.
    active: breakpoint.matches === 'yes',
    changes: breakpoint.properties.slice(0, 6),
  }));
}

// ── assets ──────────────────────────────────────────────────────────────────

/**
 * Name an asset so the list can be read.
 *
 * The filename is best, but plenty of real URLs have none — data URIs, and
 * script-built endpoints like `load.php?modules=…`. Falling back to a
 * truncated URL produced a column of identical `data: image/png` rows that
 * identified nothing, which is what made the Assets tab useless on real pages.
 */
function assetName(asset: assets.UrlAsset, index: number): string {
  if (asset.naming.filename) return asset.naming.filename;

  if (asset.dataUri) {
    const type = (asset.mimeType ?? 'inline').replace(/^image\//, '');
    const size = asset.byteSize.known ? ` · ${formatBytes(asset.byteSize.bytes)}` : '';
    return `inline ${type} #${index + 1}${size}`;
  }

  // A path with no filename still has a last segment worth showing.
  try {
    const url = new URL(asset.url);
    const segment = url.pathname.split('/').filter(Boolean).pop();
    const query = url.search ? ' (generated)' : '';
    if (segment) return `${segment}${query}`;
    return url.hostname;
  } catch {
    return asset.url.slice(0, 48);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Kinds a browser can render in an <img>. Fonts and audio cannot be shown. */
const PREVIEWABLE = new Set(['image', 'svg']);

/**
 * URLs the page has already fetched, so a thumbnail of one is a cache hit.
 *
 * An asset being *referenced* is not the same as it being *loaded*: `og:image`,
 * every favicon size, `prefetch` hints and the background of a `display:none`
 * element are all listed without ever being requested. Rendering those in an
 * `<img>` would make the first request for them — often to a third-party CDN,
 * with a Referer — and it would be ours, not the page's.
 *
 * Resource Timing lists what the page fetched, and a finished `<img>` is proof
 * of its own. The timing buffer can fill up (250 entries by default), so on a
 * very heavy page some loaded assets will show "not loaded by the page". That
 * is the safe direction to be wrong in.
 */
export function collectLoadedUrls(doc: Document, view: Window): Set<string> {
  const loaded = new Set<string>();

  /**
   * A prefetch is fetched, but into the HTTP cache for a *future* navigation
   * rather than this document's memory cache — so rendering one is a new
   * request after all. Resource Timing lists it all the same, so it is
   * excluded here unless the page also rendered it (the <img> pass below).
   */
  const prefetched = new Set<string>();
  for (const link of Array.from(doc.querySelectorAll('link[rel~="prefetch" i]'))) {
    const href = (link as HTMLLinkElement).href;
    if (href) prefetched.add(href);
  }

  try {
    for (const entry of view.performance.getEntriesByType('resource')) {
      if (prefetched.has(entry.name)) continue;
      // A 404 is "fetched" too, and re-requesting it gets another 404.
      const status = (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus;
      if (typeof status === 'number' && status >= 400) continue;
      loaded.add(entry.name);
    }
  } catch {
    // No Resource Timing: fall through to what the DOM can prove.
  }
  for (const image of Array.from(doc.querySelectorAll('img'))) {
    if (image.complete && image.naturalWidth > 0 && image.currentSrc) loaded.add(image.currentSrc);
  }
  return loaded;
}

/** Local to the page, so rendering one can never reach a network. */
function isLocalUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:');
}

const NOT_LOADED = 'not loaded by the page';

/**
 * What to put in the thumbnail slot.
 *
 * Only a URL that renders without a request: inline data, a blob, or something
 * the page itself already fetched (see `collectLoadedUrls`). Everything else
 * gets a note instead of a preview, because the thumbnail would otherwise be
 * the extension's own network request.
 */
function previewFor(
  asset: assets.UrlAsset,
  loaded: ReadonlySet<string>,
): { preview?: string; noPreview?: string } {
  if (asset.truncatedUrl) return { noPreview: 'too large to preview inline' };
  if (!PREVIEWABLE.has(asset.kind)) return { noPreview: asset.kind };
  if (!isLocalUrl(asset.url) && !loaded.has(asset.url)) return { noPreview: NOT_LOADED };
  return { preview: asset.url };
}

export function toAssets(
  inventory: assets.AssetInventory,
  loaded: ReadonlySet<string>,
): AssetEntry[] {
  const dimensionsByUrl = new Map<string, string>();
  for (const image of inventory.images) {
    // currentSrc is what the browser actually chose out of a srcset, which is
    // the one whose intrinsic size the measurement describes.
    const url = image.currentSrc ?? image.src;
    if (url && image.natural.known) {
      dimensionsByUrl.set(url, `${image.natural.width} × ${image.natural.height}`);
    }
  }

  const entries: AssetEntry[] = inventory.assets.slice(0, MAX_ASSETS).map((asset, index) => {
    const { preview, noPreview } = previewFor(asset, loaded);

    const entry: AssetEntry = {
      kind: asset.kind,
      url: asset.url,
      name: assetName(asset, index),
      usage: asset.usageCount,
    };

    const dimensions = dimensionsByUrl.get(asset.url);
    if (dimensions) entry.dimensions = dimensions;
    // Byte size is only knowable without a network request for data: URIs.
    if (asset.byteSize.known) entry.bytes = asset.byteSize.bytes;
    if (preview) entry.preview = preview;
    if (noPreview) entry.noPreview = noPreview;

    return entry;
  });

  /**
   * Inline SVGs are not URL assets, so they arrive in their own collection —
   * and they are among the most useful things on a page to lift. The markup is
   * already standalone (the module adds `xmlns`), so the copy target is the
   * file itself rather than a link to one.
   */
  for (const [index, svg] of inventory.inlineSvgs.entries()) {
    const entry: AssetEntry = {
      kind: 'inline svg',
      url: svg.markup,
      name: svg.symbolIds.length > 0 ? `sprite (${svg.symbolIds.length} symbols)` : `svg ${index + 1}`,
      // The markup is already standalone, so it renders as a data URI with no
      // network involved at all.
      preview: `data:image/svg+xml;utf8,${encodeURIComponent(svg.markup)}`,
    };
    if (svg.viewBox) entry.dimensions = `viewBox ${svg.viewBox}`;
    else if (svg.width && svg.height) entry.dimensions = `${svg.width} × ${svg.height}`;
    if (svg.byteSize.known) entry.bytes = svg.byteSize.bytes;
    entries.push(entry);
  }

  // Canvases have no extractable source — say so rather than omitting them and
  // leaving someone wondering why the chart they can see is not listed.
  for (const [index, canvas] of inventory.canvases.entries()) {
    entries.push({
      kind: 'canvas',
      url: '',
      name: `canvas ${index + 1}`,
      dimensions: `${canvas.width} × ${canvas.height}`,
      noPreview: 'pixels only, no source file',
    });
  }

  for (const [index, video] of inventory.videos.entries()) {
    const entry: AssetEntry = {
      kind: 'video',
      url: video.currentSrc ?? video.src ?? video.sources[0]?.url ?? video.poster ?? '',
      name: `video ${index + 1}`,
    };
    // A poster frame is the only still a video has; use it as the thumbnail —
    // but only if the page fetched it, for the same reason as `previewFor`.
    if (!video.poster) entry.noPreview = 'no poster frame';
    else if (isLocalUrl(video.poster) || loaded.has(video.poster)) entry.preview = video.poster;
    else entry.noPreview = NOT_LOADED;
    if (video.intrinsic.known) {
      entry.dimensions = `${video.intrinsic.width} × ${video.intrinsic.height}`;
    }
    entries.push(entry);
  }

  for (const hint of inventory.lottieHints) {
    entries.push({
      kind: 'lottie',
      url: hint.url ?? '',
      name: `${hint.evidence} (${hint.confidence})`,
      noPreview: 'animation data, not an image',
    });
  }

  return entries.slice(0, MAX_ASSETS);
}

// ── token exports ───────────────────────────────────────────────────────────

function buildExports(page: Omit<PageData, 'exports'>, source: string): ExportFormat[] {
  const numeric = (values: ScaleInfo['values']): Array<{ px: number; usage?: number }> =>
    (values ?? [])
      .map((entry) => ({ px: Number.parseFloat(entry.value), usage: entry.count }))
      .filter((entry) => Number.isFinite(entry.px));

  const set: tokens.TokenSet = {
    colors: page.palette.map((entry) => ({
      hex: entry.hex,
      rgb: entry.rgb,
      usage: entry.usage,
      role: entry.role,
    })),
    fonts: page.fonts.map((font) => ({ family: font.family, usage: font.usage })),
    fontSizes: numeric(page.typeScale.values),
    spacing: numeric(page.spacingScale.values),
    source,
    notes: buildNotes(page),
  };

  return tokens.emitAll(set);
}

/** Layout findings worth carrying into an AI handoff. */
function buildNotes(page: Omit<PageData, 'exports'>): string[] {
  const notes: string[] = [];

  if (page.spacingScale.kind === 'detected') {
    notes.push(
      `Spacing follows a ${page.spacingScale.base} scale (${page.spacingScale.conformance}% of values conform).`,
    );
  }
  if (page.typeScale.kind === 'detected') {
    notes.push(`Type sizes follow a ${page.typeScale.base} modular scale.`);
  }
  for (const breakpoint of page.breakpoints.slice(0, 4)) {
    notes.push(`Breakpoint: ${breakpoint.condition}`);
  }

  return notes;
}

// ── scanner ─────────────────────────────────────────────────────────────────

/**
 * Every failing text/background pair on the page, worst first.
 *
 * The single-element verdict answers "is this one readable"; this answers
 * "where is this page unreadable", which is the question anyone auditing a
 * site actually has. The engine already existed in core — it needed a
 * background resolver, which is the part that has to walk ancestors and
 * composite translucent layers, and give up honestly on gradients.
 */
export interface ContrastAudit {
  failures: Array<{
    element: Element;
    label: string;
    text: string;
    ratio: number;
    required: number;
    severity: a11y.ContrastSeverity;
    suggestion: string | null;
  }>;
  /** Samples whose background could not be read. Never counted as passes. */
  indeterminate: number;
  passes: number;
  assessed: number;
  truncated: boolean;
}

/**
 * The hex of a suggested fix, when there is one to suggest.
 *
 * `unreachable` means no lightness of this hue clears the threshold against
 * that background — the honest answer is to show its best attempt rather than
 * nothing, since "move it this far and it still fails" is the useful finding.
 */
function suggestionHex(remediation: a11y.Remediation | null): string | null {
  if (!remediation) return null;
  return remediation.kind === 'lightness' ? remediation.hex : remediation.best.hex;
}

function runContrastAudit(
  doc: Document,
  view: Window,
  ignore: ((element: Element) => boolean) | undefined,
): ContrastAudit {
  const result = a11y.scanContrast(doc.body ?? doc, {
    view,
    resolveBackground: (element): a11y.ResolvedBackground => {
      const backdrop = color.resolveEffectiveBackground(element, { view });
      return backdrop.kind === 'resolved'
        ? { kind: 'solid', color: backdrop.color }
        : {
            kind: 'indeterminate',
            reason: BACKDROP_REASONS[backdrop.reason],
            detail: backdrop.reason,
          };
    },
    // The default reads `style.color` with its own parser. Ours handles the
    // lab() and oklch() forms Chrome serializes computed colours into, which
    // the reliability sweep found on every page built with a modern framework.
    readForeground: (_element, style) => {
      const rgba = color.parseColor(style.color);
      return rgba ? { r: rgba.r, g: rgba.g, b: rgba.b, alpha: rgba.a } : null;
    },
  });

  const failures = result.failures
    // Our own panel is in the document; auditing it would be absurd.
    .filter((finding) => !ignore?.(finding.element))
    .map((finding) => ({
      element: finding.element,
      label: describeElement(finding.element).selectorLabel,
      text: finding.text,
      ratio: Math.round(finding.verdict.ratio * 100) / 100,
      required: finding.required,
      severity: finding.severity,
      suggestion: suggestionHex(finding.verdict.remediation),
    }));

  return {
    failures,
    indeterminate: result.indeterminate.length,
    passes: result.passes,
    assessed: result.assessed,
    truncated: result.truncated,
  };
}

/**
 * Give the page a turn.
 *
 * `scheduler.yield()` where it exists (Chrome 129+) keeps our continuation at
 * the front of the queue; elsewhere a zero-delay timeout still lets input and
 * rendering in between phases.
 */
function yieldToPage(view: Window): Promise<void> {
  const scheduler = (view as Window & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => view.setTimeout(resolve, 0));
}

export interface PageScanner {
  /** Full findings for one element. Cheap after the first call, or after `warm`. */
  scan(element: Element): PageData;
  /**
   * Do the document-wide walk ahead of `scan`, yielding to the page between
   * phases. Resolves once `scan` is cheap. Safe to call repeatedly.
   */
  warm(): Promise<void>;
  /**
   * Audit every text sample on the page.
   *
   * Deliberately not part of `scan`. It is a second full walk of the document
   * that most sessions never need, and paying for it on every selection would
   * make the panel feel slow to everyone in order to serve the few who want
   * it. Run when asked.
   */
  auditContrast(): ContrastAudit;
  /** Drop the cache — call after the page mutates substantially. */
  invalidate(): void;
}

/**
 * Build a scanner that caches the page-wide half of its work.
 *
 * The split matters: palette, fonts, scales and assets describe the document
 * and cost a full walk, so they are computed once. Breakpoints are the only
 * part that genuinely depends on which element is selected.
 */
export function createPageScanner(options: PageScanOptions = {}): PageScanner {
  const doc = options.doc ?? document;
  const view = options.view ?? doc.defaultView ?? window;

  let cached: Omit<PageData, 'breakpoints' | 'exports'> | null = null;
  let warming: Promise<void> | null = null;
  /** Bumped by `invalidate`, so a warm that started before it cannot land after it. */
  let generation = 0;

  /**
   * The document walk, as a sequence of phases.
   *
   * Each phase is bounded, but together — palette, type, spacing, then assets
   * with three computed-style reads per element — they made one long task
   * that froze a heavy page for a visible moment right after the pointer
   * stopped. Written as a generator so the same code runs straight through
   * (`scan` on a cold cache) or with a yield to the page between phases
   * (`warm`).
   */
  function* scanPhases(): Generator<void, Omit<PageData, 'breakpoints' | 'exports'>> {
    const root = doc.documentElement;

    const paletteResult = color.collectPalette(root, {
      view,
      maxElements: ELEMENT_BUDGET,
      ...(options.ignore ? { shouldSkip: options.ignore } : {}),
    });
    yield;

    const faces = typography.collectFontFaces(doc);
    const typeScale = typography.inferTypeScaleForSubtree(root, {
      view,
      limit: ELEMENT_BUDGET,
      ...(options.ignore ? { shouldSkip: options.ignore } : {}),
    });
    yield;

    const spacing = layout.analyzeSpacingScale(root, {
      view,
      maxElements: ELEMENT_BUDGET,
      ...(options.ignore ? { shouldSkip: options.ignore } : {}),
    });
    yield;

    const inventory = assets.collectAssets({
      document: doc,
      view,
      ...(options.ignore ? { ignore: options.ignore } : {}),
    });

    // Families the page actually loaded, plus their source, deduplicated.
    const fontUsage = new Map<string, { family: string; usage: number; source?: string }>();
    for (const face of faces.faces) {
      const existing = fontUsage.get(face.family);
      if (existing) {
        existing.usage += 1;
        continue;
      }
      const entry: { family: string; usage: number; source?: string } = {
        family: face.family,
        usage: 1,
      };
      const first = face.sources[0];
      if (first && 'kind' in first && typeof first.kind === 'string') entry.source = first.kind;
      fontUsage.set(face.family, entry);
    }

    return {
      palette: toPalette(paletteResult),
      fonts: [...fontUsage.values()],
      typeScale: toTypeScale(typeScale),
      spacingScale: toSpacingScale(spacing.scale),
      assets: toAssets(inventory, collectLoadedUrls(doc, view)),
      // Any walk hitting its budget means the answer is partial. Wikipedia's
      // article page exhausts the element budget, and silently showing a
      // shortened list would read as "this is everything".
      truncated:
        paletteResult.truncated || spacing.truncated || inventory.limits.elementsTruncated,
    };
  }

  function scanDocument(): Omit<PageData, 'breakpoints' | 'exports'> {
    const phases = scanPhases();
    for (;;) {
      const step = phases.next();
      if (step.done) return step.value;
    }
  }

  async function warmDocument(): Promise<void> {
    const started = generation;
    const phases = scanPhases();
    for (;;) {
      const step = phases.next();
      if (step.done) {
        if (started === generation) cached = step.value;
        return;
      }
      await yieldToPage(view);
      // Invalidated mid-walk: this result describes a page that is gone.
      if (started !== generation) return;
    }
  }

  return {
    warm() {
      if (cached) return Promise.resolve();
      warming ??= warmDocument().finally(() => {
        warming = null;
      });
      return warming;
    },

    scan(element) {
      cached ??= scanDocument();

      const breakpoints = toBreakpoints(
        layout.discoverBreakpoints(element, { document: doc, view }),
      );

      const page = { ...cached, breakpoints };
      return { ...page, exports: buildExports(page, doc.location?.host ?? 'this page') };
    },

    auditContrast() {
      return runContrastAudit(doc, view, options.ignore);
    },

    invalidate() {
      cached = null;
      warming = null;
      generation += 1;
    },
  };
}
