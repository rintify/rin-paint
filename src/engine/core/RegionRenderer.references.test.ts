// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaintEngine } from '../PaintEngine';
import { createShapeLayer } from '../layers';
import { layerHandler } from '../layer-types/registry';
import { RegionRenderer } from './RegionRenderer';

afterEach(() => vi.restoreAllMocks());

describe('resolved render views', () => {
  it.each([true, false])('uses linked visibility (%s) in native and composite rendering', visible => {
    const engine = new PaintEngine();
    const source = createShapeLayer('source', {
      kind: 'rect', x: 0, y: 0, width: 20, height: 10, color: '#111111', strokeWidth: 2, paintMode: 'fill-inside',
    }, 'source');
    const target = createShapeLayer('target', { ...source.state.shape }, 'target');
    source.visible = visible;
    target.visible = !visible;
    engine.pages.activePageId = 'p1';
    engine.pages.pageOrder = ['p1'];
    engine.layerService.layers = [source, target];
    engine.layerService.rootLayerIds = [target.id];
    engine.links.createPasteLink(target.id, { pageId: 'p1', layerId: source.id });
    const draw = vi.spyOn(layerHandler(target).renderer, 'draw').mockImplementation(() => {});
    const canvas = document.createElement('canvas');
    const ctx = { save() {}, restore() {}, setTransform() {}, clearRect() {}, drawImage() {} } as unknown as CanvasRenderingContext2D;
    const renderer = new RegionRenderer({
      engine,
      drawEnv: () => engine.compositor.drawEnv(false),
      borrowCanvas: () => ({ canvas, ctx, release() {} }),
      sequenceVisibleBounds: () => null,
    });
    renderer.renderNativeInWorld(ctx);
    expect(draw).toHaveBeenCalledTimes(visible ? 1 : 0);
    draw.mockClear();
    renderer.render({ x: 0, y: 0, w: 100, h: 100 }, null, false).release();
    expect(draw).toHaveBeenCalledTimes(visible ? 1 : 0);
    expect(target.visible).toBe(!visible);
  });
});
