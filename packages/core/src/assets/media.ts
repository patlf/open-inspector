import { readDisplayedSize } from './images.js';
import { buildAssetUsage, resolveReference } from './reference.js';
import type {
  AssetReference,
  AssetUsageVia,
  AudioAsset,
  LottieHint,
  MeasuredSize,
  MediaDuration,
  MediaSourceRef,
  VideoAsset,
} from './types.js';
import { elementLabel } from './walk.js';

/** What one media element contributed. */
export interface VideoHarvest {
  video: VideoAsset;
  references: AssetReference[];
}

export interface AudioHarvest {
  audio: AudioAsset;
  references: AssetReference[];
}

/**
 * Interpret `HTMLMediaElement.duration`.
 *
 * Three states share one number: `NaN` before metadata arrives, `Infinity` for
 * a live or unbounded stream, and a real length afterwards. Rendering `NaN` as
 * `0:00` — the usual outcome — tells the user the video is empty, which it is
 * not.
 */
export function interpretDuration(duration: number | undefined): MediaDuration {
  if (typeof duration !== 'number' || Number.isNaN(duration)) {
    return { known: false, reason: 'metadata-not-loaded' };
  }
  if (!Number.isFinite(duration)) return { known: false, reason: 'unbounded-stream' };
  return { known: true, seconds: duration };
}

/**
 * Collect the `<source>` children of a media element.
 *
 * Order matters and is preserved: the browser takes the first source whose
 * `type` and `media` it can satisfy, so position is the only clue about which
 * file is the intended default.
 */
export function readMediaSources(media: Element, baseUrl: string): MediaSourceRef[] {
  const sources: MediaSourceRef[] = [];

  for (const child of Array.from(media.children)) {
    if (child.tagName.toUpperCase() !== 'SOURCE') continue;
    const raw = child.getAttribute('src');
    if (!raw) continue;

    const resolved = resolveReference(raw, baseUrl);
    sources.push({
      raw,
      url: resolved.url,
      resolved: resolved.resolved,
      type: child.getAttribute('type'),
      media: child.getAttribute('media'),
    });
  }

  return sources;
}

function mediaReferences(
  media: Element,
  label: string,
  baseUrl: string,
  vias: { src: AssetUsageVia; source: AssetUsageVia },
  kindHint: 'video' | 'audio',
): { references: AssetReference[]; sources: MediaSourceRef[]; src: string | null } {
  const references: AssetReference[] = [];
  const srcAttribute = media.getAttribute('src');
  const src = srcAttribute ? resolveReference(srcAttribute, baseUrl).url : null;

  if (srcAttribute) {
    references.push({
      raw: srcAttribute,
      kindHint,
      mimeHint: null,
      usage: buildAssetUsage(vias.src, label, 'src'),
    });
  }

  const sources = readMediaSources(media, baseUrl);
  for (const source of sources) {
    references.push({
      raw: source.raw,
      kindHint,
      mimeHint: source.type,
      usage: buildAssetUsage(vias.source, label, 'src', { context: source.media }),
    });
  }

  return { references, sources, src };
}

/**
 * Intrinsic frame size of a video.
 *
 * `videoWidth` is 0 until metadata loads, exactly like an image's
 * `naturalWidth`, and gets the same honest treatment.
 */
function readIntrinsicVideoSize(video: HTMLVideoElement): MeasuredSize {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (typeof width !== 'number' || typeof height !== 'number') {
    return { known: false, reason: 'unavailable' };
  }
  if (width === 0 && height === 0) return { known: false, reason: 'not-loaded' };
  return { known: true, width, height };
}

/**
 * Harvest one `<video>`.
 *
 * The poster is treated as a first-class asset rather than a detail of the
 * video: it is a still image, it is frequently the highest-quality frame
 * available, and it is the only part of a video a harvesting tool can hand
 * over without a network request.
 */
export function readVideoElement(video: HTMLVideoElement, baseUrl: string): VideoHarvest {
  const label = elementLabel(video);
  const { references, sources, src } = mediaReferences(
    video,
    label,
    baseUrl,
    { src: 'video-src', source: 'video-source' },
    'video',
  );

  const posterAttribute = video.getAttribute('poster');
  const poster = posterAttribute ? resolveReference(posterAttribute, baseUrl).url : null;
  if (posterAttribute) {
    references.push({
      raw: posterAttribute,
      kindHint: 'image',
      mimeHint: null,
      usage: buildAssetUsage('video-poster', label, 'poster'),
    });
  }

  const currentSrcValue = typeof video.currentSrc === 'string' ? video.currentSrc : '';

  return {
    video: {
      element: label,
      src,
      currentSrc: currentSrcValue.length > 0 ? currentSrcValue : null,
      sources,
      poster,
      intrinsic: readIntrinsicVideoSize(video),
      displayed: readDisplayedSize(video),
      duration: interpretDuration(video.duration),
      preload: video.getAttribute('preload'),
      autoplay: video.hasAttribute('autoplay'),
      loop: video.hasAttribute('loop'),
      muted: video.hasAttribute('muted'),
    },
    references,
  };
}

