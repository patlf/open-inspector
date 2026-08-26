/**
 * Shapes for the asset inventory.
 *
 * Two rules run through every type in this file.
 *
 * First: this module never reads a byte off the network. Anything that would
 * require a request is modelled as an explicit "unknown" variant rather than
 * omitted or guessed — file size above all. A harvesting tool that reports a
 * confident wrong number is worse than one that admits the gap.
 *
 * Second: real pages are hostile. One background image can be referenced by
 * ten thousand elements, a `data:` URI can be several megabytes of base64, and
 * a sprite sheet can hold four hundred symbols. Usage counts, budget caps and
 * truncation flags are therefore part of the reported data, not an afterthought
 * bolted onto the collector.
 */

/** Broad category an asset falls into, after extension and MIME are weighed. */
export type AssetKind = 'image' | 'svg' | 'video' | 'audio' | 'font' | 'lottie' | 'unknown';

/** Why a reference could not be turned into a usable absolute URL. */
export type UnresolvableReason =
  | 'empty'
  | 'fragment-only'
  | 'unsupported-scheme'
  | 'invalid-url'
  | 'no-usable-base';

/**
 * The outcome of resolving one authored reference.
 *
 * `data:` and `blob:` are kept as their own variants rather than folded into
 * `absolute`, because everything downstream treats them differently: they have
 * no path to derive a filename from, and only `data:` has a knowable size.
 */
export type ResolvedAssetUrl =
  | { kind: 'absolute'; url: string; protocol: string }
  | { kind: 'data'; url: string }
  | { kind: 'blob'; url: string }
  | { kind: 'unresolvable'; raw: string; reason: UnresolvableReason };

/** Which variant of {@link ResolvedAssetUrl} an asset came from. */
export type AssetUrlKind = ResolvedAssetUrl['kind'];

/**
 * File size, and the honest reason when there isn't one.
 *
 * `data:` URIs carry their own payload, and inline SVG is serialized by this
 * module, so those two are measurable. Every other asset would need a network
 * request to size, which this engine will never make.
 */
export type AssetByteSize =
  | { known: true; bytes: number; basis: 'data-uri' | 'inline-markup' }
  | { known: false; reason: 'requires-network-access' | 'opaque-blob-url' };

/** What a `data:` URI declares about itself, plus its decoded length. */
export interface DataUriInfo {
  /** Media type from the header, e.g. `image/png`. Absent headers mean the spec default. */
  mimeType: string | null;
  /** Whether the payload is base64 rather than percent-encoded text. */
  base64: boolean;
  /** Decoded byte length — the only file size this module can ever know for a URL. */
  bytes: number;
}

/**
 * A filename guess derived from the URL, never from the response.
 *
 * `source` says where the guess came from so the UI can hedge appropriately:
 * a `path`-derived `.png` is trustworthy, a `mime`-derived one is a suggestion
 * for a download dialog, and `none` means there is nothing to call this file.
 */
export interface AssetNaming {
  filename: string | null;
  extension: string | null;
  source: 'path' | 'mime' | 'none';
}

/** Where in the page a reference to an asset was found. */
export type AssetUsageVia =
  | 'img-src'
  | 'img-srcset'
  | 'picture-source'
  | 'img-current-src'
  | 'input-image-src'
  | 'css-background-image'
  | 'css-border-image'
  | 'css-list-style-image'
  | 'css-mask-image'
  | 'css-content'
  | 'svg-use'
  | 'svg-image'
  | 'video-src'
  | 'video-source'
  | 'video-poster'
  | 'audio-src'
  | 'audio-source'
  | 'font-face-src'
  | 'link-icon'
  | 'link-preload'
  | 'meta-image'
  | 'lottie-source';

/**
 * One reference site for an asset.
 *
 * Fields are nullable rather than optional so every usage has the same shape:
 * the UI renders a table of these, and a uniform record is far easier to sort
 * and filter than a sparse one.
 */
