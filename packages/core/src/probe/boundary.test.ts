import { describe, expect, it } from 'vitest';
import { detectBoundary } from './boundary.js';

interface FakeElementInit {
  tagName: string;
  shadowRoot?: ShadowRoot | null;
  childElementCount?: number;
  textContent?: string | null;
  contentDocument?: unknown;
  throwOnContentDocument?: boolean;
}

/**
 * Hand-built stand-ins rather than real elements: cross-origin frame access
 * cannot be simulated in a test DOM, and the branch that matters is precisely
 * the one that throws.
 */
function fakeElement(init: FakeElementInit): Element {
  const base: Record<string, unknown> = {
    tagName: init.tagName,
    shadowRoot: init.shadowRoot ?? null,
    childElementCount: init.childElementCount ?? 0,
    textContent: init.textContent ?? '',
  };

  if (init.throwOnContentDocument) {
    Object.defineProperty(base, 'contentDocument', {
      get() {
        throw new DOMException('Blocked a frame from accessing a cross-origin frame.');
      },
    });
  } else if ('contentDocument' in init) {
    base['contentDocument'] = init.contentDocument;
  }

  return base as unknown as Element;
}

describe('detectBoundary', () => {
  it('returns null for an ordinary element', () => {
    expect(detectBoundary(fakeElement({ tagName: 'DIV' }))).toBeNull();
  });

  it('flags canvas as having no inspectable interior', () => {
    expect(detectBoundary(fakeElement({ tagName: 'CANVAS' }))).toEqual({ kind: 'canvas' });
  });

  it('flags a same-origin iframe as reachable', () => {
    const element = fakeElement({ tagName: 'IFRAME', contentDocument: {} });

    expect(detectBoundary(element)).toEqual({ kind: 'iframe', sameOrigin: true });
  });

  it('flags a cross-origin iframe as unreachable when access throws', () => {
    const element = fakeElement({ tagName: 'IFRAME', throwOnContentDocument: true });

    expect(detectBoundary(element)).toEqual({ kind: 'iframe', sameOrigin: false });
  });

  it('flags a cross-origin iframe as unreachable when access yields null', () => {
    // Browsers disagree on whether this throws or returns null; both mean the
    // same thing to us.
    const element = fakeElement({ tagName: 'IFRAME', contentDocument: null });

    expect(detectBoundary(element)).toEqual({ kind: 'iframe', sameOrigin: false });
  });

  it('flags an empty custom element as probably hiding a closed shadow root', () => {
    const element = fakeElement({ tagName: 'MY-WIDGET' });

    expect(detectBoundary(element)).toEqual({ kind: 'opaque-custom-element' });
  });

  it('does not flag a custom element with light-DOM children', () => {
    const element = fakeElement({ tagName: 'MY-WIDGET', childElementCount: 2 });

    expect(detectBoundary(element)).toBeNull();
  });

  it('does not flag a custom element with its own text', () => {
    const element = fakeElement({ tagName: 'MY-WIDGET', textContent: 'Buy now' });

    expect(detectBoundary(element)).toBeNull();
  });

  it('does not flag a custom element with a reachable open shadow root', () => {
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const element = fakeElement({ tagName: 'MY-WIDGET', shadowRoot });

    expect(detectBoundary(element)).toBeNull();
  });

  it('treats whitespace-only text as empty', () => {
    const element = fakeElement({ tagName: 'MY-WIDGET', textContent: '\n   \t ' });

    expect(detectBoundary(element)).toEqual({ kind: 'opaque-custom-element' });
  });
});
