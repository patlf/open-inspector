import { readDocumentFontFaces } from './fonts.js';
import {
  harvestCssImages,
  readCanvasElement,
  readCssImageProperties,
  readImageElement,
  readInputImage,
} from './images.js';
import { readAudioElement, readLottieElement, readVideoElement } from './media.js';
import { buildAssetUsage } from './reference.js';
import { countByKind, createAssetRegistry } from './registry.js';
import { nearestSvgRoot, readInlineSvg, readUseElement } from './svg.js';
import type {
  AssetBudget,
  AssetInventory,
  AssetReference,
  AudioAsset,
  CanvasAsset,
  FontFaceAsset,
  ImageAsset,
  InaccessibleStylesheet,
  InlineSvgAsset,
  LottieHint,
  SpriteUsage,
  VideoAsset,
} from './types.js';
import { elementLabel, walkElements } from './walk.js';

/**
 * Default caps.
 *
 * Sized for a hover-time inspector rather than a crawler: 5000 elements covers
 * the overwhelming majority of real pages, and the two byte limits keep a
 * single inline monster — a 6 MB base64 hero image, a 400-symbol sprite sheet —
 * from dominating a report that is meant to be read by a person.
 */
export const DEFAULT_ASSET_BUDGET: AssetBudget = {
  maxElements: 5000,
  maxAssets: 1000,
  maxUsagesPerAsset: 20,
  maxDataUriBytes: 512 * 1024,
  maxInlineSvgBytes: 256 * 1024,
};

/** Pseudo-elements swept for backgrounds, which is where icon systems hide. */
const PSEUDO_ELEMENTS = ['::before', '::after'] as const;

export interface CollectAssetsOptions {
  /** Subtree to harvest. Defaults to the whole document. */
  root?: ParentNode;
  /** Document used for stylesheets and the default base URL. */
  document?: Document;
  /** Base for relative URLs. Defaults to the document's `baseURI`. */
  baseUrl?: string;
  /** Window used for `getComputedStyle`. Defaults to the global one. */
  view?: Window;
  /** Overrides for individual budget entries. */
  budget?: Partial<AssetBudget>;
  /** Skip an element and its subtree — used to exclude the inspector's own UI. */
  ignore?: (element: Element) => boolean;
  /** Descend into open shadow roots. On by default; components hold most images. */
  pierceShadowRoots?: boolean;
  /** Read computed styles for CSS images. The expensive half of a collection. */
  includeCssImages?: boolean;
  /** Also read `::before`/`::after`. Triples the computed-style cost. */
  includePseudoElements?: boolean;
  /** Sweep stylesheets for `@font-face`. */
  includeFonts?: boolean;
}

/** `<link rel>` tokens that point at an image asset. */
const ICON_RELS = new Set([
  'icon',
  'shortcut icon',
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'mask-icon',
  'fluid-icon',
]);

/** `<meta>` names whose content is a shareable image. */
const META_IMAGE_KEYS = new Set([
  'og:image',
  'og:image:url',
  'og:image:secure_url',
  'twitter:image',
  'twitter:image:src',
  'msapplication-tileimage',
]);

/**
 * Harvest every reusable asset reachable from a DOM.
 *
 * The one thing this never does is read a byte off the network — no request,
 * no probe, no size check. Everything reported is derived from markup,
 * computed styles and serialization, which is why file sizes are unknown for
 * anything but `data:` URIs and inline SVG, and why a Lottie is reported as a
 * hint rather than a fact.
 *
 * Cost is dominated by `getComputedStyle`: three calls per element when
 * pseudo-elements are included. Both are switchable, and the element budget
 * bounds the worst case on a page that turns out to have 200,000 nodes.
 */
