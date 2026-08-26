/**
 * Recovering the design decision behind a resolved grid track list.
 *
 * `getComputedStyle` flattens `repeat(auto-fit, minmax(240px, 1fr))` into
 * `300px 300px 300px`. That is the truth about this moment and tells a
 * developer nothing about the layout: not that it is responsive, not what the
 * minimum card width is, not that the count will change on resize. This module
 * takes the used value plus — when the cascade module can supply it — the
 * authored declaration, and reconstructs the intent.
 *
 * Everything here is pure string work so it can be tested exhaustively; no DOM
 * implementation outside a real browser resolves `fr` units faithfully.
 */

import { joinWithAnd, parseCssLength, splitTopLevel, unwrapFunction } from './css-text.js';

/** Which grid axis a track list describes. Only affects wording. */
export type TrackAxis = 'columns' | 'rows';

/** One track's sizing function, as written or as resolved. */
export type TrackSize =
  | {
      kind: 'fixed';
      raw: string;
      /** Pixels when the unit is absolute; `null` for percentages, which need a container. */
      px: number | null;
    }
  | { kind: 'flex'; raw: string; fr: number }
  | { kind: 'auto' | 'min-content' | 'max-content'; raw: string }
  | { kind: 'minmax'; raw: string; min: TrackSize; max: TrackSize }
  | { kind: 'fit-content'; raw: string; limit: string }
  | {
      kind: 'repeat';
      raw: string;
      /** A number, or the keyword when the count is decided by the container. */
      count: number | 'auto-fit' | 'auto-fill';
      tracks: TrackSize[];
    }
  | { kind: 'other'; raw: string };

/** A named grid line and the track index it precedes. */
export interface LineNames {
  /** Index in `tracks` that this name group sits before. */
  before: number;
  names: string[];
}

/** A parsed `grid-template-columns` / `grid-template-rows` value. */
export interface TrackList {
  raw: string;
  /** Tracks in source order. A `repeat()` stays one entry; see {@link expandTracks}. */
  tracks: TrackSize[];
  lineNames: LineNames[];
  /** Set when the value is a keyword rather than a track list. */
  keyword: 'none' | 'subgrid' | 'masonry' | null;
}

const KEYWORD_TRACKS: ReadonlySet<string> = new Set(['auto', 'min-content', 'max-content']);
const FR = /^([+-]?(?:\d+\.?\d*|\.\d+))fr$/i;

function parseRepeat(fn: { name: string; args: string[]; raw: string }): TrackSize | null {
  const [countArg, ...rest] = fn.args;
  if (countArg === undefined || rest.length === 0) return null;

  const keyword = countArg.trim().toLowerCase();
  const count =
    keyword === 'auto-fit' || keyword === 'auto-fill' ? keyword : Number.parseInt(keyword, 10);
  if (typeof count === 'number' && (!Number.isFinite(count) || count < 1)) return null;

  const tracks = rest
    .flatMap((group) => splitTopLevel(group, 'whitespace'))
    .filter((token) => !token.startsWith('['))
    .map(parseTrackSize);
  if (tracks.length === 0) return null;

  return { kind: 'repeat', raw: fn.raw, count, tracks };
}

/**
 * Parse a single track sizing function.
 *
 * Unrecognized syntax degrades to `other` carrying the original text rather
 * than being dropped: a value we cannot classify is still worth showing.
 */