export interface AssetUsage {
  via: AssetUsageVia;
  /** Selector label of the referencing element; null for stylesheet-level rules. */
  element: string | null;
  /** CSS property or HTML attribute the reference was read from. */
  property: string | null;
  /** `srcset`/`image-set()` descriptor such as `2x` or `640w`. */
  descriptor: string | null;
  /** Extra qualifier: a `<source media>` query, a pseudo-element, a stylesheet href. */
  context: string | null;
  /** True only when the browser itself confirmed this is the variant in use. */
  chosen: boolean;
}

/** An authored reference, before resolution and deduplication. */
export interface AssetReference {
  /** The URL exactly as written in the page. */
  raw: string;
  /** What the surrounding markup implies, e.g. an `<img>` implies an image. */
  kindHint: AssetKind | null;
  /** A MIME type the markup declared, e.g. `<source type>` or `type()` in `image-set()`. */
  mimeHint: string | null;
  usage: AssetUsage;
}

/** A distinct asset, deduplicated by resolved URL across the whole page. */
export interface UrlAsset {
  /**
   * Resolved absolute URL. For oversized `data:` URIs this is a truncated
   * prefix — see `truncatedUrl` — so a 6 MB inline image does not get copied
   * into the report.
   */
  url: string;
  urlKind: AssetUrlKind;
  /** Protocol of an absolute URL (`https:`); null for `data:`, `blob:` and failures. */
  protocol: string | null;
  kind: AssetKind;
  naming: AssetNaming;
  byteSize: AssetByteSize;
  /** MIME type declared by the markup or the `data:` header; never sniffed. */
  mimeType: string | null;
  dataUri: DataUriInfo | null;
  /** True when `url` holds only a prefix of the real value. */
  truncatedUrl: boolean;
  /** Total reference sites, including any beyond the retained `usages`. */
  usageCount: number;
  usages: AssetUsage[];
  /** True when `usages` was capped and no longer lists every site. */
  usagesTruncated: boolean;
}

/**
 * A measurement that may not exist yet.
 *
 * `naturalWidth` is 0 until an image decodes and `getBoundingClientRect`
 * returns zeros for anything `display: none`, so both cases get named rather
 * than reported as a real zero.
 */
export type MeasuredSize =
  | { known: true; width: number; height: number }
  | { known: false; reason: 'not-loaded' | 'not-rendered' | 'unavailable' };

/**
 * Alt text, with the two very different kinds of "no alt" kept apart.
 *
 * `alt=""` is a deliberate statement that the image is decorative; a missing
 * `alt` attribute is an accessibility defect. Collapsing them to an empty
 * string loses the only interesting thing about the attribute.
 */
export type AltText =
  | { state: 'present'; text: string }
  | { state: 'empty-decorative' }
  | { state: 'missing' };

/** One `srcset` entry, still holding the URL exactly as authored. */
export interface SrcsetCandidate {
  raw: string;
  /** Full descriptor text, e.g. `2x`. Absent means the spec default of `1x`. */
  descriptor: string | null;
  density: number | null;
  width: number | null;
}

/** A `srcset` candidate after URL resolution, tagged with where it came from. */
export interface ResolvedSrcsetCandidate extends SrcsetCandidate {
  /** Resolved absolute URL, or the raw value when resolution failed. */
  url: string;
  resolved: boolean;
  origin: 'img-srcset' | 'picture-source';
  /** `<source media>` when the candidate came from a `<picture>` child. */
  media: string | null;
  /** `<source type>` when declared. */
  type: string | null;
}

/**
 * Which candidate the browser actually picked.
 *
 * Selection depends on viewport, DPR, `sizes`, and the format support of the
 * specific browser — it cannot be recomputed after the fact. So this is read
 * from `currentSrc` and reported as indeterminate when the browser has not
 * told us, rather than re-derived and probably wrong.
 */
export type SrcsetChoice<T> =
  | { status: 'chosen'; candidate: T; matchedBy: 'current-src' }
  | { status: 'src-fallback'; url: string }
  | {
      status: 'indeterminate';
      reason: 'no-current-src' | 'current-src-not-in-candidates';
      currentSrc: string | null;
    };

