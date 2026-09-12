import { describe, expect, it, vi } from 'vitest';
import type { PaintEngine } from '../../engine/PaintEngine';
import { ShapeTool } from './tool';

describe('ShapeTool overlay invalidation', () => {
  it('requests an overlay frame while a drag preview changes and when it is cancelled', () => {
    const requestOverlayRender = vi.fn();
    const engine = {
      requestOverlayRender,
      activeToolSettings: () => ({ color: '#000', sizePx: 2, settings: {} }),
      getCanvasSpec: () => ({ ppi: 96 }),
      artboard: { w: 100, h: 100 },
    } as unknown as PaintEngine;
    const tool = new ShapeTool(engine, 'rect');
    const point = (x: number, y: number) => ({ x, y, pressure: 1 });

    tool.onDown(point(10, 10));
    tool.onMove(point(30, 25));
    tool.cancel();

    expect(requestOverlayRender).toHaveBeenCalledTimes(3);
  });
});
