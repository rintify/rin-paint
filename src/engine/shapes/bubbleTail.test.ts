import { describe, expect, it, vi } from 'vitest';
import type { BubbleTailShapeParams } from '../../model';
import { drawShapeGizmo, shapeBounds, shapePoints } from '.';
import { shapeKindHandler } from './kinds/registry';

function tail(style: BubbleTailShapeParams['style']): BubbleTailShapeParams {
  return {
    kind: 'bubble-tail', style,
    start: { x: 10, y: 20 }, control: { x: 60, y: 0 }, tip: { x: 110, y: 20 },
    width: 20, circleCount: 5, spacingDecay: .35, color: '#fff', strokeWidth: 0,
  };
}

describe('bubble tail geometry', () => {
  it('exposes only the root, curve control and tip handles', () => {
    expect(shapePoints(tail('pointed'))).toEqual([
      { x: 10, y: 20 }, { x: 60, y: 0 }, { x: 110, y: 20 },
    ]);
    const bounds = shapeBounds(tail('pointed'));
    expect(bounds.x).toBeLessThanOrEqual(10);
    expect(bounds.x + bounds.w).toBeGreaterThanOrEqual(110);
  });

  it('places the configured circles and shrinks the tip to thirty percent', () => {
    const arcs: number[][] = [];
    const context = {
      beginPath: vi.fn(), moveTo: vi.fn(), fill: vi.fn(),
      arc: (...args: number[]) => arcs.push(args),
    } as unknown as CanvasRenderingContext2D;
    shapeKindHandler(tail('rounds')).draw(context, tail('rounds'), { w: 200, h: 200 });
    expect(arcs).toHaveLength(5);
    expect(arcs[0][2]).toBeCloseTo(10);
    expect(arcs.at(-1)?.[2]).toBeCloseTo(3);
    const gaps = arcs.slice(1).map((arc, index) => Math.hypot(arc[0] - arcs[index][0], arc[1] - arcs[index][1]));
    expect(gaps[0]).toBeGreaterThan(gaps[1]);
    expect(gaps[1]).toBeGreaterThan(gaps[2]);
    expect(gaps[2]).toBeGreaterThan(gaps[3]);
  });

  it('draws a dedicated labeled curve gizmo without a bounding box', () => {
    const labels: string[] = [];
    const context = {
      save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), arc: vi.fn(),
      rect: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
      fillRect: vi.fn(), strokeRect: vi.fn(),
      measureText: (label: string) => ({ width: label.length * 10 }),
      fillText: (label: string) => labels.push(label),
    } as unknown as CanvasRenderingContext2D;

    drawShapeGizmo(context, tail('pointed'), { scale: 1 });

    expect(context.quadraticCurveTo).toHaveBeenCalledWith(60, 0, 110, 20);
    expect(labels).toEqual(['根元', '曲がり', '先端']);
    expect(context.strokeRect).not.toHaveBeenCalled();
  });
});
