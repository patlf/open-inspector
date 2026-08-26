import { describe, expect, it } from 'vitest';
import { buildBoxModel, readEdgeSizes } from './box-model.js';
import type { BoxEdges } from './box-model.js';
import type { Rect } from '../types.js';

const border: Rect = { x: 100, y: 50, width: 300, height: 200 };

const edges: BoxEdges = {
  margin: { top: 10, right: 20, bottom: 10, left: 20 },
  border: { top: 2, right: 2, bottom: 2, left: 2 },
  padding: { top: 16, right: 24, bottom: 16, left: 24 },
};

describe('buildBoxModel', () => {
  it('nests the four rectangles from outside in', () => {
    const box = buildBoxModel(border, edges);

    expect(box.margin).toEqual({ x: 80, y: 40, width: 340, height: 220 });
    expect(box.border).toEqual(border);
    expect(box.padding).toEqual({ x: 102, y: 52, width: 296, height: 196 });
    expect(box.content).toEqual({ x: 126, y: 68, width: 248, height: 164 });
  });

  it('clamps content to zero rather than going negative', () => {
    // A 4px-wide element with 10px of horizontal padding. Negative widths
    // would render as inverted overlay rectangles.
    const narrow: Rect = { x: 0, y: 0, width: 4, height: 4 };
    const fat: BoxEdges = {
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
    };

    const box = buildBoxModel(narrow, fat);

    expect(box.content.width).toBe(0);
    expect(box.content.height).toBe(0);
  });

  it('lets negative margins grow the margin box', () => {
    const pulled: BoxEdges = {
      margin: { top: -8, right: 0, bottom: 0, left: -8 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    };

    const box = buildBoxModel(border, pulled);

    expect(box.margin.x).toBe(108);
    expect(box.margin.width).toBe(292);
  });

  it('preserves the edges it was given', () => {
    expect(buildBoxModel(border, edges).edges).toEqual(edges);
  });
});

describe('readEdgeSizes', () => {
  it('parses pixel strings off a computed style', () => {
    const style = {
      marginTop: '10px',
      marginRight: '20px',
      marginBottom: '10px',
      marginLeft: '20px',
      borderTopWidth: '2px',
      borderRightWidth: '2px',
      borderBottomWidth: '2px',
      borderLeftWidth: '2px',
      paddingTop: '16px',
      paddingRight: '24px',
      paddingBottom: '16px',
      paddingLeft: '24px',
    } as CSSStyleDeclaration;

    expect(readEdgeSizes(style)).toEqual(edges);
  });

  it('treats keywords and empty values as zero, never NaN', () => {
    // `auto` margins and the `medium` border-width keyword both show up on
    // real elements. NaN here would poison every downstream rectangle.
    const style = {
      marginTop: 'auto',
      marginRight: '',
      marginBottom: 'auto',
      marginLeft: 'auto',
      borderTopWidth: 'medium',
      borderRightWidth: 'medium',
      borderBottomWidth: 'medium',
      borderLeftWidth: 'medium',
      paddingTop: '',
      paddingRight: '',
      paddingBottom: '',
      paddingLeft: '',
    } as CSSStyleDeclaration;

    const result = readEdgeSizes(style);

    for (const group of Object.values(result)) {
      for (const value of Object.values(group)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBe(0);
      }
    }
  });

  it('handles fractional pixel values from zoomed or scaled layouts', () => {
    const style = {
      marginTop: '0.5px',
      marginRight: '0px',
      marginBottom: '0px',
      marginLeft: '0px',
      borderTopWidth: '0.6666667px',
      borderRightWidth: '0px',
      borderBottomWidth: '0px',
      borderLeftWidth: '0px',
      paddingTop: '0px',
      paddingRight: '0px',
      paddingBottom: '0px',
      paddingLeft: '0px',
    } as CSSStyleDeclaration;

    const result = readEdgeSizes(style);

    expect(result.margin.top).toBeCloseTo(0.5);
    expect(result.border.top).toBeCloseTo(0.6666667);
  });
});