/** Everything worth knowing about one `<img>`. */
export interface ImageAsset {
  element: string;
  /** Resolved `src`; null when absent or unresolvable. */
  src: string | null;
  /** What the browser loaded. Null outside a real browser, or before load. */
  currentSrc: string | null;
  /** Every candidate from `srcset` plus any `<picture><source>` siblings. */
  candidates: ResolvedSrcsetCandidate[];
  choice: SrcsetChoice<ResolvedSrcsetCandidate>;
  /** `sizes` attribute, which drives `w`-descriptor selection. */
  sizes: string | null;
  alt: AltText;
  loading: string | null;
  decoding: string | null;
  /** Intrinsic dimensions of the decoded bitmap. */
  natural: MeasuredSize;
  /** On-screen dimensions, including any transform. */
  displayed: MeasuredSize;
  isPictureChild: boolean;
}

/**
 * A `<canvas>`, which is present but not harvestable by inspection.
 *
 * There is no URL and no file: the pixels live in a backing store that can
 * only be extracted by calling `toDataURL`/`getImageData`, which this module
 * deliberately does not do — it can throw on a tainted canvas, and on a
 * WebGL context without `preserveDrawingBuffer` it returns a blank frame.
 */
export interface CanvasAsset {
  element: string;
  /** Backing-store size from the width/height attributes, not the CSS size. */
  width: number;
  height: number;
  displayed: MeasuredSize;
  exportability: 'requires-pixel-read';
  /** Whether a pixel read would throw. Unknowable without attempting it. */
  crossOriginTaint: 'unknown';
}

/** A reference made from inside an inline `<svg>`. */
export interface SvgReference {
  kind: 'use' | 'image' | 'css-url';
  /** The href or `url()` target exactly as authored. */
  target: string;
  /**
   * `internal` resolves inside this same `<svg>`; `document` points at an id
   * defined elsewhere on the page (so lifting the markup out breaks it);
   * `external` points at another file.
   */
  scope: 'internal' | 'document' | 'external';
}

/** An inline `<svg>`, serialized into something that can be saved as a file. */
export interface InlineSvgAsset {
  element: string;
  /** Standalone markup with `xmlns` present, ready to write to a `.svg` file. */
  markup: string;
  /** Byte length of `markup` — knowable because this module produced it. */
  byteSize: AssetByteSize;
  /** Attribute values, not computed lengths: `24`, `100%` and `auto` all occur. */
  width: string | null;
  height: string | null;
  viewBox: string | null;
  /** Ids of `<symbol>` elements defined here — an inline sprite sheet. */
  symbolIds: string[];
  /**
   * References that will not survive extraction: ids defined elsewhere in the
   * page (gradients and filters are routinely hoisted into a hidden `<svg>`)
   * and links to other files.
   */
  externalReferences: SvgReference[];
  /** True when the markup exceeded the byte budget and was cut short. */
  truncated: boolean;
}

/** A `<use>` element, i.e. a sprite reference. */
export interface SpriteUsage {
  element: string;
  /** The href exactly as authored, `xlink:href` included. */
  target: string;
  /** Resolved URL of the sprite file; null for same-document references. */
  url: string | null;
  fragmentId: string | null;
  scope: 'internal' | 'document' | 'external';
}

/** One `<source>` child of a media element. */
export interface MediaSourceRef {
  raw: string;
  /** Resolved URL, or the raw value when resolution failed. */
  url: string;
  resolved: boolean;
  type: string | null;
  media: string | null;
}

/**
 * Playback length, which is only known once metadata has loaded.
 *
 * A live stream reports `Infinity` forever, which is a genuinely different
 * answer from "not loaded yet" and is kept separate.
 */
export type MediaDuration =
  | { known: true; seconds: number }
  | { known: false; reason: 'metadata-not-loaded' | 'unbounded-stream' };

/** Everything worth knowing about one `<video>`. */
export interface VideoAsset {
  element: string;
  src: string | null;
  currentSrc: string | null;
  sources: MediaSourceRef[];
  poster: string | null;
  /** Intrinsic frame size, available only after metadata loads. */
  intrinsic: MeasuredSize;
  displayed: MeasuredSize;
  duration: MediaDuration;
  preload: string | null;
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
}

