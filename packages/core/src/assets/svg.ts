import { buildAssetUsage, resolveReference } from './reference.js';
import type { AssetByteSize, AssetReference, InlineSvgAsset, SpriteUsage, SvgReference } from './types.js';
import { elementLabel } from './walk.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** What one inline `<svg>` contributed. */
export interface InlineSvgHarvest {
  svg: InlineSvgAsset;
  references: AssetReference[];
  sprites: SpriteUsage[];
}

/**
 * Serialize an inline `<svg>` into markup that stands on its own.
 *
 * `outerHTML` alone is not a file: markup parsed as HTML carries no `xmlns`,
 * so saving it as `.svg` produces a document every SVG renderer rejects. The
 * namespace is added here, on a *clone* — mutating the live page to make a
 * copy of it would be an inspector corrupting the thing it inspects.
 *
 * `xmlns:xlink` is added only when the markup actually uses the prefix. It is
 * deprecated, but sprite systems still emit `xlink:href`, and an undeclared
 * prefix is a hard parse error rather than a warning.
 */
export function serializeInlineSvg(svg: SVGSVGElement): string {
  let clone: SVGSVGElement;
  try {
    clone = svg.cloneNode(true) as SVGSVGElement;
  } catch {
    // A detached or exotically-implemented node may refuse to clone; the
    // unmodified markup is still better than nothing.
    return svg.outerHTML;
  }

  if (!clone.hasAttribute('xmlns')) {
    try {
      clone.setAttributeNS(XMLNS_NS, 'xmlns', SVG_NS);
    } catch {
      clone.setAttribute('xmlns', SVG_NS);
    }
  }

  const markup = clone.outerHTML;

  if (/\sxlink:/i.test(markup) && !/xmlns:xlink/i.test(markup)) {
    try {
      clone.setAttributeNS(XMLNS_NS, 'xmlns:xlink', XLINK_NS);
      return clone.outerHTML;
    } catch {
      // Some implementations reject namespaced attribute names outright.
      // Splicing the declaration into the opening tag is the fallback.
      return markup.replace(/^<svg/i, `<svg xmlns:xlink="${XLINK_NS}"`);
    }
  }

  return markup;
}

/** Read an `href`, falling back to the deprecated `xlink:href` sprite systems still emit. */
export function readHref(element: Element): string | null {
  const direct = element.getAttribute('href');
  if (direct !== null && direct.length > 0) return direct;

  const namespaced = element.getAttributeNS(XLINK_NS, 'href');
  if (namespaced !== null && namespaced.length > 0) return namespaced;

  const literal = element.getAttribute('xlink:href');
  return literal !== null && literal.length > 0 ? literal : null;
}

/**
 * Classify a reference target relative to the `<svg>` it was written in.
 *
 * The interesting outcome is `document`: a `url(#gradient)` whose definition
 * lives in a hidden `<svg>` elsewhere on the page. The icon looks perfect in
 * situ and renders blank the moment it is saved out, and nothing in the
 * element itself hints at that. Naming the scope is what lets the UI warn.
 */
export function classifyFragmentScope(
  target: string,
  ownerSvg: ParentNode | null,
): 'internal' | 'document' | 'external' {
  if (!target.startsWith('#')) return 'external';

  const id = target.slice(1);
  if (id.length === 0) return 'document';
  if (!ownerSvg) return 'document';

  try {
    // Attribute selector rather than `#id`: ids in the wild contain dots,
    // colons and leading digits, all of which make `#id` a syntax error.
    return ownerSvg.querySelector(`[id="${cssEscapeAttributeValue(id)}"]`) ? 'internal' : 'document';
  } catch {
    return 'document';
  }
}

function cssEscapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** Matches `url(#id)` in presentation attributes and inline styles. */
const CSS_FRAGMENT_REFERENCE = /url\(\s*['"]?(#[^)'"]+)['"]?\s*\)/gi;

/**
 * Harvest one inline `<svg>`.
 *
 * The serialized markup is the asset — there is no URL and no request to make,
 * which makes inline SVG the one asset class whose bytes this module can state
 * with certainty. Symbol ids and outbound references are reported alongside,
 * because they decide whether the markup is usable once it leaves the page.
 */
