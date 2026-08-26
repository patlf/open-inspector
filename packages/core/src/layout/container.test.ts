import { describe, expect, it } from 'vitest';
import {
  analyzeContainer,
  classifyDisplay,
  containingBlockReason,
  createLayoutSnapshot,
  describeFlexItem,
  estimateImplicitTracks,
  findLayoutParent,
  parseGridAreas,
  readContainerAnatomy,
  resolveContainingBlock,
  snapshotLayoutStyle,
  type ContainingBlock,
  type LayoutStyleSnapshot,
} from './container.js';

/** A `Window` that answers `getComputedStyle` from a lookup table. */
function fakeView(styles: Map<Element, Partial<CSSStyleDeclaration>>): Window {
  return {
    getComputedStyle: (element: Element) => (styles.get(element) ?? {}) as CSSStyleDeclaration,
  } as unknown as Window;
}

describe('classifyDisplay', () => {
  it('splits legacy single keywords into outer and inner', () => {
    expect(classifyDisplay('block')).toEqual({
      raw: 'block',
      outer: 'block',
      inner: 'flow',
      listItem: false,
    });
    expect(classifyDisplay('inline-flex')).toMatchObject({ outer: 'inline', inner: 'flex' });
    expect(classifyDisplay('inline-grid')).toMatchObject({ outer: 'inline', inner: 'grid' });
    expect(classifyDisplay('inline-block')).toMatchObject({ outer: 'inline', inner: 'flow-root' });
    expect(classifyDisplay('table-cell')).toMatchObject({ inner: 'table' });
  });

  it('understands the two-value syntax newer engines compute', () => {
    expect(classifyDisplay('inline flex')).toMatchObject({ outer: 'inline', inner: 'flex' });
    expect(classifyDisplay('block flow-root')).toMatchObject({ outer: 'block', inner: 'flow-root' });
    expect(classifyDisplay('block flow list-item')).toMatchObject({
      outer: 'block',
      inner: 'flow',
      listItem: true,
    });
  });

  it('treats none and contents as their own thing', () => {
    expect(classifyDisplay('none')).toMatchObject({ outer: 'none', inner: 'none' });
    expect(classifyDisplay('contents')).toMatchObject({ outer: 'contents', inner: 'contents' });
  });
});

describe('estimateImplicitTracks', () => {
  const base = {
    autoFlow: 'row',
    autoColumns: 'auto',
    autoRows: 'auto',
  };

  it('spots rows that exist on screen but not in grid-template-rows', () => {
    const verdict = estimateImplicitTracks({
      ...base,
      explicitColumns: 3,
      explicitRows: 1,
      childCount: 7,
    });

    expect(verdict).toEqual({ kind: 'likely', axis: 'row', sizing: 'auto', estimatedCount: 2 });
  });

  it('reports none when the explicit grid has room', () => {
    expect(
      estimateImplicitTracks({ ...base, explicitColumns: 3, explicitRows: 3, childCount: 6 }),
    ).toEqual({ kind: 'none' });
    expect(
      estimateImplicitTracks({ ...base, explicitColumns: 3, explicitRows: 0, childCount: 0 }),
    ).toEqual({ kind: 'none' });
  });

  it('follows the flow axis for grid-auto-flow: column', () => {
    const verdict = estimateImplicitTracks({
      autoFlow: 'column dense',
      autoColumns: '200px',
      autoRows: 'auto',
      explicitColumns: 0,
      explicitRows: 2,
      childCount: 5,
    });

    expect(verdict).toEqual({
      kind: 'likely',
      axis: 'column',
      sizing: '200px',
      estimatedCount: 3,
    });
  });

  it('says unknown instead of guessing when it has nothing to divide by', () => {
    expect(
      estimateImplicitTracks({ ...base, explicitColumns: 0, explicitRows: 0, childCount: 4 }),
    ).toMatchObject({ kind: 'unknown' });
    expect(
      estimateImplicitTracks({ ...base, explicitColumns: 3, explicitRows: 1, childCount: null }),
    ).toMatchObject({ kind: 'unknown', reason: 'child count was not supplied' });
  });
});

