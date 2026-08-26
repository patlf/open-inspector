import {
  a11y,
  cascade,
  color,
  describeElement,
  formatDimensions,
  layout,
  readBoxModel,
  readTreePosition,
  round,
  typography,
} from '@open-inspector/core';
import { markup } from '@open-inspector/core';
import type {
  ColorEntry,
  ContrastInfo,
  Field,
  LayoutInfo,
  PanelData,
  RuleInfo,
  TreeInfo,
  TypeInfo,
} from './view-model.js';

/**
 * Turn one element into everything the panel shows about it.
 *
 * The adapter layer: engine modules produce rich, precise structures; the
 * panel wants flat display strings. Keeping the translation here means neither
 * side has to compromise — the engine stays exact and the UI stays dumb.
 *
 * Everything in here runs on every pointer move, so it must stay cheap. The
 * page-wide work lives in page.ts and runs once.
 */

const CSS_WIDE_KEYWORDS = new Set(['none', 'normal', 'auto', 'initial', 'inherit', '0px', '']);

function isInteresting(value: string | null | undefined): value is string {
  return !!value && !CSS_WIDE_KEYWORDS.has(value);
}

/**
 * Build a display row.
 *
 * `property` is what makes a row editable, so it is only set where the row
 * genuinely corresponds to one declaration. Rows showing derived values — a
 * line-height ratio, a measured width — deliberately omit it and stay
 * read-only rather than offering an edit that could not be written back.
 */
function field(
  label: string,
  value: string | null | undefined,
  detail?: string,
  property?: string,
): Field | null {
  if (!isInteresting(value)) return null;

  const row: Field = { label, value };
  if (detail !== undefined) row.detail = detail;
  if (property !== undefined) row.property = property;
  return row;
}

function compact(fields: Array<Field | null>): Field[] {
  return fields.filter((entry): entry is Field => entry !== null);
}

// ── colours ─────────────────────────────────────────────────────────────────

/**
 * The declaration a colour came from.
 *
 * Carrying it is what makes the Color tab editable — without it a swatch is
 * just a reading, and there is nothing to write a new value back to.
 */
const COLOR_PROPERTIES: Record<string, string> = {
  text: 'color',
  background: 'background-color',
  border: 'border-color',
  outline: 'outline-color',
};

function toEntry(role: string, rgba: color.Rgba | null): ColorEntry | null {
  if (!rgba || rgba.a === 0) return null;

  const formats = color.formatColor(rgba);
  const entry: ColorEntry = {
    hex: formats.hex,
    rgb: formats.rgb,
    hsl: formats.hsl,
    oklch: formats.oklch,
    role,
  };

  // Shadows and gradient stops live inside a longhand string, so there is no
  // single property to write back to; they stay read-only.
  const property = COLOR_PROPERTIES[role];
  if (property) entry.property = property;

  return entry;
}

