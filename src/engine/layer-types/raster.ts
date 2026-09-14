import {inverse, multiply} from '../geometry/homography';
import {rasterToScope} from '../core/RasterCoordinates';
import {paintProjectedDrawing} from '../raster/paintProjectedDrawing';
import {tileCoordinates} from '../raster/SparseRaster';
import { RasterSurface } from '../raster/RasterSurface';
import { transformLayerType } from './transform';
import type { LayerDefinition } from './definition';

export const rasterLayerType: LayerDefinition<'raster'> = {
  info: {type: 'raster', canMask: true, maskSourceLabel: 'ラスター', supportsBlend: true, defaultName: index => `レイヤー ${index}`},
  state: transformLayerType.state,
  codec: {
    encode: transformLayerType.codec.encode, decode: value => transformLayerType.codec.decode(value) ?? transformLayerType.state.initial(),
    encodeContent: layer => layer.runtime.surface.encode(),
    async decodeRuntime(content, env) {
      if (!content) return {surface: new RasterSurface(env.ppi ?? 300)};
      return {surface: await RasterSurface.decode(content)};
    },
  },
  renderer: {
    draw(ctx, layer, env) {
      ctx.globalAlpha = layer.opacity; ctx.globalCompositeOperation = layer.blend;
      layer.runtime.surface.drawAtPpi(ctx, env.ppi, layer.state.matrix); env.drawAboveLayer?.(ctx, layer.id);
    },
    drawMask(ctx, layer, env) {layer.runtime.surface.drawAtPpi(ctx, env.ppi, layer.state.matrix);},
    bakeOnto(target, layer, env) {
      const targetInverse = inverse(rasterToScope(target, env.ppi)); if (!targetInverse) return;
      const matrix = multiply(targetInverse, rasterToScope(layer, env.ppi));
      const regions = function* () {
        for (const key of layer.runtime.surface.snapshot().tiles.keys()) {
          const [x, y] = tileCoordinates(key); yield {x: x * 256, y: y * 256, w: 256, h: 256};
        }
      };
      paintProjectedDrawing(target.runtime.surface, regions(), matrix,
        (ctx, region) => layer.runtime.surface.drawTo(ctx, region), layer.opacity, layer.blend);
    },
    contentCanvas: (layer, env) => {
      const canvas = document.createElement('canvas'); canvas.width = env.artboard.w; canvas.height = env.artboard.h;
      layer.runtime.surface.drawAtPpi(canvas.getContext('2d')!, env.ppi, layer.state.matrix);
      return canvas;
    },
  },
  parameters: layer => typeof transformLayerType.parameters === 'function'
    ? transformLayerType.parameters({type: 'transform', state: layer.state}) : transformLayerType.parameters,
  capabilities: {maskSource: {drawOpacity: layer => layer.opacity}},
};