describe('parseGridAreas', () => {
  it('reads the area grid row by row', () => {
    expect(parseGridAreas('"header header" "sidebar main"')).toEqual([
      ['header', 'header'],
      ['sidebar', 'main'],
    ]);
  });

  it('returns null when no areas are named', () => {
    expect(parseGridAreas('none')).toBeNull();
    expect(parseGridAreas('')).toBeNull();
  });
});

describe('analyzeContainer — how it lays out children', () => {
  it('describes a grid container and its tracks', () => {
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({
        display: 'grid',
        gridTemplateColumns: '300px 300px 300px',
        gridTemplateRows: '200px',
        columnGap: '16px',
        rowGap: '16px',
        justifyItems: 'stretch',
        alignItems: 'start',
      }),
      parent: createLayoutSnapshot({ display: 'block' }),
      childCount: 7,
    });

    expect(anatomy.childLayout.kind).toBe('grid');
    expect(anatomy.childLayout.grid?.explicitColumnCount).toBe(3);
    expect(anatomy.childLayout.grid?.explicitRowCount).toBe(1);
    expect(anatomy.childLayout.grid?.columnGap).toBe(16);
    expect(anatomy.childLayout.grid?.implicitTracks).toMatchObject({ kind: 'likely', axis: 'row' });
    expect(anatomy.childLayout.summary).toContain('grid container');
    // The implicit rows are the thing computed styles hide; it must be said.
    expect(anatomy.childLayout.notes.join(' ')).toContain('implicit');
  });

  it('warns about dense packing reordering items', () => {
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridAutoFlow: 'row dense',
      }),
      parent: null,
      childCount: 3,
    });

    expect(anatomy.childLayout.grid?.dense).toBe(true);
    expect(anatomy.childLayout.notes.join(' ')).toContain('DOM order');
  });

  it('resolves the flex main axis against the writing mode', () => {
    const horizontal = analyzeContainer({
      self: createLayoutSnapshot({ display: 'flex', flexDirection: 'row', columnGap: '8px' }),
      parent: null,
    });
    expect(horizontal.childLayout.flex?.mainAxis).toBe('horizontal');

    const vertical = analyzeContainer({
      self: createLayoutSnapshot({
        display: 'flex',
        flexDirection: 'row',
        writingMode: 'vertical-rl',
      }),
      parent: null,
    });
    expect(vertical.childLayout.flex?.mainAxis).toBe('vertical');
  });

  it('treats normal gap as zero rather than NaN', () => {
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({ display: 'flex' }),
      parent: null,
    });
    expect(anatomy.childLayout.flex?.columnGap).toBe(0);
    expect(anatomy.childLayout.flex?.rowGap).toBe(0);
  });

  it('reports display: none and display: contents honestly', () => {
    const hidden = analyzeContainer({
      self: createLayoutSnapshot({ display: 'none' }),
      parent: createLayoutSnapshot({ display: 'flex' }),
    });
    expect(hidden.childLayout.kind).toBe('not-rendered');
    expect(hidden.placement.kind).toBe('not-rendered');

    const boxless = analyzeContainer({
      self: createLayoutSnapshot({ display: 'contents' }),
      parent: createLayoutSnapshot({ display: 'block' }),
    });
    expect(boxless.childLayout.kind).toBe('box-less');
    expect(boxless.childLayout.notes.join(' ')).toContain('accessibility tree');
  });
});