/** Harvest one `<audio>`. There is no poster and no intrinsic size to report. */
export function readAudioElement(audio: HTMLAudioElement, baseUrl: string): AudioHarvest {
  const label = elementLabel(audio);
  const { references, sources, src } = mediaReferences(
    audio,
    label,
    baseUrl,
    { src: 'audio-src', source: 'audio-source' },
    'audio',
  );

  const currentSrcValue = typeof audio.currentSrc === 'string' ? audio.currentSrc : '';

  return {
    audio: {
      element: label,
      src,
      currentSrc: currentSrcValue.length > 0 ? currentSrcValue : null,
      sources,
      duration: interpretDuration(audio.duration),
      preload: audio.getAttribute('preload'),
      loop: audio.hasAttribute('loop'),
    },
    references,
  };
}

/** Attributes that carry an animation URL on the various Lottie players. */
const LOTTIE_URL_ATTRIBUTES = ['src', 'data-src', 'data-animation-path', 'data-lottie-src'];

/**
 * Look for signs of a Lottie animation.
 *
 * This is a hint and it is named like one. Confirming a Lottie means reading
 * the JSON and finding its `v`/`layers` keys, and the JSON is only reachable
 * over the network — which this engine never touches. So the honest output is
 * the marker that was seen plus how strongly it implies Lottie: a
 * `<lottie-player>` element is about as good as evidence gets without the
 * file, whereas a `.json` URL on an element merely mentioning animation is a
 * guess and is labelled `possible`.
 *
 * Returns at most one hint per element, the strongest one, so a player with a
 * `lottie` class and a `lottie` tag name does not report twice.
 */
export function detectLottie(element: Element, baseUrl: string): LottieHint | null {
  const tag = element.tagName.toLowerCase();
  const hint = (
    marker: LottieHint['marker'],
    evidence: string,
    confidence: LottieHint['confidence'],
  ): LottieHint => ({
    element: elementLabel(element),
    marker,
    evidence,
    url: readLottieUrl(element, baseUrl)?.value ?? null,
    confidence,
  });

  if (tag.includes('lottie')) return hint('custom-element', tag, 'likely');

  const className = Array.from(element.classList).find((name) =>
    name.toLowerCase().includes('lottie'),
  );
  if (className) return hint('class-name', className, 'likely');

  for (const name of element.getAttributeNames()) {
    const lowerName = name.toLowerCase();
    const value = element.getAttribute(name) ?? '';

    // The attribute *name* naming Lottie is strong evidence. A value that
    // merely mentions it is only interesting on a data attribute — otherwise
    // a link to an article titled "Lottie vs GIF" would be reported as an
    // animation, which is exactly the kind of confident nonsense to avoid.
    const named = lowerName.includes('lottie');
    const carried = lowerName.startsWith('data-') && value.toLowerCase().includes('lottie');
    if (!named && !carried) continue;

    return hint('data-attribute', `${name}=${value.slice(0, 80)}`, 'likely');
  }

  const url = readLottieUrl(element, baseUrl);
  if (!url) return null;

  // `.lottie` is the dotLottie container and means what it says.
  if (url.extension === 'lottie') return hint('source-url', url.raw, 'likely');

  // A `.json` on something calling itself an animation is suggestive and
  // nothing more — plenty of animation libraries ship their own JSON formats.
  if (url.extension === 'json' && /anim/i.test(url.raw)) {
    return hint('source-url', url.raw, 'possible');
  }

  return null;
}

function readLottieUrl(
  element: Element,
  baseUrl: string,
): { raw: string; value: string; extension: string | null } | null {
  for (const attribute of LOTTIE_URL_ATTRIBUTES) {
    const raw = element.getAttribute(attribute);
    if (!raw) continue;

    const value = resolveReference(raw, baseUrl).url;
    const match = /\.([a-z0-9]{1,8})(?:[?#]|$)/i.exec(raw);
    return { raw, value, extension: match?.[1]?.toLowerCase() ?? null };
  }
  return null;
}

/** A Lottie hint plus the animation file it pointed at, when it named one. */
export interface LottieHarvest {
  hint: LottieHint;
  reference: AssetReference | null;
}

/**
 * Detect a Lottie player and register the animation file it names.
 *
 * The URL is worth recording even though its contents can never be read here:
 * knowing the page pulls `/anim/hero.json` is most of what a person wanting to
 * reuse the animation needs.
 */
export function readLottieElement(element: Element, baseUrl: string): LottieHarvest | null {
  const hint = detectLottie(element, baseUrl);
  if (!hint) return null;

  const url = readLottieUrl(element, baseUrl);
  if (!url) return { hint, reference: null };

  return {
    hint,
    reference: {
      raw: url.raw,
      kindHint: 'lottie',
      mimeHint: null,
      usage: buildAssetUsage('lottie-source', hint.element, 'src', { context: hint.marker }),
    },
  };
}