export function readInlineSvg(
  svg: SVGSVGElement,
  baseUrl: string,
  maxBytes: number,
): InlineSvgHarvest {
  const label = elementLabel(svg);
  const serialized = serializeInlineSvg(svg);
  const encodedLength = byteLength(serialized);
  const truncated = encodedLength > maxBytes;

  const symbolIds: string[] = [];
  for (const symbol of Array.from(svg.querySelectorAll('symbol'))) {
    if (symbol.id) symbolIds.push(symbol.id);
  }

  const references: AssetReference[] = [];
  const sprites: SpriteUsage[] = [];
  const externalReferences: SvgReference[] = [];

  for (const use of Array.from(svg.querySelectorAll('use'))) {
    const target = readHref(use);
    if (target === null) continue;

    const sprite = describeSpriteUsage(use, target, svg, baseUrl);
    sprites.push(sprite);
    if (sprite.scope !== 'internal') {
      externalReferences.push({ kind: 'use', target, scope: sprite.scope });
    }
    if (sprite.url !== null) {
      references.push({
        raw: target,
        kindHint: 'svg',
        mimeHint: 'image/svg+xml',
        usage: buildAssetUsage('svg-use', elementLabel(use), 'href', {
          context: sprite.fragmentId,
        }),
      });
    }
  }

  for (const image of Array.from(svg.querySelectorAll('image'))) {
    const target = readHref(image);
    if (target === null) continue;
    externalReferences.push({ kind: 'image', target, scope: 'external' });
    references.push({
      raw: target,
      kindHint: 'image',
      mimeHint: null,
      usage: buildAssetUsage('svg-image', elementLabel(image), 'href'),
    });
  }

  CSS_FRAGMENT_REFERENCE.lastIndex = 0;
  const seenFragments = new Set<string>();
  let match = CSS_FRAGMENT_REFERENCE.exec(serialized);
  while (match !== null) {
    const target = match[1] ?? '';
    if (target.length > 0 && !seenFragments.has(target)) {
      seenFragments.add(target);
      const scope = classifyFragmentScope(target, svg);
      if (scope !== 'internal') externalReferences.push({ kind: 'css-url', target, scope });
    }
    match = CSS_FRAGMENT_REFERENCE.exec(serialized);
  }

  const byteSize: AssetByteSize = { known: true, bytes: encodedLength, basis: 'inline-markup' };

  return {
    svg: {
      element: label,
      markup: truncated ? serialized.slice(0, maxBytes) : serialized,
      byteSize,
      width: svg.getAttribute('width'),
      height: svg.getAttribute('height'),
      viewBox: svg.getAttribute('viewBox'),
      symbolIds,
      externalReferences,
      truncated,
    },
    references,
    sprites,
  };
}

/**
 * Describe a `<use>` reference.
 *
 * Splits the href at the fragment so an external sprite (`/icons.svg#cart`)
 * yields both a downloadable file and the symbol id inside it — the pair a
 * consumer needs to actually reuse the icon.
 */
export function describeSpriteUsage(
  use: Element,
  target: string,
  ownerSvg: ParentNode | null,
  baseUrl: string,
): SpriteUsage {
  const hashIndex = target.indexOf('#');
  const fragmentId = hashIndex === -1 ? null : target.slice(hashIndex + 1) || null;
  const filePart = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const scope = classifyFragmentScope(target, ownerSvg);

  return {
    element: elementLabel(use),
    target,
    url: filePart.length > 0 ? resolveReference(filePart, baseUrl).url : null,
    fragmentId,
    scope,
  };
}

/** A standalone `<use>` — one outside any inline `<svg>` this module recorded. */
export function readUseElement(use: Element, baseUrl: string): {
  sprite: SpriteUsage;
  reference: AssetReference | null;
} {
  const target = readHref(use);
  if (target === null) {
    return {
      sprite: {
        element: elementLabel(use),
        target: '',
        url: null,
        fragmentId: null,
        scope: 'document',
      },
      reference: null,
    };
  }

  const sprite = describeSpriteUsage(use, target, nearestSvgRoot(use), baseUrl);
  return {
    sprite,
    reference:
      sprite.url === null
        ? null
        : {
            raw: target,
            kindHint: 'svg',
            mimeHint: 'image/svg+xml',
            usage: buildAssetUsage('svg-use', sprite.element, 'href', { context: sprite.fragmentId }),
          },
  };
}

/**
 * Nearest enclosing `<svg>`, which is the scope a `#fragment` resolves in.
 *
 * `closest` rather than `ownerSVGElement`, because the latter is only defined
 * on `SVGElement` and this is called with whatever the DOM walk handed over.
 */
export function nearestSvgRoot(element: Element): ParentNode | null {
  try {
    return element.closest('svg');
  } catch {
    return null;
  }
}

/** UTF-8 byte length, which is what a saved file would actually occupy. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