describe('analyzeContainer — how the parent lays it out', () => {
  it('explains a flex item in terms of grow, shrink and basis', () => {
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({
        display: 'block',
        flexGrow: '1',
        flexShrink: '1',
        flexBasis: '0%',
        order: '2',
      }),
      parent: createLayoutSnapshot({ display: 'flex', alignItems: 'center' }),
    });

    expect(anatomy.placement.kind).toBe('flex-item');
    expect(anatomy.placement.flex).toMatchObject({ grow: 1, shrink: 1, order: 2 });
    expect(anatomy.placement.flex?.effectiveAlign).toBe('center');
    expect(anatomy.placement.flex?.behaviour).toContain('grow ratio');
    expect(anatomy.placement.notes.join(' ')).toContain('min-width is auto');
    expect(anatomy.placement.notes.join(' ')).toContain('tab order');
  });

  it('does not warn about min-width when the item cannot shrink', () => {
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({ display: 'block', flexShrink: '0' }),
      parent: createLayoutSnapshot({ display: 'flex' }),
    });
    expect(anatomy.placement.notes.join(' ')).not.toContain('min-width');
    expect(anatomy.placement.flex?.behaviour).toContain('refuses to shrink');
  });

  it('checks min-height instead when the flex line runs vertically', () => {
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({ display: 'block', minWidth: '0' }),
      parent: createLayoutSnapshot({ display: 'flex', flexDirection: 'column' }),
    });
    expect(anatomy.placement.notes.join(' ')).toContain('min-height is auto');
  });

  it('reports an explicitly placed grid item with its span', () => {
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({
        display: 'block',
        gridColumnStart: '2',
        gridColumnEnd: 'span 2',
        gridRowStart: '1',
        gridRowEnd: '2',
      }),
      parent: createLayoutSnapshot({ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }),
    });

    expect(anatomy.placement.kind).toBe('grid-item');
    expect(anatomy.placement.grid).toMatchObject({
      column: '2 / span 2',
      row: '1 / 2',
      columnSpan: 2,
      rowSpan: 1,
      placement: 'explicit',
    });
  });

  it('recognises an auto-placed grid item and a named area', () => {
    const auto = analyzeContainer({
      self: createLayoutSnapshot({ display: 'block' }),
      parent: createLayoutSnapshot({ display: 'grid' }),
    });
    expect(auto.placement.grid).toMatchObject({ placement: 'auto', column: 'auto', area: null });
    expect(auto.placement.summary).toContain('auto-placed');

    const named = analyzeContainer({
      self: createLayoutSnapshot({
        display: 'block',
        gridColumnStart: 'sidebar',
        gridColumnEnd: 'sidebar',
        gridRowStart: 'sidebar',
        gridRowEnd: 'sidebar',
      }),
      parent: createLayoutSnapshot({ display: 'grid' }),
    });
    expect(named.placement.grid?.area).toBe('sidebar');
  });

  it('reports absolute positioning with its containing block', () => {
    const containingBlock: ContainingBlock = {
      kind: 'element',
      label: 'div#page.layout',
      reason: 'position: relative',
    };
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({
        display: 'block',
        position: 'absolute',
        top: '0px',
        left: '0px',
        zIndex: '10',
      }),
      parent: createLayoutSnapshot({ display: 'grid' }),
      containingBlock,
    });

    expect(anatomy.placement.kind).toBe('out-of-flow');
    expect(anatomy.placement.positioned?.constrainedSides).toEqual(['top', 'left']);
    expect(anatomy.placement.positioned?.containingBlock).toEqual(containingBlock);
    // Grid placement still applies to the static position, but the grid does not size it.
    expect(anatomy.placement.notes.join(' ')).toContain('does not size or place it');
    expect(anatomy.placement.grid).toBeDefined();
  });

  it('admits when the containing block was never resolved', () => {
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({ display: 'block', position: 'fixed' }),
      parent: createLayoutSnapshot({ display: 'block' }),
    });
    expect(anatomy.placement.positioned?.containingBlock).toMatchObject({ kind: 'indeterminate' });
    expect(anatomy.placement.summary).toContain('could not be determined');
  });

  it('keeps sticky in flow and explains what it needs to work', () => {
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({ display: 'block', position: 'sticky', top: '16px' }),
      parent: createLayoutSnapshot({ display: 'block' }),
    });

    expect(anatomy.placement.kind).toBe('in-flow');
    expect(anatomy.placement.positioned?.position).toBe('sticky');
    expect(anatomy.placement.positioned?.offsets.top).toBe('16px');
    expect(anatomy.placement.notes.join(' ')).toContain('unless an ancestor scrolls');
  });

  it('reports a float, and reports that flex containers ignore one', () => {
    const floated = analyzeContainer({
      self: createLayoutSnapshot({ display: 'block', float: 'left' }),
      parent: createLayoutSnapshot({ display: 'block' }),
    });
    expect(floated.placement.kind).toBe('floated');
    expect(floated.placement.float).toMatchObject({ side: 'left' });

    const inFlex = analyzeContainer({
      self: createLayoutSnapshot({ display: 'block', float: 'left' }),
      parent: createLayoutSnapshot({ display: 'flex' }),
    });
    expect(inFlex.placement.kind).toBe('flex-item');
    expect(inFlex.placement.notes.join(' ')).toContain('float is ignored');
  });

  it('refuses to name a layout parent that generates no box', () => {
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({ display: 'block' }),
      parent: createLayoutSnapshot({ display: 'contents' }),
    });
    expect(anatomy.placement.kind).toBe('indeterminate');
    expect(anatomy.placement.summary).toContain('further up the tree');
  });

  it('handles the root element, which has no layout parent', () => {
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({ display: 'block' }),
      parent: null,
    });
    expect(anatomy.placement.kind).toBe('root');
    expect(anatomy.placement.parentDisplay).toBeNull();
  });

  it('surfaces container-query participation', () => {
    const anatomy = analyzeContainer({
      self: createLayoutSnapshot({
        display: 'block',
        containerType: 'inline-size',
        containerName: 'card',
      }),
      parent: null,
    });

    expect(anatomy.containerQuery).toEqual({
      type: 'inline-size',
      name: 'card',
      sizeContained: true,
    });
    expect(anatomy.summary).toContain('query container');
  });

  it('leaves containerQuery null for ordinary elements', () => {
    const anatomy = analyzeContainer({ self: createLayoutSnapshot(), parent: null });
    expect(anatomy.containerQuery).toBeNull();
  });
});