/** Everything worth knowing about one `<audio>`. */
export interface AudioAsset {
  element: string;
  src: string | null;
  currentSrc: string | null;
  sources: MediaSourceRef[];
  duration: MediaDuration;
  preload: string | null;
  loop: boolean;
}

/**
 * A suspected Lottie animation.
 *
 * This is a hint and named like one. The JSON that would confirm it can only
 * be read over the network, so all this module can honestly report is the DOM
 * marker it saw and how strongly that marker implies Lottie.
 */
export interface LottieHint {
  element: string;
  marker: 'custom-element' | 'class-name' | 'data-attribute' | 'source-url';
  /** The concrete evidence: a tag name, class name, or `attribute=value`. */
  evidence: string;
  /** Resolved animation URL when an attribute exposed one. */
  url: string | null;
  confidence: 'likely' | 'possible';
}

/** One `src` entry of an `@font-face` rule. */
export interface FontFaceSourceRef {
  kind: 'url' | 'local';
  /** Resolved URL for `url` sources; the requested family name for `local`. */
  value: string;
  /** Raw authored value, before resolution. */
  raw: string;
  /** `format(woff2)` when declared — the only format signal available offline. */
  format: string | null;
  /** `tech(variations)` and friends, from CSS Fonts 4. */
  tech: string | null;
}

/** One `@font-face` rule found in a readable stylesheet. */
export interface FontFaceAsset {
  family: string | null;
  style: string | null;
  weight: string | null;
  display: string | null;
  unicodeRange: string | null;
  sources: FontFaceSourceRef[];
  /** Href of the stylesheet the rule came from; null for inline `<style>`. */
  stylesheet: string | null;
}

/**
 * A stylesheet whose rules could not be read.
 *
 * Cross-origin CSS throws on `cssRules` access unless it was served with CORS
 * headers, so webfonts declared in a third-party stylesheet are invisible to
 * this module. Reported explicitly, because "no fonts found" and "could not
 * look" are very different claims.
 */
export interface InaccessibleStylesheet {
  href: string | null;
  reason: 'cross-origin' | 'unreadable';
}

/** Caps applied while collecting, all of them deliberately conservative. */
export interface AssetBudget {
  /** Elements visited by the DOM walk before it stops. */
  maxElements: number;
  /** Distinct assets recorded before new ones are dropped. */
  maxAssets: number;
  /** Reference sites retained per asset; the count keeps rising past this. */
  maxUsagesPerAsset: number;
  /** Longest `data:` URI copied into the report verbatim. */
  maxDataUriBytes: number;
  /** Longest inline SVG serialization retained. */
  maxInlineSvgBytes: number;
}

/** What the collector had to leave out, and why. */
export interface AssetCollectionLimits {
  budget: AssetBudget;
  elementsVisited: number;
  /** True when the element budget stopped the walk before the page ended. */
  elementsTruncated: boolean;
  assetsRecorded: number;
  /** True when the asset budget dropped otherwise-valid assets. */
  assetsTruncated: boolean;
  shadowRootsEntered: number;
  /** References that never became assets, e.g. `url(#gradient)` or `about:blank`. */
  skippedReferences: number;
  inaccessibleStylesheets: InaccessibleStylesheet[];
}

/** The complete harvest of one page. */
export interface AssetInventory {
  /** Base the relative URLs were resolved against. */
  baseUrl: string;
  /** Deduplicated assets, most-used first. */
  assets: UrlAsset[];
  /** Per-kind totals over `assets`. */
  countsByKind: Record<AssetKind, number>;
  images: ImageAsset[];
  canvases: CanvasAsset[];
  inlineSvgs: InlineSvgAsset[];
  spriteUsages: SpriteUsage[];
  videos: VideoAsset[];
  audios: AudioAsset[];
  fonts: FontFaceAsset[];
  lottieHints: LottieHint[];
  limits: AssetCollectionLimits;
}
