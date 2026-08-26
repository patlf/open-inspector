import type { AssetUsage, AssetUsageVia } from './types.js';
import { resolveAssetUrl } from './url.js';

/** Optional detail on a usage record; absent fields become explicit nulls. */
export interface UsageDetail {
  /** `srcset` or `image-set()` descriptor, e.g. `2x`. */
  descriptor?: string | null;
  /** `<source media>`, a pseudo-element, or the stylesheet a rule came from. */
  context?: string | null;
  /** Only ever true when the browser confirmed this variant is in use. */
  chosen?: boolean;
}

/**
 * Build a usage record with every field present.
 *
 * The output of this module is rendered as a table and sorted by column, so a
 * uniform shape matters more than a compact one — hence explicit nulls rather
 * than absent keys, which also sidesteps the assignability trap around
 * optional properties.
 */
export function buildAssetUsage(
  via: AssetUsageVia,
  element: string | null,
  property: string | null,
  detail: UsageDetail = {},
): AssetUsage {
  return {
    via,
    element,
    property,
    descriptor: detail.descriptor ?? null,
    context: detail.context ?? null,
    chosen: detail.chosen ?? false,
  };
}

/**
 * Resolve a reference but keep the raw value when resolution fails.
 *
 * A broken `src` is still worth showing to a human exactly as it was authored
 * — that string is the bug they are looking for. `resolved` marks which of the
 * two the caller is holding, so nothing downstream mistakes a raw value for an
 * absolute URL.
 */
export function resolveReference(raw: string, baseUrl: string): { url: string; resolved: boolean } {
  const resolved = resolveAssetUrl(raw, baseUrl);
  return resolved.kind === 'unresolvable'
    ? { url: resolved.raw, resolved: false }
    : { url: resolved.url, resolved: true };
}
