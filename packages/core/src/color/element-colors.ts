import { parsePx } from '../geometry/rect.js';
import type { ParseColorOptions, Rgba } from './parse.js';
import { compositeOver, isOpaque, parseColor, withAlpha } from './parse.js';

/** Which kind of declaration a colour was found in. */
export type ColorSource = 'text' | 'background' | 'border' | 'outline' | 'shadow' | 'gradient';

/** One colour, with enough provenance for the UI to explain where it came from. */
export interface ColorUsage {
  color: Rgba;
  /** The CSS property it came from, e.g. `border-top-color`. */
  property: string;
  source: ColorSource;
  /** The exact substring that produced it, so the UI can show what the page wrote. */
  raw: string;
}

/** Per-side border colours. `null` means that side paints nothing. */
export interface EdgeColors {
  top: Rgba | null;
  right: Rgba | null;
  bottom: Rgba | null;
  left: Rgba | null;
}

/** Every colour in play on a single element. */
export interface ElementColors {
  /** Computed `color`. Present even when the element renders no text of its own. */
  text: Rgba | null;
  /** Computed `background-color`. Usually transparent — that is a value, not a failure. */
  background: Rgba | null;
  /** Border colour per side, `null` where the border has no width or style. */
  border: EdgeColors;
  /** Outline colour, `null` when no outline is painted. */
  outline: Rgba | null;
  /** Colours of each `box-shadow` layer, in declaration order. */
  shadows: Rgba[];
  /** Colour stops found in `background-image` gradients. */
  gradientStops: Rgba[];
  /** All of the above flattened, with provenance, for palette counting. */
  usages: ColorUsage[];
  /** Colour-shaped strings we declined to guess at, e.g. `lab(…)`. */
  unreadable: string[];
}

/** A colour found inside a longhand value, with the text that produced it. */
export interface ColorToken {
  color: Rgba;
  raw: string;
}

/** The outcome of scanning a value for colours. */
export interface ColorScan {
  tokens: ColorToken[];
  /** Colour-shaped substrings that could not be parsed. Counted, never guessed. */
  unreadable: string[];
}

/**
 * Functions whose whole call is one colour.
 *
 * `lab` and `lch` are listed even though the parser refuses them: consuming the
 * call keeps the scanner from wandering into its arguments and mistaking a
 * number for something else, and it lets the refusal be *reported* instead of
 * silently skipped.
 */
const COLOR_FUNCTIONS = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
]);

/**
 * Functions whose contents must never be read as colours.
 *
 * `url()` is the trap this exists for: `url(/img/tan-hero.png)` contains the
 * named colour `tan`, and a scanner that walks into the parentheses will
 * cheerfully add a sandy brown to the palette of a page that has none.
 */
const OPAQUE_FUNCTIONS = new Set(['url', 'var', 'attr', 'image-set', '-webkit-image-set']);

function isHexDigit(char: string): boolean {
  return /[0-9a-f]/i.test(char);
}

function isIdentStart(char: string): boolean {
  return /[a-z-]/i.test(char);
}

function isIdentChar(char: string): boolean {
  return /[a-z0-9_-]/i.test(char);
}

function consumeWhile(text: string, start: number, predicate: (char: string) => boolean): number {
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === undefined || !predicate(char)) break;
    index += 1;
  }
  return index;
}

/**
 * Index just past the `)` matching the `(` at `openIndex`.
 *
 * Quoted sections are skipped whole, because `url("logo(1).png")` would
 * otherwise close the call early and leave the scanner parsing filename
 * fragments as CSS. Unbalanced input returns the end of the string rather than
 * throwing — malformed CSS is common and must not take the inspector down.
 */
function skipBalanced(text: string, openIndex: number): number {
  let depth = 0;

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"' || char === "'") {
      const close = text.indexOf(char, index + 1);
      if (close < 0) return text.length;
      index = close;
      continue;
    }

    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  return text.length;
}

