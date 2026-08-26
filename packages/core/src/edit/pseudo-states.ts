/**
 * Force `:hover`, `:focus` and friends on an element.
 *
 * Without this, hover styles are simply uninspectable: the moment the pointer
 * leaves the element to reach the panel, the state is gone. It is the single
 * most-requested thing an inspector does that a screenshot cannot.
 *
 * DevTools does this through the debugging protocol, which no extension can
 * reach. The technique available to a content script is to rewrite the page's
 * own rules: every selector containing `:hover` is duplicated with that
 * pseudo-class swapped for an attribute selector, the copies are injected as a
 * new stylesheet, and the attribute is set on the target element.
 *
 * Two properties make this safe:
 *
 * - **The page's own rules are never touched.** Only copies are injected, into
 *   a stylesheet of ours that can be removed wholesale.
 * - **Specificity is preserved.** An attribute selector and a pseudo-class
 *   both count as one class-level unit, so `a:hover` and
 *   `a[data-…~="hover"]` weigh exactly the same and the cascade behaves as it
 *   did.
 */

/** The states worth forcing. Ordered longest-first — see {@link rewriteSelector}. */
export const FORCEABLE_STATES = [
  'focus-within',
  'focus-visible',
  'focus',
  'hover',
  'active',
  'visited',
  'target',
] as const;

export type PseudoState = (typeof FORCEABLE_STATES)[number];

/** Attribute carrying the forced states, space-separated for `~=` matching. */
export const FORCE_ATTRIBUTE = 'data-open-inspector-force';

export interface PseudoStateSupport {
  /** States that appear in at least one readable rule for this document. */
  available: Set<PseudoState>;
  /** Sheets that could not be read, so the answer is incomplete. */
  unreadableSheets: number;
  /** Rules rewritten. Zero means forcing will visibly do nothing. */
  ruleCount: number;
}

/**
 * Swap pseudo-classes for the marker attribute.
 *
 * Longest names first, or `:focus-visible` would be mangled by the `:focus`
 * pass into `[data-…~="focus"]-visible`.
 */
export function rewriteSelector(selector: string, states: readonly PseudoState[]): string {
  let rewritten = selector;

  for (const state of states) {
    // Word boundary stops `:focus` matching inside `:focus-within`, which the
    // ordering already handles, and stops `:active` matching `:active-thing`.
    const pattern = new RegExp(`:${state}(?![\\w-])`, 'g');
    rewritten = rewritten.replace(pattern, `[${FORCE_ATTRIBUTE}~="${state}"]`);
  }

  return rewritten;
}

/** Does this selector mention any of the given states? */
export function mentionsState(selector: string, states: readonly PseudoState[]): PseudoState[] {
  return states.filter((state) => new RegExp(`:${state}(?![\\w-])`).test(selector));
}

interface CollectResult {
  css: string[];
  found: Set<PseudoState>;
  ruleCount: number;
}

/**
 * Walk a rule list, copying anything that mentions a forced state.
 *
 * Conditional groups are reconstructed around their contents rather than
 * flattened: a hover rule that only applies above 768px must keep that
 * condition, or forcing hover would show desktop styles on a phone layout.
 */
function collectRules(
  rules: CSSRuleList | undefined,
  states: readonly PseudoState[],
  out: CollectResult,
  depth = 0,
): void {
  if (!rules || depth > 8) return;

  for (const rule of Array.from(rules)) {
    const style = rule as CSSStyleRule;

    if (style.selectorText !== undefined && style.style) {
      const matched = mentionsState(style.selectorText, states);
      if (matched.length === 0) continue;

      for (const state of matched) out.found.add(state);
      out.css.push(`${rewriteSelector(style.selectorText, states)} { ${style.style.cssText} }`);
      out.ruleCount += 1;
      continue;
    }

    const group = rule as CSSGroupingRule & { conditionText?: string; media?: MediaList };
    if (group.cssRules) {
      const nested: CollectResult = { css: [], found: out.found, ruleCount: 0 };
      collectRules(group.cssRules, states, nested, depth + 1);

      if (nested.css.length > 0) {
        const condition =
          group.conditionText ?? (group.media ? String(group.media.mediaText) : '');
        const at = rule.cssText.slice(0, rule.cssText.indexOf('{')).trim();
        out.css.push(`${at || `@media ${condition}`} { ${nested.css.join('\n')} }`);
        out.ruleCount += nested.ruleCount;
      }
    }
  }
}

export interface PseudoStateController {
  /** Which states this page actually styles, and how completely we can tell. */
  readonly support: PseudoStateSupport;
  /** Force exactly this set on one element. An empty set clears it. */
  force(element: Element, states: ReadonlySet<PseudoState>): void;
  /** States currently forced on an element. */
  forced(element: Element): Set<PseudoState>;
  /** Remove all forcing and the injected stylesheet. */
  destroy(): void;
}

/**
 * Build the forcing machinery for one document.
 *
 * The rewritten stylesheet is produced once and reused: rebuilding it per
 * toggle would re-walk every rule in the document, which on a CSS-in-JS page
 * means tens of thousands of them.
 */
export function createPseudoStateController(doc: Document = document): PseudoStateController {
  const states = FORCEABLE_STATES;
  const result: CollectResult = { css: [], found: new Set(), ruleCount: 0 };
  let unreadableSheets = 0;

  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      collectRules(sheet.cssRules, states, result);
    } catch {
      // Cross-origin stylesheet. Its hover rules cannot be forced, and no
      // extension permission changes that.
      unreadableSheets += 1;
    }
  }

  let styleElement: HTMLStyleElement | null = null;
  const forcedByElement = new Map<Element, Set<PseudoState>>();

  function ensureStyle(): void {
    if (styleElement?.isConnected) return;

    styleElement = doc.createElement('style');
    styleElement.setAttribute('data-open-inspector', 'forced-states');
    styleElement.textContent = result.css.join('\n');
    // Last in the head so it lands after the page's own sheets, matching where
    // the originals sat relative to each other.
    (doc.head ?? doc.documentElement).appendChild(styleElement);
  }

  return {
    support: {
      available: result.found,
      unreadableSheets,
      ruleCount: result.ruleCount,
    },

    force(element, next) {
      if (next.size === 0) {
        element.removeAttribute(FORCE_ATTRIBUTE);
        forcedByElement.delete(element);
        return;
      }

      ensureStyle();
      element.setAttribute(FORCE_ATTRIBUTE, [...next].join(' '));
      forcedByElement.set(element, new Set(next));
    },

    forced(element) {
      return new Set(forcedByElement.get(element) ?? []);
    },

    destroy() {
      for (const element of forcedByElement.keys()) {
        element.removeAttribute(FORCE_ATTRIBUTE);
      }
      forcedByElement.clear();
      styleElement?.remove();
      styleElement = null;
    },
  };
}
