import type {
  AssetByteSize,
  AssetKind,
  AssetNaming,
  DataUriInfo,
  ResolvedAssetUrl,
} from './types.js';

/** Schemes that never point at a retrievable asset, whatever the markup says. */
const UNSUPPORTED_SCHEME = /^(?:javascript|about|mailto|tel|sms|intent|chrome|moz-extension):/i;

const DATA_SCHEME = /^data:/i;
const BLOB_SCHEME = /^blob:/i;

/**
 * Turn an authored reference into an absolute URL, or say why it can't be one.
 *
 * `data:` and `blob:` deliberately bypass `new URL`, which would happily
 * re-encode a payload and change the bytes we are meant to be reporting.
 * A bare `#id` is not an asset at all — it is an intra-document reference,
 * common in SVG `fill="url(#grad)"` — so it gets its own reason rather than
 * being resolved into `page.html#id` and reported as an image.
 */
export function resolveAssetUrl(raw: string, baseUrl: string): ResolvedAssetUrl {
  const value = raw.trim();

  if (value.length === 0) return { kind: 'unresolvable', raw, reason: 'empty' };
  if (value.startsWith('#')) return { kind: 'unresolvable', raw: value, reason: 'fragment-only' };
  if (DATA_SCHEME.test(value)) return { kind: 'data', url: value };
  if (BLOB_SCHEME.test(value)) return { kind: 'blob', url: value };
  if (UNSUPPORTED_SCHEME.test(value)) {
    return { kind: 'unresolvable', raw: value, reason: 'unsupported-scheme' };
  }

  try {
    const url = new URL(value, baseUrl);
    return { kind: 'absolute', url: url.href, protocol: url.protocol };
  } catch {
    // Distinguish "this reference is broken" from "this document has no usable
    // base". A sandboxed iframe or a detached document reports `about:blank`
    // as its baseURI, under which every relative URL on the page is
    // unresolvable through no fault of its own.
    return { kind: 'unresolvable', raw: value, reason: isUsableBase(baseUrl) ? 'invalid-url' : 'no-usable-base' };
  }
}

/** Whether a string can serve as a base for relative URL resolution. */
export function isUsableBase(baseUrl: string): boolean {
  try {
    const base = new URL(baseUrl);
    // `about:blank` parses fine but cannot resolve a relative path against it.
    return base.protocol !== 'about:' && base.protocol !== 'blob:';
  } catch {
    return false;
  }
}

/**
 * Read the header and decoded length of a `data:` URI.
 *
 * Returns `null` when the value is not a parseable data URI — a missing comma
 * makes it invalid, and inventing a size for it would be exactly the kind of
 * confident guess this module avoids.
 */
export function measureDataUri(value: string): DataUriInfo | null {
  if (!DATA_SCHEME.test(value)) return null;

  const commaIndex = value.indexOf(',');
  if (commaIndex === -1) return null;

  const header = value.slice('data:'.length, commaIndex);
  const payload = value.slice(commaIndex + 1);
  const parts = header.split(';');
  const base64 = parts.some((part) => part.trim().toLowerCase() === 'base64');
  const first = parts[0]?.trim() ?? '';
  const mimeType = first.length > 0 && first.includes('/') ? first.toLowerCase() : null;

  return {
    mimeType,
    base64,
    bytes: base64 ? base64ByteLength(payload) : percentEncodedByteLength(payload),
  };
}

/**
 * Decoded length of a base64 payload without decoding it.
 *
 * Decoding a multi-megabyte inline image just to call `.length` on the result
 * doubles peak memory for no gain. Malformed lengths (not a multiple of four,
 * which happens with hand-edited markup) fall back to the proportional
 * estimate rather than throwing.
 */
export function base64ByteLength(payload: string): number {
  const clean = payload.replace(/\s/g, '');
  if (clean.length === 0) return 0;

  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  if (clean.length % 4 === 0) return (clean.length / 4) * 3 - padding;
  return Math.floor((clean.length * 3) / 4);
}

/** Byte length of a percent-encoded (non-base64) `data:` payload. */
export function percentEncodedByteLength(payload: string): number {
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).length;
  } catch {
    // Malformed escapes are common in hand-written SVG data URIs. Counting the
    // raw characters is an approximation, but a bounded and obvious one.
    return new TextEncoder().encode(payload).length;
  }
}

/** MIME types whose obvious extension is not just the subtype. */
const MIME_EXTENSIONS = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/svg+xml', 'svg'],
  ['image/x-icon', 'ico'],
  ['image/vnd.microsoft.icon', 'ico'],
  ['image/tiff', 'tif'],
  ['application/font-woff', 'woff'],
  ['application/font-woff2', 'woff2'],
  ['application/x-font-ttf', 'ttf'],
  ['application/x-font-opentype', 'otf'],
  ['application/vnd.ms-fontobject', 'eot'],
  ['font/truetype', 'ttf'],
  ['font/opentype', 'otf'],
  ['video/quicktime', 'mov'],
  ['audio/mpeg', 'mp3'],
  ['audio/x-m4a', 'm4a'],
]);

/**
 * Best-effort extension for a MIME type.
 *
 * Only used when the URL has no usable path — `data:` URIs, and endpoints like
 * `/media?id=42`. The result feeds a filename suggestion, never a claim about
 * what the file actually is.
 */