/**
 * Find every colour in an arbitrary CSS value.
 *
 * One scanner serves `box-shadow`, gradient stops and shorthands alike, because
 * splitting each of those by hand means three sets of bugs. Unrecognized
 * functions are stepped *into* rather than over — that is what makes gradient
 * stops fall out of `linear-gradient(…)` for free — while `url()` and friends
 * are stepped over entirely.
 */
export function scanColors(text: string, options: ParseColorOptions = {}): ColorScan {
  const tokens: ColorToken[] = [];
  const unreadable: string[] = [];

  const take = (raw: string): void => {
    const color = parseColor(raw, options);
    if (color) tokens.push({ color, raw });
    else unreadable.push(raw);
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === undefined) break;

    if (char === '#') {
      const end = consumeWhile(text, index + 1, isHexDigit);
      if (end > index + 1) take(text.slice(index, end));
      index = Math.max(end, index + 1);
      continue;
    }

    if (isIdentStart(char)) {
      const identEnd = consumeWhile(text, index, isIdentChar);
      const ident = text.slice(index, identEnd).toLowerCase();
      const afterSpace = consumeWhile(text, identEnd, (candidate) => /\s/.test(candidate));

      if (text[afterSpace] === '(') {
        const close = skipBalanced(text, afterSpace);

        if (COLOR_FUNCTIONS.has(ident)) {
          take(text.slice(index, close));
          index = close;
          continue;
        }

        if (OPAQUE_FUNCTIONS.has(ident)) {
          index = close;
          continue;
        }

        // A gradient, `color-mix()`, a filter — keep scanning inside it.
        index = afterSpace + 1;
        continue;
      }

      // A bare word. Only take it when it really names a colour; `to`, `right`
      // and `inset` are keywords that share the same shape.
      const color = parseColor(ident, options);
      if (color) tokens.push({ color, raw: ident });
      index = identEnd;
      continue;
    }

    index += 1;
  }

  return { tokens, unreadable };
}

interface SideAccessors {
  side: keyof EdgeColors;
  property: string;
  color: (style: CSSStyleDeclaration) => string;
  width: (style: CSSStyleDeclaration) => string;
  style: (style: CSSStyleDeclaration) => string;
}

/**
 * Border longhands, spelled out rather than composed from a side name.
 *
 * `style.getPropertyValue('border-top-color')` would be tidier, but tests build
 * style objects as plain casts and only camelCase properties exist on those.
 */
const BORDER_SIDES: SideAccessors[] = [
  {
    side: 'top',
    property: 'border-top-color',
    color: (style) => style.borderTopColor,
    width: (style) => style.borderTopWidth,
    style: (style) => style.borderTopStyle,
  },
  {
    side: 'right',
    property: 'border-right-color',
    color: (style) => style.borderRightColor,
    width: (style) => style.borderRightWidth,
    style: (style) => style.borderRightStyle,
  },
  {
    side: 'bottom',
    property: 'border-bottom-color',
    color: (style) => style.borderBottomColor,
    width: (style) => style.borderBottomWidth,
    style: (style) => style.borderBottomStyle,
  },
  {
    side: 'left',
    property: 'border-left-color',
    color: (style) => style.borderLeftColor,
    width: (style) => style.borderLeftWidth,
    style: (style) => style.borderLeftStyle,
  },
];

/** A border/outline only paints when it has both a width and a style. */
function paintsStroke(width: string, style: string): boolean {
  if (style === 'none' || style === 'hidden' || style === '') return false;
  return parsePx(width) > 0;
}

/**
 * Read every colour on one element from its computed style.
 *
 * Pure so it can be tested against hand-built style objects — no DOM
 * implementation outside a real browser resolves the cascade faithfully.
 *
 * Two filters here matter more than they look. Border and outline colours are
 * skipped unless that edge actually paints: every element has a computed
 * `border-top-color` (it defaults to `currentColor`), so counting them blindly
 * buries the palette under four extra copies of the text colour per element.
 * And once `color` is known it is passed down as `currentColor` for the rest,
 * which is what makes `box-shadow: currentColor 0 1px` readable in the engines
 * that leave the keyword unresolved.
 */
