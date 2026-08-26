import { round } from '../geometry/rect.js';
import { parseCssImageLayers } from './css-values.js';
import { buildAssetUsage, resolveReference } from './reference.js';
import { chooseSrcsetCandidate, parseSrcset } from './srcset.js';
import type {
  AltText,
  AssetReference,
  AssetUsageVia,
  CanvasAsset,
  ImageAsset,
  MeasuredSize,
  ResolvedSrcsetCandidate,
} from './types.js';
import { elementLabel } from './walk.js';

/** What one element contributed: a record for the UI, plus references to dedupe. */
export interface ImageHarvest {
  image: ImageAsset;
  references: AssetReference[];
}

/**
 * Intrinsic size of a decoded image.
 *
 * `naturalWidth` is 0 until the bitmap decodes and stays 0 for a broken image,
 * so a zero is reported as "not loaded" rather than as a real measurement.
 * A genuinely zero-sized image does not exist.
 */
export function readNaturalSize(image: HTMLImageElement): MeasuredSize {
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  if (typeof width !== 'number' || typeof height !== 'number') {
    return { known: false, reason: 'unavailable' };
  }
  if (width === 0 && height === 0) return { known: false, reason: 'not-loaded' };
  return { known: true, width, height };
}

/**
 * On-screen size, including any transform, from the layout engine.
 *
 * A zero-by-zero box means the element is not rendered — `display: none`, a
 * collapsed ancestor, or a detached node — which is a different fact from
 * "renders at zero pixels", and the caller should be able to tell.
 */
export function readDisplayedSize(element: Element): MeasuredSize {
  const rect = element.getBoundingClientRect?.();
  if (!rect) return { known: false, reason: 'unavailable' };
  if (rect.width === 0 && rect.height === 0) return { known: false, reason: 'not-rendered' };
  return { known: true, width: round(rect.width), height: round(rect.height) };
}

/**
 * Distinguish decorative from missing alt text.
 *
 * `alt=""` is an author telling assistive technology to skip the image; no
 * `alt` at all is a defect. Both stringify to `''`, which is why the attribute
 * has to be probed rather than read.
 */
export function readAltText(image: Element): AltText {
  if (!image.hasAttribute('alt')) return { state: 'missing' };
  const text = image.getAttribute('alt') ?? '';
  return text.trim().length === 0 ? { state: 'empty-decorative' } : { state: 'present', text };
}

/**
 * Harvest one `<img>`, including every `srcset` and `<picture>` candidate.
 *
 * The candidate list is the point. `src` alone is what a competitor reports,
 * and on a responsive page it is frequently the small fallback nobody wants —
 * the 2400px original is sitting in `srcset`, and the variant actually on
 * screen is only knowable from `currentSrc`. All three are reported, and which
 * one the browser picked is stated or explicitly left indeterminate.
 */
export function readImageElement(image: HTMLImageElement, baseUrl: string): ImageHarvest {
  const label = elementLabel(image);
  const references: AssetReference[] = [];

  const srcAttribute = image.getAttribute('src');
  const src = srcAttribute ? resolveReference(srcAttribute, baseUrl) : null;

  const parent = image.parentElement;
  const isPictureChild = parent?.tagName.toUpperCase() === 'PICTURE';

  const candidates: ResolvedSrcsetCandidate[] = [];

  for (const candidate of parseSrcset(image.getAttribute('srcset'))) {
    const resolved = resolveReference(candidate.raw, baseUrl);
    candidates.push({
      ...candidate,
      url: resolved.url,
      resolved: resolved.resolved,
      origin: 'img-srcset',
      media: null,
      type: null,
    });
  }

  if (isPictureChild && parent) {
    for (const source of Array.from(parent.children)) {
      if (source.tagName.toUpperCase() !== 'SOURCE') continue;
      const media = source.getAttribute('media');
      const type = source.getAttribute('type');

      for (const candidate of parseSrcset(source.getAttribute('srcset'))) {
        const resolved = resolveReference(candidate.raw, baseUrl);
        candidates.push({
          ...candidate,
          url: resolved.url,
          resolved: resolved.resolved,
          origin: 'picture-source',
          media,
          type,
        });
      }
    }
  }

  // `currentSrc` is a browser-only property; outside one it is simply absent,
  // and the choice below degrades to indeterminate rather than guessing.
  const currentSrcValue = typeof image.currentSrc === 'string' ? image.currentSrc : '';
  const currentSrc = currentSrcValue.length > 0 ? resolveReference(currentSrcValue, baseUrl).url : null;
  const choice = chooseSrcsetCandidate(candidates, currentSrc, src?.url ?? null);

  if (srcAttribute) {
    references.push({
      raw: srcAttribute,
      kindHint: 'image',
      mimeHint: null,
      usage: buildAssetUsage('img-src', label, 'src', {
        chosen: choice.status === 'src-fallback',
      }),
    });
  }

  for (const candidate of candidates) {
    references.push({
      raw: candidate.raw,
      kindHint: 'image',
      mimeHint: candidate.type,
      usage: buildAssetUsage(
        candidate.origin === 'img-srcset' ? 'img-srcset' : 'picture-source',
        label,
        'srcset',
        {
          descriptor: candidate.descriptor,
          context: candidate.media,
          chosen: choice.status === 'chosen' && choice.candidate === candidate,
        },
      ),
    });
  }

  // A `currentSrc` that matches nothing in the markup is still a real file the
  // browser loaded — a rewriting service worker or a lazy-loader that mutated
  // the attribute after load. Recording it is the only way it survives.
  if (currentSrc && choice.status === 'indeterminate' && choice.reason === 'current-src-not-in-candidates') {
    references.push({
      raw: currentSrcValue,
      kindHint: 'image',
      mimeHint: null,
      usage: buildAssetUsage('img-current-src', label, 'currentSrc', { chosen: true }),
    });
  }

  return {
    image: {
      element: label,
      src: src?.url ?? null,
      currentSrc,
      candidates,
      choice,
      sizes: image.getAttribute('sizes'),
      alt: readAltText(image),
      loading: image.getAttribute('loading'),
      decoding: image.getAttribute('decoding'),
      natural: readNaturalSize(image),
      displayed: readDisplayedSize(image),
      isPictureChild,
    },
    references,
  };
}

