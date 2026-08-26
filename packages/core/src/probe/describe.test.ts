import { describe, expect, it } from 'vitest';
import { buildSelectorLabel, describeElement, formatDimensions } from './describe.js';

describe('buildSelectorLabel', () => {
  it('uses the bare tag when there is nothing else', () => {
    expect(buildSelectorLabel('div', null, [])).toBe('div');
  });

  it('includes id and classes', () => {
    expect(buildSelectorLabel('section', 'hero', ['card', 'is-active'])).toBe(
      'section#hero.card.is-active',
    );
  });

  it('truncates long class lists and counts the remainder', () => {
    // Utility-first CSS routinely puts a dozen classes on one element.
    const classes = ['flex', 'items-center', 'gap-4', 'rounded-lg', 'bg-white', 'p-6'];

    expect(buildSelectorLabel('div', null, classes)).toBe('div.flex.items-center.gap-4+3');
  });

  it('honours a custom truncation limit', () => {
    expect(buildSelectorLabel('div', null, ['a', 'b', 'c'], 1)).toBe('div.a+2');
  });

  it('shows only the count when the limit is zero', () => {
    expect(buildSelectorLabel('div', null, ['a', 'b'], 0)).toBe('div+2');
  });
});

describe('describeElement', () => {
  it('reads tag, id and classes off a real element', () => {
    const element = document.createElement('article');
    element.id = 'post-1';
    element.className = 'prose dark';

    const descriptor = describeElement(element);

    expect(descriptor.tagName).toBe('article');
    expect(descriptor.id).toBe('post-1');
    expect(descriptor.classNames).toEqual(['prose', 'dark']);
    expect(descriptor.selectorLabel).toBe('article#post-1.prose.dark');
  });

  it('reports a missing id as null rather than an empty string', () => {
    expect(describeElement(document.createElement('div')).id).toBeNull();
  });

  it('reads classes from an SVG element without blowing up', () => {
    // `className` on an SVGElement is an SVGAnimatedString, not a string.
    // Treating it as a string is a classic inspector crash; `classList` is
    // the safe route and this test pins that choice down.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    svg.setAttribute('class', 'icon accent');

    const descriptor = describeElement(svg);

    expect(descriptor.classNames).toEqual(['icon', 'accent']);
    expect(descriptor.selectorLabel).toBe('circle.icon.accent');
  });
});

describe('formatDimensions', () => {
  it('renders whole pixels plainly', () => {
    expect(formatDimensions(1200, 480)).toBe('1200 × 480');
  });

  it('rounds subpixel values to two decimals', () => {
    expect(formatDimensions(199.99999, 40.005)).toBe('200 × 40.01');
  });
});