export function collectElementColors(
  style: CSSStyleDeclaration,
  options: ParseColorOptions = {},
): ElementColors {
  const usages: ColorUsage[] = [];
  const unreadable: string[] = [];

  const add = (color: Rgba, property: string, source: ColorSource, raw: string): void => {
    usages.push({ color, property, source, raw });
  };

  const textRaw = style.color ?? '';
  const text = parseColor(textRaw, options);
  if (text) add(text, 'color', 'text', textRaw);
  else if (textRaw !== '') unreadable.push(textRaw);

  const nested: ParseColorOptions = text ? { currentColor: text } : options;

  const backgroundRaw = style.backgroundColor ?? '';
  const background = parseColor(backgroundRaw, nested);
  if (background) add(background, 'background-color', 'background', backgroundRaw);
  else if (backgroundRaw !== '') unreadable.push(backgroundRaw);

  const border: EdgeColors = { top: null, right: null, bottom: null, left: null };
  for (const side of BORDER_SIDES) {
    if (!paintsStroke(side.width(style) ?? '', side.style(style) ?? '')) continue;

    const raw = side.color(style) ?? '';
    const color = parseColor(raw, nested);
    if (!color) {
      if (raw !== '') unreadable.push(raw);
      continue;
    }

    border[side.side] = color;
    add(color, side.property, 'border', raw);
  }

  let outline: Rgba | null = null;
  if (paintsStroke(style.outlineWidth ?? '', style.outlineStyle ?? '')) {
    const raw = style.outlineColor ?? '';
    // `outline-color: auto` is the platform focus ring; its colour is decided
    // by the compositor and is not readable from CSS.
    const color = parseColor(raw, nested);
    if (color) {
      outline = color;
      add(color, 'outline-color', 'outline', raw);
    } else if (raw !== '' && raw !== 'auto') {
      unreadable.push(raw);
    }
  }

  const shadowScan = scanColors(style.boxShadow ?? '', nested);
  const shadows = shadowScan.tokens.map((token) => token.color);
  for (const token of shadowScan.tokens) add(token.color, 'box-shadow', 'shadow', token.raw);
  unreadable.push(...shadowScan.unreadable);

  const gradientScan = scanColors(style.backgroundImage ?? '', nested);
  const gradientStops = gradientScan.tokens.map((token) => token.color);
  for (const token of gradientScan.tokens) {
    add(token.color, 'background-image', 'gradient', token.raw);
  }
  unreadable.push(...gradientScan.unreadable);

  return { text, background, border, outline, shadows, gradientStops, usages, unreadable };
}

/** Read the colours on a live element. */
export function readElementColors(element: Element, view: Window = window): ElementColors {
  return collectElementColors(view.getComputedStyle(element));
}

/**
 * True when an element renders text of its own.
 *
 * Every element inherits a `color`, so a palette that counts all of them
 * reports the body text colour thousands of times. Form controls are treated as
 * text-bearing even with no text children: their value is painted by the widget,
 * not by a child node.
 */
export function hasDirectText(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType !== 3) continue;
    if ((node.textContent ?? '').trim().length > 0) return true;
  }

  return false;
}

/** What paints over an element's background colour. */
export type BackdropPaint = 'none' | 'gradient' | 'image';

/** Why an effective background could not be determined. */
export type BackdropUncertainty =
  | 'gradient'
  | 'image'
  | 'blend'
  | 'unreadable'
  | 'depth-limit';

/** One ancestor's contribution to the backdrop, reduced to plain data. */
export interface BackdropStep {
  /** Parsed `background-color`; `null` when the declaration could not be read. */
  color: Rgba | null;
  paint: BackdropPaint;
  /** Computed `opacity`, 0-1. */
  opacity: number;
  /** `mix-blend-mode`, `filter` or `backdrop-filter` is in play. */
  blended: boolean;
}