export function extensionForMimeType(mimeType: string | null): string | null {
  if (!mimeType) return null;

  const clean = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  const mapped = MIME_EXTENSIONS.get(clean);
  if (mapped) return mapped;

  const subtype = clean.split('/')[1];
  if (!subtype) return null;

  // `svg+xml` -> `svg`; `x-flv` -> `flv`. Anything left that isn't a plain
  // alphanumeric token (`vnd.adobe.photoshop`) is not a usable extension.
  const head = subtype.split('+')[0]?.replace(/^x-/, '') ?? '';
  return /^[a-z0-9]{1,8}$/.test(head) ? head : null;
}

/**
 * Derive a filename and extension from a URL path.
 *
 * Query strings are excluded deliberately: `logo.png?v=3` should be reported as
 * `logo.png`, and `render?format=png` has no filename at all. The extension is
 * only accepted when it looks like one — `example.com/v1.2/asset` must not
 * yield an extension of `2/asset`.
 */
export function guessAssetName(resolved: ResolvedAssetUrl, mimeType: string | null): AssetNaming {
  if (resolved.kind === 'absolute') {
    const path = stripQueryAndFragment(resolved.url);
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    const filename = decodeSegment(lastSegment);

    if (filename.length > 0) {
      const match = /\.([A-Za-z0-9]{1,8})$/.exec(filename);
      const fromPath = match?.[1]?.toLowerCase();
      if (fromPath) return { filename, extension: fromPath, source: 'path' };

      const fromMime = extensionForMimeType(mimeType);
      return fromMime
        ? { filename, extension: fromMime, source: 'mime' }
        : { filename, extension: null, source: 'path' };
    }

    const fromMime = extensionForMimeType(mimeType);
    return fromMime
      ? { filename: null, extension: fromMime, source: 'mime' }
      : { filename: null, extension: null, source: 'none' };
  }

  if (resolved.kind === 'data') {
    // A data URI has no name anywhere in it. The extension is the only thing
    // that can be recovered, and only from the declared media type.
    const declared = measureDataUri(resolved.url)?.mimeType ?? mimeType;
    const extension = extensionForMimeType(declared);
    return extension
      ? { filename: null, extension, source: 'mime' }
      : { filename: null, extension: null, source: 'none' };
  }

  return { filename: null, extension: null, source: 'none' };
}

function stripQueryAndFragment(url: string): string {
  const cut = Math.min(
    ...[url.indexOf('?'), url.indexOf('#')].filter((index) => index !== -1).concat(url.length),
  );
  return url.slice(0, cut);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

const EXTENSION_KINDS = new Map<string, AssetKind>([
  ['png', 'image'],
  ['jpg', 'image'],
  ['jpeg', 'image'],
  ['jfif', 'image'],
  ['gif', 'image'],
  ['webp', 'image'],
  ['avif', 'image'],
  ['bmp', 'image'],
  ['ico', 'image'],
  ['apng', 'image'],
  ['jxl', 'image'],
  ['tif', 'image'],
  ['tiff', 'image'],
  ['heic', 'image'],
  ['svg', 'svg'],
  ['svgz', 'svg'],
  ['woff', 'font'],
  ['woff2', 'font'],
  ['ttf', 'font'],
  ['otf', 'font'],
  ['eot', 'font'],
  ['mp4', 'video'],
  ['m4v', 'video'],
  ['webm', 'video'],
  ['mov', 'video'],
  ['ogv', 'video'],
  ['mpg', 'video'],
  ['mpeg', 'video'],
  ['mp3', 'audio'],
  ['wav', 'audio'],
  ['ogg', 'audio'],
  ['oga', 'audio'],
  ['m4a', 'audio'],
  ['aac', 'audio'],
  ['flac', 'audio'],
  ['opus', 'audio'],
  ['lottie', 'lottie'],
]);

/**
 * Decide what an asset is from its extension, MIME type and surrounding markup.
 *
 * SVG wins over the markup hint on purpose: an `<img src="logo.svg">` is an
 * image element, but the *asset* is vector, and that distinction is the whole
 * reason someone is harvesting it. Everything else defers to the hint last,
 * because `<video src="/stream">` really is a video even with nothing in the
 * URL to prove it.
 */
export function classifyAsset(options: {
  extension: string | null;
  mimeType: string | null;
  hint: AssetKind | null;
}): AssetKind {
  const extension = options.extension?.toLowerCase() ?? null;
  const mime = options.mimeType?.split(';')[0]?.trim().toLowerCase() ?? null;

  if (mime === 'image/svg+xml' || extension === 'svg' || extension === 'svgz') return 'svg';
  if (extension === 'lottie' || mime === 'application/zip+dotlottie') return 'lottie';

  if (mime) {
    if (mime.startsWith('font/') || mime.startsWith('application/font')) return 'font';
    if (mime === 'application/vnd.ms-fontobject') return 'font';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('image/')) return 'image';
  }

  const byExtension = extension ? EXTENSION_KINDS.get(extension) : undefined;
  if (byExtension) return byExtension;

  return options.hint ?? 'unknown';
}

/**
 * State the size honestly.
 *
 * Only `data:` URIs carry their bytes with them. Everything else — including
 * a `blob:` URL, whose payload lives in a store this module has no handle on —
 * would need a request, and requests are the one thing this package will never
 * make.
 */
export function describeByteSize(resolved: ResolvedAssetUrl, dataUri: DataUriInfo | null): AssetByteSize {
  if (resolved.kind === 'data' && dataUri) {
    return { known: true, bytes: dataUri.bytes, basis: 'data-uri' };
  }
  if (resolved.kind === 'blob') return { known: false, reason: 'opaque-blob-url' };
  return { known: false, reason: 'requires-network-access' };
}
