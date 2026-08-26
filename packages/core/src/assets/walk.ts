import { buildSelectorLabel } from '../probe/describe.js';

export interface WalkOptions {
  /** Hard cap on elements visited. */
  maxElements: number;
  /** Whether to descend into open shadow roots. */
  pierceShadowRoots: boolean;
  /** Elements to skip, subtree and all. Used to exclude the inspector's own UI. */
  ignore?: (element: Element) => boolean;
}

export interface WalkResult {
  elements: Element[];
  /** Open shadow roots descended into. Closed ones are undetectable by design. */
  shadowRootsEntered: number;
  /** True when the cap stopped the walk before the tree ran out. */
  truncated: boolean;
}

/**
 * Visit every element under a root, in document order, within a budget.
 *
 * `querySelectorAll('*')` would be shorter but stops at the first shadow
 * boundary, and design systems put most of their images inside components.
 * This walks manually so open shadow roots are included and so the budget can
 * actually stop the traversal — a `querySelectorAll` on a hundred-thousand
 * node page has already cost the memory by the time it can be sliced.
 *
 * An ignored element takes its subtree with it. That is what makes it usable
 * for excluding an inspector overlay, whose own markup would otherwise show up
 * in the harvest.
 */
export function walkElements(root: ParentNode, options: WalkOptions): WalkResult {
  const elements: Element[] = [];
  const stack: Element[] = [];
  const ignore = options.ignore;
  let shadowRootsEntered = 0;
  let truncated = false;

  // A `Document` or `DocumentFragment` root is a container to descend into; an
  // `Element` root is itself part of the harvest and gets pushed so its own
  // attributes are read too.
  if (isElement(root)) stack.push(root);
  else pushChildren(stack, root);

  while (stack.length > 0) {
    const element = stack.pop();
    if (!element) break;

    if (ignore?.(element)) continue;

    if (elements.length >= options.maxElements) {
      truncated = true;
      break;
    }
    elements.push(element);

    if (options.pierceShadowRoots && element.shadowRoot) {
      shadowRootsEntered += 1;
      pushChildren(stack, element.shadowRoot);
    }

    pushChildren(stack, element);
  }

  return { elements, shadowRootsEntered, truncated };
}

function pushChildren(stack: Element[], parent: ParentNode): void {
  const children = parent.children;
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child) stack.push(child);
  }
}

function isElement(node: ParentNode): node is Element & ParentNode {
  return 'tagName' in node;
}

/**
 * A short label identifying the element a reference came from.
 *
 * Reads classes through `classList` because `className` on an SVG element is
 * an `SVGAnimatedString`, and half the assets on a page hang off SVG nodes.
 */
export function elementLabel(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? element.id : null;
  return buildSelectorLabel(tagName, id, Array.from(element.classList));
}
