import type { RasterLayer, Layer } from '../layers';
import { RasterSurface } from '../raster/RasterSurface';
import { RasterResampler } from '../raster/RasterResampler';
import { emptyCatalog } from '../parameters/catalog';
import type { LayerDefinition } from './definition';
export const rasterLayerType: LayerDefinition<'raster'> = {
  info: {
    type: 'raster',
    canMask: true,
    maskSourceLabel: 'ラスター',
    supportsBlend: true,
    defaultName: (index) => `レイヤー ${index}`,
  },
  state: {
    initial: () => ({}),
    clone: () => ({}),
    normalize: () => ({}),
    applyPatch: () => ({}),
    scale: () => ({}),
  },
  codec: {
    encode: () => ({}),
    decode: () => ({}),
    async encodeContent(layer) {
      return layer.runtime.surface.snapshot();
    },
    async decodeRuntime(content) {
      if (!content) return { surface: new RasterSurface() };
      if (content instanceof Blob || content instanceof HTMLCanvasElement)
        throw new Error('対応していないラスター形式です');
      return { surface: await RasterSurface.restore(content) };
    },
  },
  renderer: {
    draw(ctx, layer, env) {
      const region = env.outputRegion;
      const erasers = layer.childIds
        .map((id) => env.layerById(id))
        .filter(
          (child): child is Layer =>
            !!child &&
            child.visible &&
            !!env.handlerFor(child).renderer.eraser?.applies(child as never),
        );
      ctx.save();
      try {
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blend;
        if (erasers.length) {
          const work = env.borrowCanvas(region.w, region.h);
          try {
            work.ctx.translate(-region.x, -region.y);
            layer.runtime.surface.drawRegion(work.ctx, region);
            for (const eraser of erasers)
              env
                .handlerFor(eraser)
                .renderer.eraser!.draw(work.ctx, eraser as never, env);
            ctx.drawImage(
              work.canvas,
              0,
              0,
              region.w,
              region.h,
              region.x,
              region.y,
              region.w,
              region.h,
            );
          } finally {
            work.release();
          }
        } else layer.runtime.surface.drawRegion(ctx, region);
        env.drawAboveLayer?.(ctx, layer.id);
      } finally {
        ctx.restore();
      }
    },
    drawMask(ctx, layer, env) {
      layer.runtime.surface.drawRegion(ctx, env.outputRegion);
    },
    contentCanvas: () => null,
  },
  parameters: emptyCatalog(),
  capabilities: { maskSource: { drawOpacity: (layer) => layer.opacity } },
};
export function scaleRasterRuntime(
  layer: RasterLayer,
  factor: number,
  _width: number,
  _height: number,
): void {
  if (factor !== 1)
    layer.runtime.surface = RasterResampler.scale(
      layer.runtime.surface,
      factor,
    );
}
