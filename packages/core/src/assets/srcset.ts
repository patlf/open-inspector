import type { SrcsetCandidate, SrcsetChoice } from './types.js';

/**
 * Parse a `srcset` attribute the way the HTML parser does.
 *
 * The obvious implementation — split on commas — is wrong, and wrong on
 * exactly the pages worth harvesting. A URL may legally contain commas
 * (`data:image/svg+xml,%3Csvg...`, or `photo,2.jpg` from a CMS), so the spec
 * ends the URL at whitespace, not at a comma, and only treats a *trailing*
 * comma as a separator. Descriptors are then read up to the next top-level
 * comma, with parentheses tracked so a future descriptor syntax cannot break
 * out early.
 *
 * Everything here is pure string work so the ugly inputs can be tested
 * directly, without an image element or a layout engine in sight.
 */
export function parseSrcset(value: string | null | undefined): SrcsetCandidate[] {
  if (!value) return [];

  const candidates: SrcsetCandidate[] = [];
  let position = 0;

  while (position < value.length) {
    while (position < value.length && isSeparator(value[position])) position += 1;
    if (position >= value.length) break;

    const urlStart = position;
    while (position < value.length && !isWhitespace(value[position])) position += 1;

    const rawUrl = value.slice(urlStart, position);

    if (rawUrl.endsWith(',')) {
      // A comma glued to the end of the URL terminates the candidate; the URL
      // itself keeps any interior commas.
      candidates.push(buildCandidate(rawUrl.replace(/,+$/, ''), []));
      continue;
    }

    const consumed = consumeDescriptors(value, position);
    position = consumed.position;

    candidates.push(buildCandidate(rawUrl, consumed.descriptors));
  }

  return candidates.filter((candidate) => candidate.raw.length > 0);
}

function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

function isSeparator(char: string | undefined): boolean {
  return isWhitespace(char) || char === ',';
}

/**
 * Read the descriptor list that follows a candidate URL.
 *
 * Stops at the first top-level comma and reports the position just past it, so
 * the caller resumes at the next candidate. Parenthesised text is swallowed
 * whole — the spec does this so descriptors can grow a function syntax without
 * breaking existing parsers.
 */
function consumeDescriptors(
  value: string,
  start: number,
): { descriptors: string[]; position: number } {
  const descriptors: string[] = [];
  let current = '';
  let inParens = false;
  let position = start;

  const flush = (): void => {
    if (current.length > 0) descriptors.push(current);
    current = '';
  };

  while (position < value.length) {
    const char = value[position];
    position += 1;

    if (inParens) {
      current += char;
      if (char === ')') inParens = false;
      continue;
    }
    if (char === '(') {
      current += char;
      inParens = true;
      continue;
    }
    if (char === ',') {
      flush();
      return { descriptors, position };
    }
    if (isWhitespace(char)) {
      flush();
      continue;
    }
    current += char;
  }

  flush();
  return { descriptors, position };
}

function buildCandidate(raw: string, descriptors: readonly string[]): SrcsetCandidate {
  let density: number | null = null;
  let width: number | null = null;

  for (const descriptor of descriptors) {
    const densityMatch = /^([0-9]*\.?[0-9]+)x$/i.exec(descriptor);
    if (densityMatch) {
      const parsed = Number.parseFloat(densityMatch[1] ?? '');
      if (Number.isFinite(parsed)) density = parsed;
      continue;
    }

    const widthMatch = /^([0-9]+)w$/i.exec(descriptor);
    if (widthMatch) {
      const parsed = Number.parseInt(widthMatch[1] ?? '', 10);
      if (Number.isFinite(parsed)) width = parsed;
    }
  }

  return {
    raw,
    // Absence is preserved rather than normalised to `1x`: "the author wrote
    // no descriptor" and "the author wrote 1x" are different facts, even
    // though the browser treats them the same.
    descriptor: descriptors.length > 0 ? descriptors.join(' ') : null,
    density,
    width,
  };
}

/**
 * Identify which candidate the browser actually loaded.
 *
 * Selection depends on the viewport, the device pixel ratio, the `sizes`
 * attribute and the browser's own format support — it cannot be recomputed
 * from the markup after the fact, and a harvester that guesses will hand the
 * user the wrong file. So the answer comes from `currentSrc` or not at all;
 * the failure modes are named instead of papered over.
 *
 * `current-src-not-in-candidates` is a real case, not defensive padding: a
 * service worker or an image CDN can rewrite the chosen URL, and lazy-loading
 * scripts routinely swap `srcset` after the load has happened.
 */
export function chooseSrcsetCandidate<T extends { url: string }>(
  candidates: readonly T[],
  currentSrc: string | null,
  srcUrl: string | null,
): SrcsetChoice<T> {
  if (!currentSrc) {
    return { status: 'indeterminate', reason: 'no-current-src', currentSrc: null };
  }

  const match = candidates.find((candidate) => candidate.url === currentSrc);
  if (match) return { status: 'chosen', candidate: match, matchedBy: 'current-src' };

  if (srcUrl !== null && srcUrl === currentSrc) return { status: 'src-fallback', url: srcUrl };

  return { status: 'indeterminate', reason: 'current-src-not-in-candidates', currentSrc };
}