export function collectAssets(options: CollectAssetsOptions = {}): AssetInventory {
  const documentNode = resolveDocument(options);
  const root = options.root ?? documentNode;
  const baseUrl = options.baseUrl ?? documentNode?.baseURI ?? '';
  const view = options.view ?? (typeof window === 'undefined' ? null : window);

  const budget: AssetBudget = { ...DEFAULT_ASSET_BUDGET, ...options.budget };
  const includeCssImages = options.includeCssImages ?? true;
  const includePseudoElements = options.includePseudoElements ?? true;
  const includeFonts = options.includeFonts ?? true;

  const registry = createAssetRegistry({
    baseUrl,
    maxAssets: budget.maxAssets,
    maxUsagesPerAsset: budget.maxUsagesPerAsset,
    maxDataUriBytes: budget.maxDataUriBytes,
  });

  const images: ImageAsset[] = [];
  const canvases: CanvasAsset[] = [];
  const inlineSvgs: InlineSvgAsset[] = [];
  const spriteUsages: SpriteUsage[] = [];
  const videos: VideoAsset[] = [];
  const audios: AudioAsset[] = [];
  const lottieHints: LottieHint[] = [];
  const inaccessibleStylesheets: InaccessibleStylesheet[] = [];

  // No root and no document is a legitimate state — this package is meant to
  // run outside a browser — and it yields an empty inventory rather than a
  // thrown error, so a caller can treat "nothing here" uniformly.
  const walk = root
    ? walkElements(root, {
        maxElements: budget.maxElements,
        pierceShadowRoots: options.pierceShadowRoots ?? true,
        ...(options.ignore ? { ignore: options.ignore } : {}),
      })
    : { elements: [], shadowRootsEntered: 0, truncated: false };

  const addAll = (references: readonly AssetReference[]): void => {
    for (const reference of references) registry.add(reference);
  };

  // `<use>` elements inside an inline `<svg>` are harvested with their owner,
  // which knows whether a `#fragment` resolves locally. Tracked so the
  // standalone pass below does not report them a second time.
  const claimedUses = new Set<Element>();

  for (const element of walk.elements) {
    const tag = element.tagName.toUpperCase();

    switch (tag) {
      case 'IMG': {
        const harvest = readImageElement(element as HTMLImageElement, baseUrl);
        images.push(harvest.image);
        addAll(harvest.references);
        break;
      }
      case 'INPUT': {
        const input = element as HTMLInputElement;
        if (input.getAttribute('type')?.toLowerCase() === 'image') {
          const reference = readInputImage(input);
          if (reference) registry.add(reference);
        }
        break;
      }
      case 'CANVAS': {
        canvases.push(readCanvasElement(element as HTMLCanvasElement));
        break;
      }
      case 'SVG': {
        // Only outermost `<svg>` elements become assets: a nested `<svg>` is
        // part of its parent's markup and extracting it separately would
        // duplicate the same bytes under two names.
        if (element.parentElement && nearestSvgRoot(element.parentElement)) break;
        const harvest = readInlineSvg(element as SVGSVGElement, baseUrl, budget.maxInlineSvgBytes);
        inlineSvgs.push(harvest.svg);
        addAll(harvest.references);
        spriteUsages.push(...harvest.sprites);
        for (const use of Array.from(element.querySelectorAll('use'))) claimedUses.add(use);
        break;
      }
      case 'USE': {
        if (claimedUses.has(element)) break;
        const harvest = readUseElement(element, baseUrl);
        spriteUsages.push(harvest.sprite);
        if (harvest.reference) registry.add(harvest.reference);
        break;
      }
      case 'VIDEO': {
        const harvest = readVideoElement(element as HTMLVideoElement, baseUrl);
        videos.push(harvest.video);
        addAll(harvest.references);
        break;
      }
      case 'AUDIO': {
        const harvest = readAudioElement(element as HTMLAudioElement, baseUrl);
        audios.push(harvest.audio);
        addAll(harvest.references);
        break;
      }
      case 'LINK': {
        const reference = readLinkElement(element);
        if (reference) registry.add(reference);
        break;
      }
      case 'META': {
        const reference = readMetaImage(element);
        if (reference) registry.add(reference);
        break;
      }
      default:
        break;
    }

    const lottie = readLottieElement(element, baseUrl);
    if (lottie) {
      lottieHints.push(lottie.hint);
      if (lottie.reference) registry.add(lottie.reference);
    }

    if (includeCssImages && view) {
      addAll(readElementCssImages(element, view, includePseudoElements));
    }
  }

  let fonts: FontFaceAsset[] = [];
  if (includeFonts && documentNode) {
    const harvest = readDocumentFontFaces(documentNode, baseUrl);
    fonts = harvest.fonts;
    addAll(harvest.references);
    inaccessibleStylesheets.push(...harvest.inaccessible);
  }

  const assets = registry.list();

  return {
    baseUrl,
    assets,
    countsByKind: countByKind(assets),
    images,
    canvases,
    inlineSvgs,
    spriteUsages,
    videos,
    audios,
    fonts,
    lottieHints,
    limits: {
      budget,
      elementsVisited: walk.elements.length,
      elementsTruncated: walk.truncated,
      assetsRecorded: registry.size,
      assetsTruncated: registry.overflowed,
      shadowRootsEntered: walk.shadowRootsEntered,
      skippedReferences: registry.skipped,
      inaccessibleStylesheets,
    },
  };
}

