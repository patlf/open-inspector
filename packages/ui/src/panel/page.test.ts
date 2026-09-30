import { assets } from '@open-inspector/core';
import { afterEach, describe, expect, it } from 'vitest';
import { collectLoadedUrls, toAssets } from './page.js';

/**
 * The thumbnail policy is a privacy boundary, not a presentation detail: an
 * `<img src>` for a URL the page never fetched is a network request the
 * extension made. These pin down which URLs may be rendered.
 */
describe('asset thumbnails', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  function inventory(): assets.AssetInventory {
    return assets.collectAssets({ document, view: window });
  }

  function byUrl(entries: ReturnType<typeof toAssets>, fragment: string) {
    const entry = entries.find((candidate) => candidate.url.includes(fragment));
    if (!entry) throw new Error(`no asset matching ${fragment}`);
    return entry;
  }

  it('does not preview a referenced-but-unloaded URL', () => {
    document.head.innerHTML = '<meta property="og:image" content="https://cdn.example/share.png">';
    const entry = byUrl(toAssets(inventory(), new Set()), 'share.png');

    expect(entry.preview).toBeUndefined();
    expect(entry.noPreview).toBe('not loaded by the page');
  });

  it('previews a URL the page already fetched', () => {
    document.head.innerHTML = '<meta property="og:image" content="https://cdn.example/share.png">';
    const entry = byUrl(toAssets(inventory(), new Set(['https://cdn.example/share.png'])), 'share.png');

    expect(entry.preview).toBe('https://cdn.example/share.png');
  });

  it('always previews data: URLs, which never reach a network', () => {
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    document.body.innerHTML = `<img src="${pixel}" alt="">`;
    const entry = byUrl(toAssets(inventory(), new Set()), 'data:image/png');

    expect(entry.preview).toBe(pixel);
  });

  it('reads loaded URLs from Resource Timing', () => {
    const fake = {
      performance: { getEntriesByType: () => [{ name: 'https://cdn.example/a.png' }] },
    } as unknown as Window;

    expect(collectLoadedUrls(document, fake).has('https://cdn.example/a.png')).toBe(true);
  });

  it('does not count a prefetch or a failed fetch as loaded', () => {
    document.head.innerHTML = '<link rel="prefetch" href="https://cdn.example/next.png">';
    const fake = {
      performance: {
        getEntriesByType: () => [
          { name: 'https://cdn.example/next.png' },
          { name: 'https://cdn.example/missing.png', responseStatus: 404 },
          { name: 'https://cdn.example/ok.png', responseStatus: 200 },
        ],
      },
    } as unknown as Window;

    expect([...collectLoadedUrls(document, fake)]).toEqual(['https://cdn.example/ok.png']);
  });

  it('survives a window with no Resource Timing', () => {
    const broken = {
      performance: {
        getEntriesByType: () => {
          throw new Error('unsupported');
        },
      },
    } as unknown as Window;

    expect(collectLoadedUrls(document, broken).size).toBe(0);
  });
});
