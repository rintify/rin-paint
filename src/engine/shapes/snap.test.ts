import { describe, expect, it } from 'vitest';
import { shapeFromDrag } from './index';
import {
  boundsAnchors,
  collectSnapLines,
  constrainAxisAlignedAspect,
  constrainVertexToEdges,
  projectPointToInfiniteLine,
  snapAngleToRightAngles,
  snapTranslation,
} from './snap';

const p = (x: number, y: number) => ({ x, y, pressure: 1 });
const deg = (value: number) => value * Math.PI / 180;

describe('axis-aligned aspect constraint', () => {
  it('makes rect and ellipse drags 1:1 in both directions', () => {
    const start = p(10, 20);
    expect(shapeFromDrag('rect', start, constrainAxisAlignedAspect(start, p(18, 25)), '#000', 4)).toMatchObject({
      x: 10, y: 20, width: 8, height: 8,
    });
    expect(shapeFromDrag('rect', start, constrainAxisAlignedAspect(start, p(2, 15)), '#000', 4)).toMatchObject({
      x: 2, y: 12, width: 8, height: 8,
    });
    expect(shapeFromDrag('ellipse', start, constrainAxisAlignedAspect(start, p(18, 25)), '#000', 4)).toMatchObject({
      cx: 14, cy: 24, rx: 4, ry: 4,
    });
    expect(shapeFromDrag('ellipse', start, constrainAxisAlignedAspect(start, p(2, 15)), '#000', 4)).toMatchObject({
      cx: 6, cy: 16, rx: 4, ry: 4,
    });
  });

  it('creates a square or circle from a horizontal or vertical drag', () => {
    const start = p(10, 20);
    expect(shapeFromDrag('rect', start, constrainAxisAlignedAspect(start, p(18, 20)), '#000', 4)).toMatchObject({
      x: 10, y: 20, width: 8, height: 8,
    });
    expect(shapeFromDrag('rect', start, constrainAxisAlignedAspect(start, p(10, 12)), '#000', 4)).toMatchObject({
      x: 10, y: 12, width: 8, height: 8,
    });
    expect(shapeFromDrag('ellipse', start, constrainAxisAlignedAspect(start, p(2, 20)), '#000', 4)).toMatchObject({
      cx: 6, cy: 24, rx: 4, ry: 4,
    });
  });

  it('keeps the free aspect ratio when unconstrained', () => {
    expect(shapeFromDrag('rect', p(10, 20), p(18, 25), '#000', 4)).toMatchObject({ x: 10, y: 20, width: 8, height: 5 });
    expect(shapeFromDrag('ellipse', p(10, 20), p(18, 25), '#000', 4)).toMatchObject({ cx: 14, cy: 22.5, rx: 4, ry: 2.5 });
  });
});

describe('position snap', () => {
  const artboard = { w: 200, h: 100 };

  it('snaps left/center/right to canvas and other-shape X lines', () => {
    const lines = collectSnapLines(artboard, [{ x: 80, y: 0, w: 20, h: 10 }]);
    expect(snapTranslation({ x: 5, y: 0, w: 10, h: 8 }, 0, 0, lines, 8)).toMatchObject({ dx: -5, xGuide: 0 });
    expect(snapTranslation({ x: 93, y: 0, w: 10, h: 8 }, 0, 0, lines, 8)).toMatchObject({ dx: 2, xGuide: 100 });
    expect(snapTranslation({ x: 186, y: 0, w: 10, h: 8 }, 0, 0, lines, 8)).toMatchObject({ dx: 4, xGuide: 200 });
    expect(snapTranslation({ x: 76, y: 0, w: 60, h: 8 }, 0, 0, lines, 8)).toMatchObject({ dx: 4, xGuide: 80 });
    expect(snapTranslation({ x: 86, y: 0, w: 6, h: 8 }, 0, 0, lines, 8)).toMatchObject({ dx: 1, xGuide: 90 });
    expect(snapTranslation({ x: 70, y: 0, w: 28, h: 8 }, 0, 0, lines, 8)).toMatchObject({ dx: 2, xGuide: 100 });
  });

  it('snaps top/center/bottom to canvas and other-shape Y lines', () => {
    const lines = collectSnapLines(artboard, [{ x: 0, y: 40, w: 10, h: 20 }]);
    expect(snapTranslation({ x: 0, y: 5, w: 8, h: 10 }, 0, 0, lines, 8)).toMatchObject({ dy: -5, yGuide: 0 });
    expect(snapTranslation({ x: 0, y: 46, w: 8, h: 8 }, 0, 0, lines, 8)).toMatchObject({ dy: 0, yGuide: 50 });
    expect(snapTranslation({ x: 0, y: 86, w: 8, h: 10 }, 0, 0, lines, 8)).toMatchObject({ dy: 4, yGuide: 100 });
    expect(snapTranslation({ x: 0, y: 37, w: 8, h: 80 }, 0, 0, lines, 8)).toMatchObject({ dy: 3, yGuide: 40 });
    expect(snapTranslation({ x: 0, y: 10, w: 8, h: 48 }, 0, 0, lines, 8)).toMatchObject({ dy: 2, yGuide: 60 });
  });

  it('can snap X and Y to different targets at once', () => {
    const lines = collectSnapLines(artboard, [{ x: 80, y: 40, w: 20, h: 20 }]);
    const result = snapTranslation({ x: 4, y: 36, w: 10, h: 80 }, 0, 0, lines, 8);
    expect(result).toMatchObject({ dx: -4, dy: 4, xGuide: 0, yGuide: 40 });
  });

  it('snaps only within the tolerance', () => {
    const lines = collectSnapLines(artboard, []);
    expect(snapTranslation({ x: 8, y: 8, w: 10, h: 10 }, 0, 0, lines, 8)).toMatchObject({ dx: -8, dy: -8, xGuide: 0, yGuide: 0 });
    expect(snapTranslation({ x: 9, y: 9, w: 10, h: 10 }, 0, 0, lines, 8)).toMatchObject({ dx: 0, dy: 0, xGuide: null, yGuide: null });
  });

  it('prefers the smallest correction, then the canvas', () => {
    const start = { x: 10, y: 0, w: 0, h: 10 };
    const layerCloser = collectSnapLines(artboard, [{ x: 18, y: 0, w: 0, h: 10 }]);
    expect(snapTranslation(start, 0, 0, layerCloser, 12)).toMatchObject({ dx: 8, xGuide: 18 });
    const tied = collectSnapLines(artboard, [{ x: 20, y: 0, w: 0, h: 10 }]);
    expect(snapTranslation(start, 0, 0, tied, 12)).toMatchObject({ dx: -10, xGuide: 0 });
  });

  it('exposes left/center/right anchors from a bounding box', () => {
    expect(boundsAnchors({ x: 10, y: 20, w: 40, h: 30 })).toEqual({
      x: [10, 30, 50],
      y: [20, 35, 50],
    });
  });
});