function resolveDocument(options: CollectAssetsOptions): Document | null {
  if (options.document) return options.document;

  const root = options.root;
  if (root) {
    // A `Document` is its own owner and reports `ownerDocument` as null, so the
    // two cases have to be checked separately.
    if ('ownerDocument' in root && root.ownerDocument) return root.ownerDocument;
    if ('styleSheets' in root) return root as Document;
    return null;
  }

  return typeof document === 'undefined' ? null : document;
}

/**
 * Read CSS-referenced images off one element, pseudo-elements included.
 *
 * Guarded because `getComputedStyle` throws on a detached element in some
 * implementations, and because passing a pseudo-element argument is not
 * universally supported — a failure there should cost that one element's
 * backgrounds, not the whole harvest.
 */
export function readElementCssImages(
  element: Element,
  view: Window,
  includePseudoElements: boolean,
): AssetReference[] {
  const label = elementLabel(element);
  const references: AssetReference[] = [];

  const readFor = (pseudoElement: string | null): void => {
    let style: CSSStyleDeclaration | null = null;
    try {
      style = pseudoElement ? view.getComputedStyle(element, pseudoElement) : view.getComputedStyle(element);
    } catch {
      return;
    }
    if (!style) return;

    references.push(
      ...harvestCssImages(readCssImageProperties(style), { element: label, pseudoElement }),
    );
  };

  readFor(null);
  if (includePseudoElements) for (const pseudo of PSEUDO_ELEMENTS) readFor(pseudo);

  return references;
}

/**
 * Turn a `<link>` into an asset reference.
 *
 * Favicons and preloaded images are assets people actually want — a site's
 * icon set is often the cleanest logo available anywhere on the page — and
 * they are invisible to any harvester that only looks at rendered elements.
 */
export function readLinkElement(link: Element): AssetReference | null {
  const rel = (link.getAttribute('rel') ?? '').trim().toLowerCase();
  const href = link.getAttribute('href');
  if (!href || rel.length === 0) return null;

  const tokens = rel.split(/\s+/);

  if (ICON_RELS.has(rel) || tokens.includes('icon')) {
    return {
      raw: href,
      kindHint: 'image',
      mimeHint: link.getAttribute('type'),
      usage: buildAssetUsage('link-icon', elementLabel(link), 'href', {
        descriptor: link.getAttribute('sizes'),
        context: rel,
      }),
    };
  }

  if (tokens.includes('preload') || tokens.includes('prefetch')) {
    const as = (link.getAttribute('as') ?? '').toLowerCase();
    const kindHint = as === 'image' ? 'image' : as === 'font' ? 'font' : as === 'video' ? 'video' : null;
    if (!kindHint) return null;

    return {
      raw: href,
      kindHint,
      mimeHint: link.getAttribute('type'),
      usage: buildAssetUsage('link-preload', elementLabel(link), 'href', { context: as }),
    };
  }

  return null;
}

/** Turn an Open Graph or Twitter card image into an asset reference. */
export function readMetaImage(meta: Element): AssetReference | null {
  const key = (meta.getAttribute('property') ?? meta.getAttribute('name') ?? '').trim().toLowerCase();
  if (!META_IMAGE_KEYS.has(key)) return null;

  const content = meta.getAttribute('content');
  if (!content) return null;

  return {
    raw: content,
    kindHint: 'image',
    mimeHint: null,
    usage: buildAssetUsage('meta-image', elementLabel(meta), 'content', { context: key }),
  };
}