export function parseTrackSize(raw: string): TrackSize {
  const value = raw.trim();
  const lower = value.toLowerCase();

  if (KEYWORD_TRACKS.has(lower)) {
    return { kind: lower as 'auto' | 'min-content' | 'max-content', raw: value };
  }

  const fr = FR.exec(lower);
  if (fr?.[1] !== undefined) {
    return { kind: 'flex', raw: value, fr: Number.parseFloat(fr[1]) };
  }

  const fn = unwrapFunction(value);
  if (fn) {
    if (fn.name === 'minmax' && fn.args.length === 2) {
      const [min, max] = fn.args;
      if (min !== undefined && max !== undefined) {
        return { kind: 'minmax', raw: value, min: parseTrackSize(min), max: parseTrackSize(max) };
      }
    }
    if (fn.name === 'fit-content' && fn.args.length === 1) {
      const limit = fn.args[0];
      if (limit !== undefined) return { kind: 'fit-content', raw: value, limit };
    }
    if (fn.name === 'repeat') {
      const repeat = parseRepeat(fn);
      if (repeat) return repeat;
    }
  }

  const length = parseCssLength(value);
  if (length) return { kind: 'fixed', raw: value, px: length.px };
  // Percentages are fixed in the sense that matters here — they do not flex to
  // absorb free space — but their pixel size depends on a container we cannot
  // see from a string.
  if (value.endsWith('%') && parseCssLength(value.slice(0, -1)) !== null) {
    return { kind: 'fixed', raw: value, px: null };
  }

  return { kind: 'other', raw: value };
}

/**
 * Parse a full track list, keeping named lines.
 *
 * Handles both directions this module cares about: authored values full of
 * `repeat()` and `minmax()`, and used values which are a flat run of pixel
 * lengths. `subgrid` and `masonry` come back as keywords with no tracks,
 * because in those cases the tracks genuinely live somewhere else.
 */
export function parseTrackList(value: string | null | undefined): TrackList {
  const raw = (value ?? '').trim();
  const tracks: TrackSize[] = [];
  const lineNames: LineNames[] = [];
  let keyword: TrackList['keyword'] = null;

  if (raw === '' || raw.toLowerCase() === 'none') {
    return { raw, tracks, lineNames, keyword: 'none' };
  }

  for (const token of splitTopLevel(raw, 'whitespace')) {
    const lower = token.toLowerCase();

    if (token.startsWith('[')) {
      const inner = token.replace(/^\[|\]$/g, '').trim();
      const names = inner.length > 0 ? inner.split(/\s+/) : [];
      if (names.length > 0) lineNames.push({ before: tracks.length, names });
      continue;
    }

    if (lower === 'subgrid' || lower === 'masonry') {
      keyword = lower;
      continue;
    }

    tracks.push(parseTrackSize(token));
  }

  return { raw, tracks, lineNames, keyword };
}

/**
 * Expand numeric `repeat()` entries into individual tracks.
 *
 * Returns `null` when an `auto-fit` / `auto-fill` repeat is present: the count
 * is decided by the container's width at layout time, so any number we produced
 * here would be invented.
 */
export function expandTracks(list: TrackList): TrackSize[] | null {
  const expanded: TrackSize[] = [];

  for (const track of list.tracks) {
    if (track.kind !== 'repeat') {
      expanded.push(track);
      continue;
    }
    if (typeof track.count !== 'number') return null;
    for (let index = 0; index < track.count; index += 1) expanded.push(...track.tracks);
  }

  return expanded;
}

/** How many tracks the list produces, or `null` when only layout can decide. */
export function countTracks(list: TrackList): number | null {
  return expandTracks(list)?.length ?? null;
}

/** Describe one track's sizing in words a developer would use out loud. */
export function describeTrackSize(track: TrackSize): string {
  switch (track.kind) {
    case 'fixed':
      return track.raw;
    case 'flex':
      return track.fr === 1 ? 'flexible' : `flexible (${track.raw})`;
    case 'auto':
      return 'auto-sized';
    case 'min-content':
      return 'min-content';
    case 'max-content':
      return 'max-content';
    case 'fit-content':
      return `fit-content up to ${track.limit}`;
    case 'minmax':
      return `${describeTrackSize(track.min)} to ${describeTrackSize(track.max)}`;
    case 'repeat': {
      const inner = track.tracks.map(describeTrackSize).join(', ');
      return typeof track.count === 'number'
        ? `${track.count} × ${inner}`
        : `${track.count}: ${inner}`;
    }
    case 'other':
      return track.raw;
  }
}

function axisNoun(count: number, axis: TrackAxis): string {
  const singular = axis === 'columns' ? 'column' : 'row';
  return count === 1 ? singular : axis;
}