function readColors(element: Element, view: Window): ColorEntry[] {
  const colors = color.readElementColors(element, view);

  const entries: Array<ColorEntry | null> = [
    toEntry('text', colors.text),
    toEntry('background', colors.background),
    toEntry('outline', colors.outline),
  ];

  // Borders are per-side, but a page almost always uses one colour on all four;
  // collapsing them keeps the common case to a single row.
  const borders = new Map<string, color.Rgba>();
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const value = colors.border[side];
    if (value) borders.set(color.formatColor(value).hex, value);
  }
  for (const value of borders.values()) entries.push(toEntry('border', value));

  for (const shadow of colors.shadows) entries.push(toEntry('shadow', shadow));
  for (const stop of colors.gradientStops) entries.push(toEntry('gradient', stop));

  const seen = new Set<string>();
  return entries.filter((entry): entry is ColorEntry => {
    if (!entry) return false;
    const key = `${entry.role}:${entry.hex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── contrast ────────────────────────────────────────────────────────────────

/** Why the backdrop could not be read, in the accessibility module's vocabulary. */
export const BACKDROP_REASONS: Record<color.BackdropUncertainty, a11y.IndeterminateReason> = {
  gradient: 'gradient',
  image: 'background-image',
  blend: 'mix-blend-mode',
  unreadable: 'unparsable-color',
  'depth-limit': 'transparent-to-root',
};

/** Plain-language explanation of an unreadable backdrop, for the panel. */
const BACKDROP_EXPLANATIONS: Record<color.BackdropUncertainty, string> = {
  gradient: 'The text sits on a gradient, so there is no single background colour to grade against.',
  image: 'The text sits on an image, so the contrast depends on which pixels are behind it.',
  blend: 'A blend mode is in play, so the painted background is not any declared colour.',
  unreadable: 'A background colour on an ancestor could not be parsed, so any ratio would be a guess.',
  'depth-limit':
    'Every ancestor up to the root is translucent, so nothing establishes an opaque background.',
};

/**
 * Grade the element's text against what is actually behind it.
 *
 * Only attempted for elements with text of their own — grading a wrapper div's
 * inherited colour against its own transparent background produces a number
 * that is technically correct and completely meaningless.
 */
function readContrast(element: Element, view: Window): ContrastInfo | null {
  if (!color.hasDirectText(element)) return null;

  const style = view.getComputedStyle(element);
  const colors = color.readElementColors(element, view);
  if (!colors.text) return null;

  const backdrop = color.resolveEffectiveBackground(element, { view });
  const background: a11y.ResolvedBackground =
    backdrop.kind === 'resolved'
      ? { kind: 'solid', color: backdrop.color }
      : {
          kind: 'indeterminate',
          reason: BACKDROP_REASONS[backdrop.reason],
          detail: backdrop.reason,
        };

  const verdict = a11y.assessContrast({
    foreground: colors.text,
    background,
    fontSizePx: Number.parseFloat(style.fontSize) || 16,
    fontWeight: a11y.normalizeFontWeight(style.fontWeight),
  });

  if (verdict.status === 'indeterminate') {
    return {
      kind: 'indeterminate',
      reason:
        backdrop.kind === 'indeterminate'
          ? BACKDROP_EXPLANATIONS[backdrop.reason]
          : 'The background could not be resolved to one opaque colour, so any ratio would be a guess.',
    };
  }

  const info: ContrastInfo = {
    kind: 'measured',
    ratio: `${verdict.ratio.toFixed(2)}:1`,
    aa: verdict.passesAA,
    aaa: verdict.passesAAA,
    largeText: verdict.textSize === 'large',
    foreground: color.formatColor(colors.text).hex,
  };

  if (backdrop.kind === 'resolved') info.background = color.formatColor(backdrop.color).hex;

  // `unreachable` means no lightness adjustment reaches AA — offering the best
  // near-miss as if it were a fix would be a lie.
  if (verdict.remediation?.kind === 'lightness') info.suggestion = verdict.remediation.hex;

  return info;
}

// ── typography ──────────────────────────────────────────────────────────────

function readTypeInfo(element: Element, view: Window): TypeInfo {
  const type = typography.readTypography(element, { view });

  const info: TypeInfo = {
    stack: type.family.stack,
    rendered: type.family.rendered,
    method: type.family.method,
    size: `${round(type.size.px)}px`,
    weight: type.weight.value
      ? `${type.weight.value}${type.weight.name ? ` · ${type.weight.name.toLowerCase()}` : ''}`
      : 'unknown',
    style: type.style,
    lineHeight: type.lineHeight.kind === 'normal' ? 'normal' : `${round(type.lineHeight.px ?? 0)}px`,
    letterSpacing:
      type.letterSpacing.kind === 'normal' ? 'normal' : `${round(type.letterSpacing.px ?? 0)}px`,
    transform: type.textTransform,
  };

  if (type.size.rem != null) info.sizeRem = `${round(type.size.rem, 3)}rem`;
  // The unitless ratio is what designers actually reason about.
  if (type.lineHeight.ratio != null) info.lineHeightRatio = `${round(type.lineHeight.ratio, 2)}×`;
  if (isInteresting(type.textAlign)) info.align = type.textAlign;
  if (isInteresting(type.textDecoration.line)) info.decoration = type.textDecoration.line;

  return info;
}

// ── layout ──────────────────────────────────────────────────────────────────

function readLayoutInfo(element: Element, view: Window): LayoutInfo {
  const anatomy = layout.readContainerAnatomy(element, view);
  const style = view.getComputedStyle(element);
  const child = anatomy.childLayout;

  const fields: Array<Field | null> = [field('display', style.display)];

  if (child.kind === 'grid') {
    fields.push(
      field('columns', style.gridTemplateColumns),
      field('rows', style.gridTemplateRows),
      field('auto flow', style.gridAutoFlow),
      field('gap', style.gap),
      field('justify items', style.justifyItems),
      field('align items', style.alignItems),
    );
  } else if (child.kind === 'flex') {
    fields.push(
      field('direction', style.flexDirection),
      field('wrap', style.flexWrap),
      field('justify content', style.justifyContent),
      field('align items', style.alignItems),
      field('gap', style.gap),
    );
  }

  const info: LayoutInfo = { display: style.display, fields: compact(fields) };
  if (anatomy.summary) info.summary = anatomy.summary;

  const placement = anatomy.placement;
  const parentFields: Array<Field | null> = [];

  if (placement.kind === 'grid-item') {
    parentFields.push(
      field('grid column', style.gridColumn),
      field('grid row', style.gridRow),
      field('justify self', style.justifySelf),
      field('align self', style.alignSelf),
    );
  } else if (placement.kind === 'flex-item') {
    parentFields.push(
      field('flex', style.flex),
      field('grow', style.flexGrow === '0' ? null : style.flexGrow),
      field('shrink', style.flexShrink === '1' ? null : style.flexShrink),
      field('basis', style.flexBasis),
      field('align self', style.alignSelf === 'auto' ? null : style.alignSelf),
      field('order', style.order === '0' ? null : style.order),
    );
  }

  const resolved = compact(parentFields);
  if (resolved.length > 0) {
    const parent = element.parentElement;
    info.parent = {
      display: parent ? view.getComputedStyle(parent).display : placement.kind,
      fields: resolved,
    };
  }

  return info;
}

// ── spacing and appearance ──────────────────────────────────────────────────

function readSpacing(style: CSSStyleDeclaration): Field[] {
  return compact([
    field('margin', style.margin, undefined, 'margin'),
    field('padding', style.padding, undefined, 'padding'),
    field('gap', style.gap, undefined, 'gap'),
    field('width', style.width, undefined, 'width'),
    field('height', style.height, undefined, 'height'),
    field('min width', style.minWidth, undefined, 'min-width'),
    field('max width', style.maxWidth, undefined, 'max-width'),
  ]);
}

function readAppearance(style: CSSStyleDeclaration): Field[] {
  return compact([
    field('background', style.backgroundColor, undefined, 'background-color'),
    field('background image', style.backgroundImage, undefined, 'background-image'),
    field('border', style.border, undefined, 'border'),
    field('radius', style.borderRadius, undefined, 'border-radius'),
    field('box shadow', style.boxShadow, undefined, 'box-shadow'),
    field('opacity', style.opacity === '1' ? null : style.opacity, undefined, 'opacity'),
    field('overflow', style.overflow === 'visible' ? null : style.overflow, undefined, 'overflow'),
    field('transform', style.transform, undefined, 'transform'),
    field('transition', style.transition, undefined, 'transition'),
    field('filter', style.filter, undefined, 'filter'),
    field('backdrop filter', style.backdropFilter, undefined, 'backdrop-filter'),
    field('z index', style.zIndex, undefined, 'z-index'),
    field('position', style.position === 'static' ? null : style.position, undefined, 'position'),
    // `cursor` is deliberately absent. The session sets a crosshair on the
    // document root while inspecting, so every element inherits it and the
    // reported value would describe us rather than the page. Reporting a value
    // we caused ourselves is worse than not reporting it; the authored value
    // still shows up in the matched-rules list.
  ]);
}

// ── matched rules ───────────────────────────────────────────────────────────

const MAX_RULES_SHOWN = 12;
/** A single rule with 40 longhands would push everything else off the panel. */
const MAX_DECLARATIONS_PER_RULE = 24;

/**
 * Did a human write this declaration?
 *
 * The CSSOM expands every shorthand into its longhands, so one authored
 * `background: #f7f8f9` arrives as eight declarations, seven of them `initial`.
 * Listing those buries the two lines that actually matter under filler, and
 * empty values (which some engines emit for unset longhands) render as a
 * property with nothing after the colon, which just looks broken.
 */
function isAuthored(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== '' && trimmed !== 'initial' && trimmed !== 'none initial';
}

/** Shorten a stylesheet URL to something that fits in the panel. */
function sourceLabel(sheet: { href?: string | null } | null | undefined): string {
  const href = sheet?.href;
  if (!href) return 'inline';
  try {
    const url = new URL(href);
    const file = url.pathname.split('/').filter(Boolean).pop();
    return file ?? url.hostname;
  } catch {
    return href;
  }
}

/**
 * Group the resolved cascade back into the rules it came from.
 *
 * The cascade resolves per property, which is the right model for deciding
 * winners but the wrong one for reading: developers think in rules. Regrouping
 * by `ruleId` reconstructs the authored blocks, with each declaration carrying
 * its verdict so overridden ones can be struck through.
 */
/**
 * Pseudo-elements worth showing.
 *
 * `::before` and `::after` carry real design on most modern sites — icons,
 * decorative rules, focus rings — and they are invisible to an inspector that
 * only ever asks the cascade about the element itself.
 */
const PSEUDO_ELEMENTS = ['::before', '::after', '::marker', '::placeholder'] as const;

function readRules(
  element: Element,
  index: cascade.StyleIndex | null,
  pseudoElement: string | null = null,
): { rules: RuleInfo[]; unreadableSheets: number } {
  if (!index) return { rules: [], unreadableSheets: 0 };

  const explained = cascade.explainElementCascade(
    element,
    index,
    pseudoElement ? { pseudoElement } : {},
  );
  const rulesById = new Map(index.rules.map((rule) => [rule.id, rule]));
  const byRule = new Map<number | 'inline', RuleInfo>();

  for (const property of explained.cascade.properties) {
    for (const declaration of property.declarations) {
      if (!isAuthored(declaration.value)) continue;

      const key = declaration.ruleId ?? 'inline';
      let entry = byRule.get(key);

      if (!entry) {
        const rule = declaration.ruleId != null ? rulesById.get(declaration.ruleId) : undefined;
        entry = {
          selector: rule?.selectorText ?? 'element.style',
          source: rule ? sourceLabel(rule.sheet) : 'style attribute',
          specificity: declaration.specificity.join(','),
          declarations: [],
        };
        byRule.set(key, entry);
      }

      entry.declarations.push({
        property: declaration.property,
        value: declaration.value,
        important: declaration.important,
        winning: declaration.status === 'winning',
      });
    }
  }

  // Rules whose declarations all lost are the least interesting; show the ones
  // that actually shape the element first.
  const rules = [...byRule.values()]
    .filter((rule) => rule.declarations.length > 0)
    .sort(
      (a, b) =>
        b.declarations.filter((entry) => entry.winning).length -
        a.declarations.filter((entry) => entry.winning).length,
    )
    .slice(0, MAX_RULES_SHOWN)
    .map((rule) => ({
      ...rule,
      declarations: rule.declarations.slice(0, MAX_DECLARATIONS_PER_RULE),
    }));

  return { rules, unreadableSheets: explained.unreadableSheetCount };
}

// ── entry point ─────────────────────────────────────────────────────────────

/** Build the breadcrumb and stepping flags for one element. */
function readTree(element: Element, ignore?: (element: Element) => boolean): TreeInfo {
  const position = readTreePosition(element, ignore ? { ignore } : {});

  return {
    // Reversed so the breadcrumb reads outermost-to-innermost, the direction
    // people read a path.
    trail: position.trail
      .slice()
      .reverse()
      .map((crumb) => ({ label: crumb.label, depth: crumb.depth })),
    childCount: position.childCount,
    siblingIndex: position.siblingIndex,
    siblingCount: position.siblingCount,
    canParent: position.parent !== null,
    canChild: position.firstChild !== null,
    canPrevious: position.previousSibling !== null,
    canNext: position.nextSibling !== null,
  };
}

export interface CollectOptions {
  /**
   * A prebuilt stylesheet index.
   *
   * Building it walks every rule in every stylesheet, which on a CSS-in-JS page
   * means tens of thousands of them. Built once per page by the session and
   * handed in here, never rebuilt per hover.
   */
  styleIndex?: cascade.StyleIndex | null;
  /** Elements belonging to the inspector, hidden from the tree. */
  ignore?: (element: Element) => boolean;
}

/** Read everything the panel shows for a single element. */
export function collectElementData(
  element: Element,
  view: Window = window,
  options: CollectOptions = {},
): PanelData {
  const style = view.getComputedStyle(element);
  const descriptor = describeElement(element);
  const index = options.styleIndex ?? null;
  const matched = readRules(element, index);

  /**
   * A pseudo-element only exists if something styles it, so an empty rule set
   * means there is nothing to show rather than something we failed to find.
   */
  const pseudoRules = PSEUDO_ELEMENTS.flatMap((pseudo) => {
    const found = readRules(element, index, pseudo);
    return found.rules.length > 0 ? [{ pseudo, rules: found.rules }] : [];
  });

  return {
    selectorLabel: descriptor.selectorLabel,
    tagName: descriptor.tagName,
    dimensions: formatDimensions(descriptor.width, descriptor.height),
    boundary: null,
    box: readBoxModel(element, view),
    colors: readColors(element, view),
    typography: readTypeInfo(element, view),
    contrast: readContrast(element, view),
    layout: readLayoutInfo(element, view),
    spacing: readSpacing(style),
    appearance: readAppearance(style),
    rules: matched.rules,
    unreadableSheets: matched.unreadableSheets,
    tree: readTree(element, options.ignore),
    pseudoRules,
    markup: {
      html: markup.serializeElement(element, { dialect: 'html' }).text,
      jsx: markup.serializeElement(element, { dialect: 'jsx' }).text,
    },
  };
}
