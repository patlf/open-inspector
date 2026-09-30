import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetUrlList, downloadAsset, safeFilename, saveViaAnchor, withExtension } from './download.js';

describe('safeFilename', () => {
  it('replaces characters a filesystem rejects, and whitespace', () => {
    expect(safeFilename('my file: v2?.png', 'x')).toBe('my-file--v2-.png');
  });

  it('falls back rather than inventing a name', () => {
    expect(safeFilename('///', 'asset')).toBe('asset');
  });

  it('caps the length', () => {
    expect(safeFilename('a'.repeat(300), 'x')).toHaveLength(120);
  });
});

describe('withExtension', () => {
  it('adds an extension only when there is none', () => {
    expect(withExtension('logo', 'svg')).toBe('logo.svg');
    expect(withExtension('logo.svg', 'svg')).toBe('logo.svg');
  });
});

describe('downloadAsset', () => {
  it('turns inline SVG markup into a data URI with an .svg name', () => {
    const save = vi.fn();
    downloadAsset({ url: '<svg xmlns="http://www.w3.org/2000/svg"/>', name: 'icon', kind: 'inline svg' }, save);

    const [href, filename] = save.mock.calls[0]!;
    expect(href).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
    expect(filename).toBe('icon.svg');
  });

  it('hands a URL asset straight to the saver', () => {
    const save = vi.fn();
    downloadAsset({ url: 'https://cdn.example/a.png', name: 'a.png', kind: 'image' }, save);
    expect(save).toHaveBeenCalledWith('https://cdn.example/a.png', 'a.png');
  });

  it('does nothing for an asset with no source', () => {
    const save = vi.fn();
    downloadAsset({ url: '', name: 'canvas 1', kind: 'canvas' }, save);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('saveViaAnchor', () => {
  afterEach(() => vi.restoreAllMocks());

  function captureClick(): { href: string; download: string; target: string }[] {
    const clicks: { href: string; download: string; target: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.getAttribute('href') ?? '', download: this.download, target: this.target });
    });
    return clicks;
  }

  it('saves data: URLs in place, with no new tab', () => {
    const clicks = captureClick();
    saveViaAnchor(document)('data:text/plain,hi', 'hi.txt');

    expect(clicks).toEqual([{ href: 'data:text/plain,hi', download: 'hi.txt', target: '' }]);
    // The temporary link does not outlive the click.
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('opens a cross-origin URL in a new tab rather than navigating the page away', () => {
    const clicks = captureClick();
    saveViaAnchor(document)('https://elsewhere.example/a.png', 'a.png');
    expect(clicks[0]?.target).toBe('_blank');
  });
});

describe('assetUrlList', () => {
  it('lists fetchable URLs only, one per line', () => {
    const list = assetUrlList([
      { url: 'https://a.example/1.png', name: '1', kind: 'image' },
      { url: '<svg/>', name: 's', kind: 'inline svg' },
      { url: 'data:image/png;base64,AA', name: 'd', kind: 'image' },
      { url: '', name: 'c', kind: 'canvas' },
      { url: 'https://a.example/2.woff2', name: '2', kind: 'font' },
    ]);
    expect(list).toBe('https://a.example/1.png\nhttps://a.example/2.woff2');
  });
});
