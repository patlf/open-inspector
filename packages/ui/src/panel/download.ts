/**
 * Saving an asset to disk.
 *
 * The extension never fetches anything — that would break the promise the
 * whole project rests on. Instead it hands the browser a link and lets the
 * browser do what browsers do when a person asks for a file. Two consequences
 * follow, and both are stated rather than hidden:
 *
 * - **Inline SVG and `data:` URIs are free.** The bytes are already in the
 *   page, so they save with no request at all.
 * - **A remote URL costs one request, made by the browser, from its cache
 *   where possible.** It is the same URL the page already loaded. Nothing
 *   about the user goes anywhere, and no request happens until the download
 *   button is pressed.
 *
 * How the click is delivered matters more than it should. Chrome drops
 * downloads started from a content script's isolated world: the anchor is
 * clicked, no error is raised, and nothing happens. The extension therefore
 * supplies its own saver, which runs the same few lines in the page's main
 * world through the `scripting` permission it already holds. Everywhere else —
 * the playground, tests — the direct DOM path below works unchanged.
 */

/** Strip characters a filesystem will not accept, without inventing a name. */
export function safeFilename(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

  return cleaned || fallback;
}

/** Give a filename the right extension when it has none. */
export function withExtension(name: string, extension: string): string {
  return /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.${extension}`;
}

/**
 * Can `download` be honoured, or will the browser navigate instead?
 *
 * `blob:` and `data:` are ours and always save. A remote URL only saves when
 * it is same-origin or CORS-enabled; otherwise the attribute is ignored.
 */
function willSaveDirectly(href: string, doc: Document): boolean {
  if (href.startsWith('blob:') || href.startsWith('data:')) return true;

  try {
    return new URL(href, doc.baseURI).origin === doc.location.origin;
  } catch {
    return false;
  }
}

function clickLink(href: string, filename: string, doc: Document): void {
  const link = doc.createElement('a');
  link.href = href;
  link.download = filename;

  /**
   * `target="_blank"` is a fallback, not a default.
   *
   * When the browser *will* honour `download`, adding a target makes it open a
   * tab instead of saving — which silently breaks the case that works best.
   * It is only useful for cross-origin URLs, where `download` is ignored and
   * the alternative is navigating the page under inspection away from itself.
   */
  if (!willSaveDirectly(href, doc)) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  link.style.display = 'none';
  doc.body.appendChild(link);
  link.click();
  link.remove();
}

export interface DownloadTarget {
  /** For inline SVG this is the markup; otherwise a URL. */
  url: string;
  name: string;
  kind: string;
}

/**
 * Hands a URL and a filename to whatever can actually start a download.
 *
 * Injected because the answer differs by context: a page can click an anchor,
 * a content script cannot.
 */
export type Saver = (href: string, filename: string) => void;

/** The direct route. Correct anywhere that is not a content script. */
export function saveViaAnchor(doc: Document = document): Saver {
  return (href, filename) => clickLink(href, filename, doc);
}

/**
 * Save one asset.
 *
 * Inline SVG becomes a data URI because its "url" is really markup — there is
 * nothing to link to, and the text in hand is already a complete file.
 */
export function downloadAsset(
  asset: DownloadTarget,
  save: Saver = saveViaAnchor(),
): void {
  if (!asset.url) return;

  if (asset.kind === 'inline svg') {
    /**
     * A `data:` URI, not a blob.
     *
     * `URL.createObjectURL` inside a content script registers the blob against
     * the extension's origin rather than the page's, and the resulting
     * download is dropped without an error — the click simply does nothing. A
     * data URI carries its bytes inline and belongs to nobody, so it saves.
     * The collector already caps inline SVG at 256 KB, so length is not a
     * concern here.
     */
    const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.url)}`;
    save(href, withExtension(safeFilename(asset.name, 'inline'), 'svg'));
    return;
  }

  save(asset.url, safeFilename(asset.name, 'asset'));
}

/**
 * Every asset URL, one per line.
 *
 * The honest substitute for a bulk download: fetching each file to build a zip
 * is exactly the network access this tool refuses, so it hands over the list
 * and lets `curl`, `wget` or a download manager do the fetching.
 */
export function assetUrlList(assets: readonly DownloadTarget[]): string {
  return assets
    .filter((asset) => asset.url && asset.kind !== 'inline svg' && !asset.url.startsWith('data:'))
    .map((asset) => asset.url)
    .join('\n');
}