describe('rotation snap', () => {
  it('snaps 85/90/95 degrees to 90 and leaves 84/96 free', () => {
    expect(snapAngleToRightAngles(deg(85))).toMatchObject({ angle: deg(90), snapped: true });
    expect(snapAngleToRightAngles(deg(90))).toMatchObject({ angle: deg(90), snapped: true });
    expect(snapAngleToRightAngles(deg(95))).toMatchObject({ angle: deg(90), snapped: true });
    expect(snapAngleToRightAngles(deg(84))).toMatchObject({ angle: deg(84), snapped: false });
    expect(snapAngleToRightAngles(deg(96))).toMatchObject({ angle: deg(96), snapped: false });
  });

  it('picks the nearest right angle for negative and wrap-around values', () => {
    expect(snapAngleToRightAngles(deg(-5)).snapped).toBe(true);
    expect(snapAngleToRightAngles(deg(-5)).angle).toBeCloseTo(0);
    expect(snapAngleToRightAngles(deg(-85)).angle).toBeCloseTo(deg(-90));
    expect(snapAngleToRightAngles(deg(355)).angle).toBeCloseTo(deg(360));
    expect(snapAngleToRightAngles(deg(275)).angle).toBeCloseTo(deg(270));
    expect(snapAngleToRightAngles(deg(365)).angle).toBeCloseTo(deg(360));
  });
});

describe('polygon vertex edge constraint', () => {
  const selected = { x: 0, y: 0 };
  const prev = { x: 0, y: 40 };
  const next = { x: 40, y: 0 };

  it('projects onto the nearer of the two adjacent edges and switches as the pointer moves', () => {
    expect(constrainVertexToEdges({ x: 10, y: 2 }, prev, selected, next)).toEqual({ x: 10, y: 0 });
    expect(constrainVertexToEdges({ x: 2, y: 10 }, prev, selected, next)).toEqual({ x: 0, y: 10 });
  });

  it('allows movement past the segment onto the infinite extension', () => {
    expect(constrainVertexToEdges({ x: 80, y: 1 }, prev, selected, next)).toEqual({ x: 80, y: 0 });
    expect(constrainVertexToEdges({ x: 1, y: -20 }, prev, selected, next)).toEqual({ x: 0, y: -20 });
  });

  it('uses world-space edge directions for a rotated polygon', () => {
    const rotatedPrev = { x: 0, y: 0 };
    const rotatedSelected = { x: 3, y: 4 };
    const rotatedNext = { x: 7, y: 1 };
    const alongPrev = constrainVertexToEdges({ x: 1.2, y: 1.6 }, rotatedPrev, rotatedSelected, rotatedNext);
    expect(alongPrev.x).toBeCloseTo(1.2);
    expect(alongPrev.y).toBeCloseTo(1.6);
    const alongNext = constrainVertexToEdges({ x: 5, y: 2.5 }, rotatedPrev, rotatedSelected, rotatedNext);
    expect(alongNext.x).toBeCloseTo(5);
    expect(alongNext.y).toBeCloseTo(2.5);
  });

  it('falls back to free movement and never returns NaN for a zero-length edge', () => {
    expect(projectPointToInfiniteLine({ x: 3, y: 4 }, { x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
    const free = constrainVertexToEdges({ x: 8, y: 9 }, { x: 2, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 2 });
    expect(free).toEqual({ x: 8, y: 9 });
    expect(Number.isFinite(free.x) && Number.isFinite(free.y)).toBe(true);
    expect(constrainVertexToEdges({ x: 5, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 5, y: 0 });
  });

  it('prefers the previous-vertex edge when distances are equal', () => {
    expect(constrainVertexToEdges({ x: 5, y: 5 }, prev, selected, next)).toEqual({ x: 0, y: 5 });
  });
});