describe('describeFlexItem', () => {
  it('calls out the flex: 1 trap', () => {
    expect(describeFlexItem(1, 1, '0%')).toContain('size comes entirely from the grow ratio');
    expect(describeFlexItem(0, 1, 'auto')).toContain('its own width/content');
    expect(describeFlexItem(0, 0, '240px')).toContain('starts from 240px');
  });
});

describe('containingBlockReason', () => {
  it('names position for absolutely positioned descendants', () => {
    const relative = createLayoutSnapshot({ position: 'relative' });
    expect(containingBlockReason(relative, 'absolute')).toBe('position: relative');
    // ...but position alone does not capture a fixed descendant.
    expect(containingBlockReason(relative, 'fixed')).toBeNull();
  });

  it('catches every property that traps position: fixed', () => {
    expect(
      containingBlockReason(createLayoutSnapshot({ transform: 'translateZ(0)' }), 'fixed'),
    ).toBe('transform: translateZ(0)');
    expect(containingBlockReason(createLayoutSnapshot({ filter: 'blur(2px)' }), 'fixed')).toBe(
      'filter: blur(2px)',
    );
    expect(
      containingBlockReason(createLayoutSnapshot({ willChange: 'transform' }), 'fixed'),
    ).toBe('will-change: transform');
    expect(containingBlockReason(createLayoutSnapshot({ contain: 'paint' }), 'fixed')).toBe(
      'contain: paint',
    );
    expect(
      containingBlockReason(createLayoutSnapshot({ containerType: 'inline-size' }), 'fixed'),
    ).toBe('container-type: inline-size');
  });

  it('ignores will-change values that do not create a containing block', () => {
    expect(
      containingBlockReason(createLayoutSnapshot({ willChange: 'opacity' }), 'fixed'),
    ).toBeNull();
    expect(containingBlockReason(createLayoutSnapshot(), 'absolute')).toBeNull();
  });
});

