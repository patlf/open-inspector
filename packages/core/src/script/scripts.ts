import { fileName } from '../probe/tree.js';

/** A `<script>` on the page, as the JS view lists it. */
export interface PageScript {
  /** What people call it: the file name, or `inline`. */
  name: string;
  /** The `src` as written, for an external script. */
  url?: string | undefined;
  /** `module`, `classic`, `importmap`, `json`, or the type as written. */
  kind: string;
  async: boolean;
  defer: boolean;
  /** An inline script's source, cut to `MAX_INLINE_SOURCE`. */
  text?: string | undefined;
  /** An inline script's full length in UTF-8 bytes. */
  bytes?: number | undefined;
}

/** Room to read an inline script; past this it is a bundle, and a long one. */
export const MAX_INLINE_SOURCE = 20_000;
export const MAX_PAGE_SCRIPTS = 80;

const CLASSIC_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'text/ecmascript']);

function kindOf(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (CLASSIC_TYPES.has(normalized)) return 'classic';
  if (normalized === 'module') return 'module';
  if (normalized === 'importmap') return 'importmap';
  if (normalized === 'application/json' || normalized === 'application/ld+json') return 'json';
  return normalized;
}

/**
 * The page's scripts, in document order.
 *
 * External ones by their address only: the source is not fetched, because
 * nothing here makes a request. Inline ones carry their text, which is
 * already in the DOM.
 */
export function pageScripts(doc: Document): PageScript[] {
  const encoder = new TextEncoder();
  return Array.from(doc.querySelectorAll('script'))
    .slice(0, MAX_PAGE_SCRIPTS)
    .map((element) => {
      const src = element.getAttribute('src');
      const script: PageScript = {
        name: src ? fileName(src, element.baseURI || undefined) : 'inline',
        kind: kindOf(element.getAttribute('type') ?? ''),
        async: element.hasAttribute('async'),
        defer: element.hasAttribute('defer'),
      };
      if (src) {
        script.url = src;
      } else {
        const text = element.textContent ?? '';
        script.text = text.slice(0, MAX_INLINE_SOURCE);
        script.bytes = encoder.encode(text).length;
      }
      return script;
    });
}
