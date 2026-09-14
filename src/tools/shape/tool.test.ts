import { describe, expect, it, vi } from 'vitest';
import type { PaintEngine } from '../../engine/PaintEngine';
import { ShapeTool } from './tool';

describe('ShapeTool overlay invalidation', () => {
  it('requests an overlay frame while a drag preview changes and when it is cancelled', () => {
    const requestOverlayRender = vi.fn();
    const engine = {
      requestOverlayRender,
      activeToolSettings: () => ({ color: '#000', sizePx: 2, settings: {} }),
      getPageSpec: () => ({ ppi: 96 }),
      artboard: { w: 100, h: 100 },
      uiScale: () => 1,
    } as unknown as PaintEngine;
    const tool = new ShapeTool(engine, 'rect');
    const point = (x: number, y: number) => ({ x, y, pressure: 1 });

    tool.onDown(point(10, 10));
    tool.onMove(point(30, 25));
    tool.cancel();

    expect(requestOverlayRender).toHaveBeenCalledTimes(3);
  });

  it('applies the active corner settings to a newly created rectangle', () => {
    const addShapeLayer = vi.fn();
    const engine = {
      requestOverlayRender: vi.fn(),
      addShapeLayer,
      activeToolSettings: () => ({
        color: '#123456', sizePx: 2,
        settings: { paintMode: 'stroke', strokeJoin: 'miter', cornerRadiusMm: 3.5 },
      }),
      getPageSpec: () => ({ ppi: 25.4 }),
      artboard: { w: 100, h: 100 },
      uiScale: () => 1,
    } as unknown as PaintEngine;
    const tool = new ShapeTool(engine, 'rect');
    const point = (x: number, y: number) => ({ x, y, pressure: 1 });
    tool.onDown(point(10, 10));
    tool.onUp(point(30, 25));
    expect(addShapeLayer).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'rect', strokeJoin: 'miter', cornerRadius: 3.5,
    }));
  });
});