/** The result of compositing a chain of backdrop steps. */
export type BackdropResolution =
  | {
      kind: 'resolved';
      /** Opaque composite of every contributing layer. */
      color: Rgba;
      /** How many steps contributed. */
      depth: number;
      /** The chain ran out while still translucent and the canvas colour was assumed. */
      assumedCanvas: boolean;
    }
  | {
      kind: 'indeterminate';
      reason: BackdropUncertainty;
      /** Index of the step that blocked resolution. */
      depth: number;
      /** Composite of the layers read before the block; still translucent. */
      partial: Rgba | null;
    };

/** Options for compositing a backdrop chain. */
export interface BackdropOptions {
  /**
   * Colour of the browser canvas behind the root element. Defaults to opaque
   * white, matching a default Chrome window; a dark `color-scheme` page needs
   * this passed explicitly, since the real canvas colour is a UA decision that
   * is not readable from the DOM.
   */
  canvasColor?: Rgba;
  /** The chain was cut short by a depth limit, so falling off its end proves nothing. */
  chainTruncated?: boolean;
}

const DEFAULT_CANVAS_COLOR: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/**
 * Composite a chain of ancestors, nearest first, into one opaque colour.
 *
 * Pure, so every awkward case can be tested without a layout engine. The walk
 * stops the moment the accumulated colour goes opaque — an ancestor behind an
 * opaque layer is invisible, so a gradient up there is not a problem and must
 * not be reported as one.
 *
 * Anything that genuinely cannot be composited — a gradient or image showing
 * through, a blend mode, a colour we refused to guess at — ends the walk as
 * `indeterminate`. Returning a plausible colour there is how contrast checkers
 * end up confidently declaring an unreadable page accessible.
 */
export function compositeBackdrop(
  steps: readonly BackdropStep[],
  options: BackdropOptions = {},
): BackdropResolution {
  const canvasColor = options.canvasColor ?? DEFAULT_CANVAS_COLOR;
  let accumulated: Rgba | null = null;

  for (const [index, step] of steps.entries()) {
    if (step.blended) {
      return { kind: 'indeterminate', reason: 'blend', depth: index, partial: accumulated };
    }

    if (step.paint !== 'none') {
      return { kind: 'indeterminate', reason: step.paint, depth: index, partial: accumulated };
    }

    if (!step.color) {
      return { kind: 'indeterminate', reason: 'unreadable', depth: index, partial: accumulated };
    }

    const opacity = Number.isFinite(step.opacity) ? Math.min(Math.max(step.opacity, 0), 1) : 1;
    const layer = opacity < 1 ? withAlpha(step.color, step.color.a * opacity) : step.color;
    accumulated = accumulated === null ? layer : compositeOver(accumulated, layer);

    if (isOpaque(accumulated)) {
      return { kind: 'resolved', color: accumulated, depth: index + 1, assumedCanvas: false };
    }
  }

  if (options.chainTruncated) {
    return {
      kind: 'indeterminate',
      reason: 'depth-limit',
      depth: steps.length,
      partial: accumulated,
    };
  }

  const color = accumulated === null ? canvasColor : compositeOver(accumulated, canvasColor);
  return { kind: 'resolved', color, depth: steps.length, assumedCanvas: true };
}

/**
 * Reduce a computed style to the four facts the backdrop walk needs.
 *
 * `filter` counts as blending even though most filters leave a flat background
 * flat. The conservative reading is deliberate: a `blur()` or `invert()` on an
 * ancestor changes the colour behind the element completely, and we cannot tell
 * which filter is harmless without evaluating it.
 */
export function readBackdropStep(
  style: CSSStyleDeclaration,
  options: ParseColorOptions = {},
): BackdropStep {
  const image = (style.backgroundImage ?? '').trim().toLowerCase();
  const paint: BackdropPaint =
    image === '' || image === 'none'
      ? 'none'
      : image.includes('url(')
        ? 'image'
        : image.includes('gradient(')
          ? 'gradient'
          : 'image';

  const blend = (style.mixBlendMode ?? '').trim().toLowerCase();
  const filter = (style.filter ?? '').trim().toLowerCase();
  const backdropFilter = (style.backdropFilter ?? '').trim().toLowerCase();
  const isSet = (value: string, neutral: string): boolean => value !== '' && value !== neutral;

  const opacity = Number.parseFloat(style.opacity ?? '');

  return {
    color: parseColor(style.backgroundColor ?? '', options),
    paint,
    opacity: Number.isFinite(opacity) ? opacity : 1,
    blended:
      isSet(blend, 'normal') || isSet(filter, 'none') || isSet(backdropFilter, 'none'),
  };
}