/**
 * Record a `<canvas>` as present but unharvestable.
 *
 * Its pixels exist only in a backing store. Reading them means calling
 * `toDataURL` or `getImageData`, which this module will not do: on a canvas
 * tainted by cross-origin content that throws, and on a WebGL context without
 * `preserveDrawingBuffer` it hands back a blank frame that looks like a
 * successful export. Reporting the limitation beats shipping a black PNG.
 */
export function readCanvasElement(canvas: HTMLCanvasElement): CanvasAsset {
  return {
    element: elementLabel(canvas),
    width: Number.isFinite(canvas.width) ? canvas.width : 0,
    height: Number.isFinite(canvas.height) ? canvas.height : 0,
    displayed: readDisplayedSize(canvas),
    exportability: 'requires-pixel-read',
    crossOriginTaint: 'unknown',
  };
}

/** The image-valued CSS properties worth reading off a computed style. */
export interface CssImageProperties {
  backgroundImage: string;
  borderImageSource: string;
  listStyleImage: string;
  maskImage: string;
  content: string;
}

const IMAGE_PROPERTIES: ReadonlyArray<{
  key: keyof CssImageProperties;
  property: string;
  via: AssetUsageVia;
}> = [
  { key: 'backgroundImage', property: 'background-image', via: 'css-background-image' },
  { key: 'borderImageSource', property: 'border-image-source', via: 'css-border-image' },
  { key: 'listStyleImage', property: 'list-style-image', via: 'css-list-style-image' },
  { key: 'maskImage', property: 'mask-image', via: 'css-mask-image' },
  { key: 'content', property: 'content', via: 'css-content' },
];

/**
 * Pull the image-valued declarations off a computed style.
 *
 * `getPropertyValue` rather than camelCase properties, because the
 * `-webkit-mask-image` fallback is only reachable by string, and because a
 * computed style from a non-browser implementation may expose neither.
 */
export function readCssImageProperties(style: CSSStyleDeclaration): CssImageProperties {
  const read = (property: string): string => {
    try {
      return style.getPropertyValue(property) ?? '';
    } catch {
      return '';
    }
  };

  return {
    backgroundImage: read('background-image'),
    borderImageSource: read('border-image-source'),
    listStyleImage: read('list-style-image'),
    maskImage: read('mask-image') || read('-webkit-mask-image'),
    content: read('content'),
  };
}

/**
 * Turn image-valued CSS declarations into asset references.
 *
 * Pure, so the layered-background and `image-set()` cases can be tested with
 * plain strings — the part that needs a browser is getting the computed value
 * in the first place, and that stays in {@link readCssImageProperties}.
 */
export function harvestCssImages(
  properties: CssImageProperties,
  context: { element: string | null; pseudoElement: string | null },
): AssetReference[] {
  const references: AssetReference[] = [];

  for (const { key, property, via } of IMAGE_PROPERTIES) {
    for (const layer of parseCssImageLayers(properties[key])) {
      for (const candidate of layer.candidates) {
        references.push({
          raw: candidate.url,
          kindHint: 'image',
          mimeHint: candidate.mimeType,
          usage: buildAssetUsage(via, context.element, property, {
            descriptor: candidate.descriptor,
            context: context.pseudoElement,
          }),
        });
      }
    }
  }

  return references;
}

/** Build the reference for an `<input type="image">`, which is an image with no `alt` story. */
export function readInputImage(input: HTMLInputElement): AssetReference | null {
  const src = input.getAttribute('src');
  if (!src) return null;

  return {
    raw: src,
    kindHint: 'image',
    mimeHint: null,
    usage: buildAssetUsage('input-image-src', elementLabel(input), 'src'),
  };
}