describe('snapshotLayoutStyle', () => {
  it('fills in CSS initial values for properties the style object lacks', () => {
    // Non-browser DOM implementations return undefined for anything modern;
    // "undefined" must never reach a UI label.
    const snapshot = snapshotLayoutStyle({ display: 'grid' } as CSSStyleDeclaration);

    expect(snapshot.display).toBe('grid');
    expect(snapshot.gridTemplateColumns).toBe('none');
    expect(snapshot.containerType).toBe('normal');
    expect(snapshot.flexShrink).toBe('1');
    for (const value of Object.values(snapshot)) expect(typeof value).toBe('string');
  });
});

describe('DOM wrappers', () => {
  it('skips display: contents ancestors when finding the layout parent', () => {
    const grid = document.createElement('div');
    const wrapper = document.createElement('div');
    const item = document.createElement('div');
    grid.append(wrapper);
    wrapper.append(item);

    const styles = new Map<Element, Partial<CSSStyleDeclaration>>([
      [grid, { display: 'grid' }],
      [wrapper, { display: 'contents' }],
      [item, { display: 'block' }],
    ]);

    expect(findLayoutParent(item, fakeView(styles))).toBe(grid);
  });

  it('walks up to the ancestor that actually anchors a fixed element', () => {
    const outer = document.createElement('div');
    const transformed = document.createElement('section');
    transformed.className = 'panel';
    const fixed = document.createElement('div');
    outer.append(transformed);
    transformed.append(fixed);

    const styles = new Map<Element, Partial<CSSStyleDeclaration>>([
      [outer, { display: 'block', position: 'relative' }],
      [transformed, { display: 'block', transform: 'translateY(4px)' }],
      [fixed, { display: 'block', position: 'fixed' }],
    ]);

    expect(resolveContainingBlock(fixed, 'fixed', fakeView(styles))).toEqual({
      kind: 'element',
      label: 'section.panel',
      reason: 'transform: translateY(4px)',
    });
  });

  it('falls back to the viewport and the initial containing block', () => {
    const parent = document.createElement('div');
    const child = document.createElement('div');
    parent.append(child);
    const styles = new Map<Element, Partial<CSSStyleDeclaration>>([
      [parent, { display: 'block' }],
      [child, { display: 'block' }],
    ]);

    expect(resolveContainingBlock(child, 'fixed', fakeView(styles))).toMatchObject({
      kind: 'viewport',
    });
    expect(resolveContainingBlock(child, 'absolute', fakeView(styles))).toMatchObject({
      kind: 'initial-containing-block',
    });
    expect(resolveContainingBlock(child, 'static', fakeView(styles))).toMatchObject({
      kind: 'indeterminate',
    });
  });

  it('reads a real element end to end', () => {
    const grid = document.createElement('div');
    const item = document.createElement('div');
    grid.append(item, document.createElement('div'), document.createElement('div'));

    const styles = new Map<Element, Partial<CSSStyleDeclaration>>([
      [
        grid,
        {
          display: 'grid',
          gridTemplateColumns: '200px 200px',
          columnGap: '24px',
          rowGap: '24px',
        },
      ],
      [item, { display: 'block', gridColumnStart: '1', gridColumnEnd: '3' }],
    ]);
    const view = fakeView(styles);

    const anatomy = readContainerAnatomy(item, view);
    expect(anatomy.placement.kind).toBe('grid-item');
    expect(anatomy.placement.grid?.column).toBe('1 / 3');
    expect(anatomy.placement.parentDisplay).toBe('grid');

    const container = readContainerAnatomy(grid, view);
    expect(container.childLayout.grid?.explicitColumnCount).toBe(2);
    expect(container.childLayout.grid?.columnGap).toBe(24);
    // Three children in a two-column grid means a second, implicit row.
    expect(container.childLayout.grid?.implicitTracks).toMatchObject({ kind: 'likely' });
  });
});

describe('createLayoutSnapshot', () => {
  it('starts from CSS initial values, not from a browser default', () => {
    const snapshot: LayoutStyleSnapshot = createLayoutSnapshot();
    expect(snapshot.display).toBe('inline');
    expect(snapshot.position).toBe('static');
    expect(snapshot.columnGap).toBe('normal');
  });
});