/** How far up the tree the backdrop walk will go before giving up. */
export const MAX_BACKDROP_DEPTH = 64;

/**
 * The chain of elements that paint behind `element`, nearest first.
 *
 * Includes the element itself, because its own background is part of what sits
 * behind its text. Shadow hosts are followed so a component's backdrop resolves
 * past its root instead of stopping dead at the boundary.
 */
export function backdropAncestors(
  element: Element,
  maxDepth: number = MAX_BACKDROP_DEPTH,
): Element[] {
  const chain: Element[] = [];
  let current: Element | null = element;

  while (current && chain.length < maxDepth) {
    chain.push(current);
    current = backdropParent(current);
  }

  return chain;
}

function backdropParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;

  // A direct child of a shadow root has no `parentElement`; its visual parent
  // is the host.
  const parent = element.parentNode;
  if (parent && 'host' in parent) {
    const host = (parent as ShadowRoot).host;
    return host ?? null;
  }

  return null;
}

/** The effective background behind an element, or an honest refusal. */
export type EffectiveBackground =
  | {
      kind: 'resolved';
      /** Opaque colour actually behind (and under) the element. */
      color: Rgba;
      /** The UA canvas colour was assumed because every layer was translucent. */
      assumedCanvas: boolean;
      /** Elements composited, nearest first. */
      chain: Element[];
    }
  | {
      kind: 'indeterminate';
      reason: BackdropUncertainty;
      /** What we did manage to composite, still translucent. */
      partial: Rgba | null;
      /** The element that made it unknowable, so the UI can point at it. */
      blockedBy: Element | null;
      chain: Element[];
    };

/** Options for resolving an element's effective background. */
export interface EffectiveBackgroundOptions extends BackdropOptions {
  view?: Window;
  /** Style reader override; injectable so the walk is testable without layout. */
  readStyle?: (element: Element) => CSSStyleDeclaration;
  maxDepth?: number;
}

/**
 * Walk up from an element compositing backgrounds until something opaque.
 *
 * Known limitation, worth stating because it is invisible: the walk follows the
 * DOM tree, and a positioned or transformed element can paint over a completely
 * different part of the page than its ancestors suggest. Detecting that needs
 * hit-testing, not style reading, so an absolutely positioned element over an
 * unrelated section still reports its DOM ancestors' background.
 */
export function resolveEffectiveBackground(
  element: Element,
  options: EffectiveBackgroundOptions = {},
): EffectiveBackground {
  const view = options.view ?? element.ownerDocument?.defaultView ?? window;
  const readStyle = options.readStyle ?? ((target: Element) => view.getComputedStyle(target));
  const maxDepth = options.maxDepth ?? MAX_BACKDROP_DEPTH;

  const chain = backdropAncestors(element, maxDepth);
  const steps = chain.map((current) => readBackdropStep(readStyle(current)));

  // Falling off the end of a *complete* chain means the canvas; falling off the
  // end of a truncated one means we simply stopped looking.
  const last = chain[chain.length - 1];
  const chainTruncated = last !== undefined && backdropParent(last) !== null;

  const resolution = compositeBackdrop(steps, {
    ...(options.canvasColor ? { canvasColor: options.canvasColor } : {}),
    chainTruncated,
  });

  if (resolution.kind === 'resolved') {
    return {
      kind: 'resolved',
      color: resolution.color,
      assumedCanvas: resolution.assumedCanvas,
      chain: chain.slice(0, resolution.depth),
    };
  }

  return {
    kind: 'indeterminate',
    reason: resolution.reason,
    partial: resolution.partial,
    blockedBy: chain[resolution.depth] ?? null,
    chain: chain.slice(0, resolution.depth),
  };
}