/** The single auto-repeat entry in a list, when that is all the list contains. */
function soleAutoRepeat(list: TrackList): Extract<TrackSize, { kind: 'repeat' }> | null {
  if (list.tracks.length !== 1) return null;
  const only = list.tracks[0];
  if (only?.kind !== 'repeat' || typeof only.count === 'number') return null;
  return only;
}

/**
 * Describe the shape of a track list without any authored value to lean on.
 *
 * This is the fallback answer — "3 equal columns", "2 columns: 240px and
 * flexible" — and it is deliberately about the pattern, not the pixels. A used
 * value produces pixel widths here because that is all a used value contains;
 * an authored value produces words like "flexible" because that is what `1fr`
 * means.
 */
export function describeTrackPattern(list: TrackList, axis: TrackAxis = 'columns'): string {
  if (list.keyword === 'subgrid') return `subgrid — ${axis} come from the parent grid`;
  if (list.keyword === 'masonry') return `masonry ${axis}`;

  const autoRepeat = soleAutoRepeat(list);
  if (autoRepeat) {
    const inner = autoRepeat.tracks.map(describeTrackSize).join(', ');
    const verb = autoRepeat.count === 'auto-fit' ? 'fit' : 'fill';
    return `as many ${axis} as ${verb}, each ${inner}`;
  }

  const expanded = expandTracks(list);
  if (expanded === null) {
    return `${axis} sized by ${list.tracks.map(describeTrackSize).join(', ')}`;
  }
  if (expanded.length === 0) return `no explicit ${axis}`;

  const descriptions = expanded.map(describeTrackSize);
  const first = descriptions[0];
  const uniform = descriptions.every((description) => description === first);

  if (uniform && expanded.length > 1) {
    return `${expanded.length} equal ${axisNoun(expanded.length, axis)}`;
  }

  return `${expanded.length} ${axisNoun(expanded.length, axis)}: ${joinWithAnd(descriptions)}`;
}

/** The recognizable idiom behind an authored track list. */
export type AuthoredPattern =
  | {
      kind: 'auto-repeat';
      mode: 'auto-fit' | 'auto-fill';
      /** The lower bound of the repeated track, e.g. `240px`. */
      min: string;
      /** The upper bound, e.g. `1fr`. Null when the track is not a `minmax()`. */
      max: string | null;
    }
  | { kind: 'fixed-repeat'; count: number; track: string }
  | { kind: 'subgrid' }
  | { kind: 'explicit' }
  | { kind: 'none' }
  | { kind: 'unknown' };

/** What {@link recoverAuthoredIntent} needs. `authored` comes from the cascade module. */
export interface AuthoredIntentInput {
  /** The used value, e.g. `300px 300px 300px`. */
  computed: string | null | undefined;
  /** The winning declaration as written, e.g. `repeat(auto-fit, minmax(240px, 1fr))`. */
  authored?: string | null;
  axis?: TrackAxis;
}

/** The authored design decision, recovered as far as the inputs allow. */
export interface AuthoredIntent {
  /**
   * `authored` when we had the declaration, `observed` when we could only read
   * used values, `unknown` when there is nothing to describe at all. The UI
   * should say which one it is — an inferred pattern is not a quoted source.
   */
  confidence: 'authored' | 'observed' | 'unknown';
  authored: string | null;
  computed: string;
  axis: TrackAxis;
  /** Parsed used value. After layout these are pixel lengths. */
  used: TrackList;
  /** Parsed authored value, when one was supplied. */
  intent: TrackList | null;
  pattern: AuthoredPattern;
  /** One sentence for the panel, e.g. "3 columns from repeat(...) — currently 300px each". */
  explanation: string;
  /** Set when the authored value cannot by itself explain the used value. */
  note: string | null;
}

