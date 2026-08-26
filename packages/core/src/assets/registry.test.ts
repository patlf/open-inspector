import { describe, expect, it } from 'vitest';
import { buildAssetUsage } from './reference.js';
import { countByKind, createAssetRegistry, emptyKindCounts } from './registry.js';
import type { AssetReference, AssetUsageVia, UrlAsset } from './types.js';

const BASE = 'https://example.com/blog/post/';

function reference(raw: string, via: AssetUsageVia = 'img-src', element = 'img'): AssetReference {
  return { raw, kindHint: 'image', mimeHint: null, usage: buildAssetUsage(via, element, 'src') };
}

function registry(overrides: Partial<Parameters<typeof createAssetRegistry>[0]> = {}) {
  return createAssetRegistry({
    baseUrl: BASE,
    maxAssets: 100,
    maxUsagesPerAsset: 10,
    maxDataUriBytes: 1024,
    ...overrides,
  });
}

describe('createAssetRegistry', () => {
  it('collapses the three ways one file gets written on one page', () => {
    const assets = registry();
    assets.add(reference('hero.png'));
    assets.add(reference('./hero.png'));
    assets.add(reference('/blog/post/hero.png'));

    const list = assets.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.url).toBe('https://example.com/blog/post/hero.png');
    expect(list[0]?.usageCount).toBe(3);
  });

  it('keeps assets that differ only by query string apart', () => {
    // Different query, different bytes as far as anyone can tell from here.
    const assets = registry();
    assets.add(reference('hero.png?w=200'));
    assets.add(reference('hero.png?w=400'));
    expect(assets.list()).toHaveLength(2);
  });

  it('records where each reference came from', () => {
    const assets = registry();
    assets.add(reference('logo.svg', 'img-src', 'img.brand'));
    assets.add(reference('logo.svg', 'css-background-image', 'div.header'));

    const usages = assets.list()[0]?.usages ?? [];
    expect(usages.map((usage) => usage.via)).toEqual(['img-src', 'css-background-image']);
  });

  it('stops retaining usages at the cap but keeps counting', () => {
    // One background image on every row of a long table must not produce ten
    // thousand near-identical records.
    const assets = registry({ maxUsagesPerAsset: 2 });
    for (let index = 0; index < 50; index += 1) assets.add(reference('bg.png'));

    const asset = assets.list()[0];
    expect(asset?.usageCount).toBe(50);
    expect(asset?.usages).toHaveLength(2);
    expect(asset?.usagesTruncated).toBe(true);
  });

  it('refuses new assets past the cap and says so', () => {
    const assets = registry({ maxAssets: 2 });
    expect(assets.add(reference('a.png')).status).toBe('added');
    expect(assets.add(reference('b.png')).status).toBe('added');
    expect(assets.add(reference('c.png')).status).toBe('over-budget');
    expect(assets.overflowed).toBe(true);
    expect(assets.list()).toHaveLength(2);
  });

  it('still merges into an existing asset once the cap is reached', () => {
    // The cap is on distinct assets, not on references; usage counts for the
    // assets already held must stay accurate.
    const assets = registry({ maxAssets: 1 });
    assets.add(reference('a.png'));
    assets.add(reference('b.png'));
    expect(assets.add(reference('a.png')).status).toBe('merged');
    expect(assets.list()[0]?.usageCount).toBe(2);
  });

  it('counts references it could not resolve instead of silently eating them', () => {
    const assets = registry();
    expect(assets.add(reference('#gradient')).status).toBe('skipped');
    expect(assets.add(reference('')).status).toBe('skipped');
    expect(assets.skipped).toBe(2);
    expect(assets.list()).toEqual([]);
  });

  it('measures a data URI and reports it as a distinct kind of asset', () => {
    const assets = registry();
    assets.add(reference('data:image/png;base64,aGVsbG8gd29ybGQ='));

    const asset = assets.list()[0] as UrlAsset;
    expect(asset.urlKind).toBe('data');
    expect(asset.byteSize).toEqual({ known: true, bytes: 11, basis: 'data-uri' });
    expect(asset.naming).toEqual({ filename: null, extension: 'png', source: 'mime' });
    expect(asset.truncatedUrl).toBe(false);
  });

  it('truncates an oversized data URI but still deduplicates on the full value', () => {
    const huge = `data:image/png;base64,${'A'.repeat(400)}`;
    const assets = registry({ maxDataUriBytes: 16 });
    assets.add(reference(huge));
    assets.add(reference(huge));

    const asset = assets.list()[0] as UrlAsset;
    expect(asset.truncatedUrl).toBe(true);
    expect(asset.url.length).toBeLessThan(huge.length);
    expect(asset.usageCount).toBe(2);
    // The size is still exact — it is derived from the payload, not the copy.
    expect(asset.byteSize).toEqual({ known: true, bytes: 300, basis: 'data-uri' });
  });

  it('reports every non-data asset as unsized, because sizing needs a request', () => {
    const assets = registry();
    assets.add(reference('hero.png'));
    expect(assets.list()[0]?.byteSize).toEqual({
      known: false,
      reason: 'requires-network-access',
    });
  });

  it('prefers a declared media type over the markup hint when classifying', () => {
    const assets = registry();
    assets.add({
      raw: 'clip',
      kindHint: 'image',
      mimeHint: 'video/mp4',
      usage: buildAssetUsage('picture-source', 'source', 'srcset'),
    });
    expect(assets.list()[0]?.kind).toBe('video');
  });

  it('sorts by usage, then by URL, so output is stable between runs', () => {
    const assets = registry();
    assets.add(reference('b.png'));
    assets.add(reference('a.png'));
    assets.add(reference('c.png'));
    assets.add(reference('c.png'));

    expect(assets.list().map((asset) => asset.naming.filename)).toEqual([
      'c.png',
      'a.png',
      'b.png',
    ]);
  });
});

describe('countByKind', () => {
  it('starts every kind at zero so the report has no holes', () => {
    expect(countByKind([])).toEqual(emptyKindCounts());
  });

  it('tallies by kind', () => {
    const assets = registry();
    assets.add(reference('a.png'));
    assets.add(reference('b.svg'));
    assets.add(reference('c.woff2'));

    expect(countByKind(assets.list())).toMatchObject({ image: 1, svg: 1, font: 1, video: 0 });
  });
});
