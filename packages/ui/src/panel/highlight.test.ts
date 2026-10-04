import { afterEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { Highlighted, type CodeLanguage } from './highlight.jsx';

afterEach(() => {
  document.body.innerHTML = '';
});

function show(text: string, language?: CodeLanguage): HTMLElement {
  const pre = document.createElement('pre');
  document.body.appendChild(pre);
  render(h(Highlighted, { text, language }), pre);
  return pre;
}

describe('Highlighted', () => {
  it('wraps tokens in spans and keeps the text exactly as it was', () => {
    const text = '<a href="/x">y</a>';
    const pre = show(text, 'markup');
    expect(pre.textContent).toBe(text);
    expect(pre.querySelector('.tok-attr-name')?.textContent).toBe('href');
    expect(pre.querySelector('.tok-attr-value')?.textContent).toBe('="/x"');
  });

  it('renders markup in the code as text, never as elements', () => {
    const pre = show('const html = "<img src=x onerror=alert(1)>";', 'javascript');
    expect(pre.querySelector('img')).toBeNull();
    expect(pre.querySelector('.tok-string')?.textContent).toContain('<img');
  });

  it('leaves code plain without a language', () => {
    const pre = show('--space-1: 4px;');
    expect(pre.querySelector('span')).toBeNull();
    expect(pre.textContent).toBe('--space-1: 4px;');
  });

  it('keeps Prism from highlighting anything in the document on its own', async () => {
    const page = document.createElement('code');
    page.className = 'language-css';
    page.textContent = 'a { color: red }';
    document.body.appendChild(page);
    show('a {}', 'css');
    // Its automatic pass would come on the next frame; give it a few.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((window as unknown as { Prism: { manual: boolean } }).Prism.manual).toBe(true);
    expect(page.querySelector('span')).toBeNull();
  });
});
