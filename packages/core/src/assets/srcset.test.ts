import { describe, expect, it } from 'vitest';
import { chooseSrcsetCandidate, parseSrcset } from './srcset.js';

describe('parseSrcset', () => {
  it('parses the ordinary density-descriptor form', () => {
    expect(parseSrcset('a.png 1x, a@2x.png 2x')).toEqual([
      { raw: 'a.png', descriptor: '1x', density: 1, width: null },
      { raw: 'a@2x.png', descriptor: '2x', density: 2, width: null },
    ]);
  });

  it('parses width descriptors', () => {
    expect(parseSrcset('s.jpg 480w, l.jpg 1600w')).toEqual([
      { raw: 's.jpg', descriptor: '480w', density: null, width: 480 },
      { raw: 'l.jpg', descriptor: '1600w', density: null, width: 1600 },
    ]);
  });

  it('keeps a URL that contains commas intact', () => {
    // A comma only separates candidates when it is followed by whitespace or
    // ends the URL. Splitting on every comma turns one image into three.
    const candidates = parseSrcset('https://cdn.dev/w_600,h_400,c_fill/photo.jpg 600w');
    expect(candidates).toEqual([
      {
        raw: 'https://cdn.dev/w_600,h_400,c_fill/photo.jpg',
        descriptor: '600w',
        density: null,
        width: 600,
      },
    ]);
  });

  it('keeps an inline data URI intact', () => {
    const value = 'data:image/svg+xml;base64,PHN2Zy8+ 1x, fallback.png 2x';
    expect(parseSrcset(value).map((candidate) => candidate.raw)).toEqual([
      'data:image/svg+xml;base64,PHN2Zy8+',
      'fallback.png',
    ]);
  });

  it('treats a comma glued to the end of a URL as a separator', () => {
    expect(parseSrcset('a.png,b.png 2x').map((candidate) => candidate.raw)).toEqual([
      'a.png,b.png',
    ]);
    expect(parseSrcset('a.png, b.png 2x').map((candidate) => candidate.raw)).toEqual([
      'a.png',
      'b.png',
    ]);
  });

  it('handles the multi-line formatting real templates produce', () => {
    const value = `
      /img/small.jpg   400w,
      /img/medium.jpg  800w,
      /img/large.jpg  1600w
    `;
    expect(parseSrcset(value).map((candidate) => candidate.width)).toEqual([400, 800, 1600]);
  });

  it('preserves the absence of a descriptor rather than defaulting it to 1x', () => {
    // "no descriptor" and "1x" render identically but are different authoring
    // facts, and only one of them is worth flagging in a report.
    expect(parseSrcset('only.png')).toEqual([
      { raw: 'only.png', descriptor: null, density: null, width: null },
    ]);
  });

  it('does not break out of a parenthesised descriptor', () => {
    const candidates = parseSrcset('a.png (min-width:600px) 2x, b.png 1x');
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.density).toBe(2);
  });

  it('accepts fractional densities', () => {
    expect(parseSrcset('a.png 1.5x')[0]?.density).toBe(1.5);
  });

  it('ignores an unparseable descriptor without dropping the candidate', () => {
    const candidate = parseSrcset('a.png banana')[0];
    expect(candidate?.raw).toBe('a.png');
    expect(candidate?.descriptor).toBe('banana');
    expect(candidate?.density).toBeNull();
  });

  it('returns nothing for an absent or empty attribute', () => {
    expect(parseSrcset(null)).toEqual([]);
    expect(parseSrcset('   ')).toEqual([]);
    expect(parseSrcset(',,,')).toEqual([]);
  });
});

describe('chooseSrcsetCandidate', () => {
  const candidates = [
    { url: 'https://x.dev/a.png', label: 'small' },
    { url: 'https://x.dev/a@2x.png', label: 'large' },
  ];

  it('identifies the candidate the browser loaded', () => {
    expect(chooseSrcsetCandidate(candidates, 'https://x.dev/a@2x.png', 'https://x.dev/a.png')).toEqual(
      { status: 'chosen', candidate: candidates[1], matchedBy: 'current-src' },
    );
  });

  it('reports a fall back to src when that is what happened', () => {
    expect(chooseSrcsetCandidate([], 'https://x.dev/f.png', 'https://x.dev/f.png')).toEqual({
      status: 'src-fallback',
      url: 'https://x.dev/f.png',
    });
  });

  it('refuses to guess when the browser has not said', () => {
    // Outside a browser, and before an image loads, `currentSrc` is empty.
    // Re-deriving the choice needs the viewport, the DPR and the browser's
    // format support, so the honest answer is that we do not know.
    expect(chooseSrcsetCandidate(candidates, null, 'https://x.dev/a.png')).toEqual({
      status: 'indeterminate',
      reason: 'no-current-src',
      currentSrc: null,
    });
  });

  it('flags a currentSrc that matches nothing in the markup', () => {
    // A service worker or an image CDN can rewrite the loaded URL, and lazy
    // loaders swap srcset after load. Silently reporting "chosen: none" would
    // hide a file the page really did fetch.
    expect(chooseSrcsetCandidate(candidates, 'https://cdn.dev/rewritten.webp', null)).toEqual({
      status: 'indeterminate',
      reason: 'current-src-not-in-candidates',
      currentSrc: 'https://cdn.dev/rewritten.webp',
    });
  });
});