function classifyAuthored(list: TrackList | null): AuthoredPattern {
  if (!list) return { kind: 'unknown' };
  if (list.keyword === 'subgrid') return { kind: 'subgrid' };
  if (list.tracks.length === 0) return { kind: 'none' };

  const autoRepeat = soleAutoRepeat(list);
  if (autoRepeat && (autoRepeat.count === 'auto-fit' || autoRepeat.count === 'auto-fill')) {
    const track = autoRepeat.tracks[0];
    if (track?.kind === 'minmax') {
      return { kind: 'auto-repeat', mode: autoRepeat.count, min: track.min.raw, max: track.max.raw };
    }
    return {
      kind: 'auto-repeat',
      mode: autoRepeat.count,
      min: track?.raw ?? '',
      max: null,
    };
  }

  if (list.tracks.length === 1) {
    const only = list.tracks[0];
    if (only?.kind === 'repeat' && typeof only.count === 'number') {
      return {
        kind: 'fixed-repeat',
        count: only.count,
        track: only.tracks.map((entry) => entry.raw).join(' '),
      };
    }
  }

  return { kind: 'explicit' };
}

/** "300px each" when every used track matches, otherwise "240px and 660px". */
function describeUsedSizes(used: TrackList): string | null {
  const expanded = expandTracks(used);
  if (!expanded || expanded.length === 0) return null;

  const raws = expanded.map((track) => track.raw);
  const first = raws[0];
  if (raws.every((raw) => raw === first)) {
    return raws.length === 1 ? (first ?? null) : `${first ?? ''} each`;
  }
  return joinWithAnd(raws);
}

/**
 * Explain a grid track list, using the authored declaration when available.
 *
 * The two halves answer different questions and both matter: the authored form
 * says what the layout is *for* ("as many 240px-minimum cards as fit"), the
 * used value says what it is doing *right now* ("300px each"). With no authored
 * value we fall back to describing the observed pattern and mark the result
 * `observed`, because "3 equal columns" is an inference — the source could just
 * as easily have said `repeat(3, 1fr)` or `1fr 1fr 1fr` or a media query.
 */
export function recoverAuthoredIntent(input: AuthoredIntentInput): AuthoredIntent {
  const axis = input.axis ?? 'columns';
  const computed = (input.computed ?? '').trim();
  const authored = input.authored?.trim() ? input.authored.trim() : null;

  const used = parseTrackList(computed);
  const intent = authored === null ? null : parseTrackList(authored);
  const pattern = classifyAuthored(intent);

  const usedCount = countTracks(used);
  const sizes = describeUsedSizes(used);
  let note: string | null = null;

  if (intent !== null) {
    const intendedCount = countTracks(intent);
    if (pattern.kind === 'auto-repeat') {
      note = 'the track count changes with the container width';
    } else if (
      intendedCount !== null &&
      usedCount !== null &&
      usedCount > 0 &&
      intendedCount !== usedCount
    ) {
      note = `the declaration asks for ${intendedCount} ${axisNoun(
        intendedCount,
        axis,
      )} but layout resolved ${usedCount} — something later in the cascade, likely a media query, is overriding it`;
    }

    const head =
      usedCount !== null && usedCount > 0
        ? `${usedCount} ${axisNoun(usedCount, axis)}`
        : describeTrackPattern(intent, axis);
    const explanation =
      sizes === null
        ? `${head} from ${authored ?? ''} — no tracks are resolved right now`
        : `${head} from ${authored ?? ''} — currently ${sizes}`;

    return {
      confidence: 'authored',
      authored,
      computed,
      axis,
      used,
      intent,
      pattern,
      explanation,
      note,
    };
  }

  if (used.keyword === 'none' || (used.tracks.length === 0 && used.keyword === null)) {
    return {
      confidence: 'unknown',
      authored: null,
      computed,
      axis,
      used,
      intent: null,
      pattern: { kind: 'none' },
      explanation: `no explicit ${axis} — this element declares none, so any tracks are implicit`,
      note: null,
    };
  }

  const observed = describeTrackPattern(used, axis);
  const uniformSuffix = sizes !== null && sizes.endsWith(' each') ? `, ${sizes}` : '';

  return {
    confidence: 'observed',
    authored: null,
    computed,
    axis,
    used,
    intent: null,
    pattern: { kind: 'unknown' },
    explanation: `${observed}${uniformSuffix}`,
    note: 'used values only — the authored declaration was not available, so the pattern is inferred',
  };
}
