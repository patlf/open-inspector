import type { AssetKind, AssetReference, UnresolvableReason, UrlAsset } from './types.js';
import { classifyAsset, describeByteSize, guessAssetName, measureDataUri, resolveAssetUrl } from './url.js';

/** How a reference was absorbed, so the caller can keep honest tallies. */
export type AddAssetOutcome =
  | { status: 'added'; asset: UrlAsset }
  | { status: 'merged'; asset: UrlAsset }
  | { status: 'skipped'; reason: UnresolvableReason }
  | { status: 'over-budget' };

export interface AssetRegistryOptions {
  /** Base for resolving relative references. */
  baseUrl: string;
  /** Distinct assets to retain before new ones are refused. */
  maxAssets: number;
  /** Reference sites retained per asset; `usageCount` keeps climbing past this. */
  maxUsagesPerAsset: number;
  /** Longest `data:` URI copied into the report verbatim. */
  maxDataUriBytes: number;
}

export interface AssetRegistry {
  add(reference: AssetReference): AddAssetOutcome;
  /** Deduplicated assets, most-referenced first, then alphabetical for stability. */
  list(): UrlAsset[];
  /** Distinct assets held. */
  readonly size: number;
  /** References that never became assets. */
  readonly skipped: number;
  /** True once the asset cap refused at least one otherwise-valid reference. */
  readonly overflowed: boolean;
}

/**
 * Collect references into deduplicated assets.
 *
 * Deduplication is by *resolved* URL, which is the only key that holds up:
 * the same file is routinely written as `logo.png`, `./logo.png` and
 * `/assets/logo.png` on one page, and reporting three assets for one file is
 * the failure mode that makes a harvest list useless.
 *
 * Two caps live here rather than in the caller. The asset cap stops a page
 * that generates URLs procedurally from growing the report without bound. The
 * per-asset usage cap stops a single background image referenced by every row
 * of a ten-thousand-row table from retaining ten thousand near-identical
 * records — the count still rises, only the detail is dropped, and
 * `usagesTruncated` says so.
 *
 * Kept free of the DOM so the deduplication and budget rules can be tested
 * with hand-built references.
 */
export function createAssetRegistry(options: AssetRegistryOptions): AssetRegistry {
  const assets = new Map<string, UrlAsset>();
  let skipped = 0;
  let overflowed = false;

  return {
    add(reference: AssetReference): AddAssetOutcome {
      const resolved = resolveAssetUrl(reference.raw, options.baseUrl);

      if (resolved.kind === 'unresolvable') {
        skipped += 1;
        return { status: 'skipped', reason: resolved.reason };
      }

      // The full value is always the identity, even when it is too large to
      // keep: two copies of the same 4 MB inline image must still collapse
      // into one asset with a usage count of two.
      const key = resolved.url;
      const existing = assets.get(key);

      if (existing) {
        existing.usageCount += 1;
        if (existing.usages.length < options.maxUsagesPerAsset) existing.usages.push(reference.usage);
        else existing.usagesTruncated = true;
        return { status: 'merged', asset: existing };
      }

      if (assets.size >= options.maxAssets) {
        overflowed = true;
        return { status: 'over-budget' };
      }

      const dataUri = resolved.kind === 'data' ? measureDataUri(resolved.url) : null;
      const mimeType = dataUri?.mimeType ?? reference.mimeHint ?? null;
      const naming = guessAssetName(resolved, mimeType);
      const oversizedData = dataUri !== null && dataUri.bytes > options.maxDataUriBytes;

      const asset: UrlAsset = {
        url: oversizedData ? truncateDataUri(resolved.url) : resolved.url,
        urlKind: resolved.kind,
        protocol: resolved.kind === 'absolute' ? resolved.protocol : null,
        kind: classifyAsset({
          extension: naming.extension,
          mimeType,
          hint: reference.kindHint,
        }),
        naming,
        byteSize: describeByteSize(resolved, dataUri),
        mimeType,
        dataUri,
        truncatedUrl: oversizedData,
        usageCount: 1,
        usages: options.maxUsagesPerAsset > 0 ? [reference.usage] : [],
        usagesTruncated: options.maxUsagesPerAsset <= 0,
      };

      assets.set(key, asset);
      return { status: 'added', asset };
    },

    list(): UrlAsset[] {
      return [...assets.values()].sort(compareAssets);
    },

    get size(): number {
      return assets.size;
    },

    get skipped(): number {
      return skipped;
    },

    get overflowed(): boolean {
      return overflowed;
    },
  };
}

/** Prefix length kept from an oversized `data:` URI: enough to show what it is. */
const DATA_URI_PREVIEW = 64;

function truncateDataUri(url: string): string {
  return `${url.slice(0, DATA_URI_PREVIEW)}…`;
}

/** Most-used first; ties broken by URL so output is stable between runs. */
function compareAssets(a: UrlAsset, b: UrlAsset): number {
  if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
  return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
}

/** Zeroed per-kind tally, so every kind appears in the report even at zero. */
export function emptyKindCounts(): Record<AssetKind, number> {
  return { image: 0, svg: 0, video: 0, audio: 0, font: 0, lottie: 0, unknown: 0 };
}

/** Tally assets by kind. */
export function countByKind(assets: readonly UrlAsset[]): Record<AssetKind, number> {
  const counts = emptyKindCounts();
  for (const asset of assets) counts[asset.kind] += 1;
  return counts;
}
