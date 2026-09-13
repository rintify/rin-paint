import { canvasToBlob, createRasterLayer, ensureRasterSurface, makeCanvas, markRasterContent, type RasterLayer } from '../layers';
import { emptyCatalog } from '../parameters/catalog';
import type { LayerDefinition } from './definition';
import type { LayerDrawEnv } from './types';
import { SparseRasterSurface } from '../raster/SparseRasterSurface';

export const rasterLayerType: LayerDefinition<'raster'> = {
  info: {
    type: 'raster',
    canMask: true,
    maskSourceLabel: 'ラスター',
    supportsBlend: true,
    defaultName: index => `レイヤー ${index}`,
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
      if (layer.runtime.deferred) return undefined;
      if (layer.runtime.sparse) return layer.runtime.sparse.toBlob();
      const copy = makeCanvas(layer.runtime.canvas.width, layer.runtime.canvas.height);
      copy.getContext('2d')!.drawImage(layer.runtime.canvas, 0, 0);
      return canvasToBlob(copy);
    },
    async decodeRuntime(content, env) {
      const documentPpi = env.ppi ?? 300;
      const layer = createRasterLayer('tmp', env.pageFrame.w, env.pageFrame.h, undefined, !content, documentPpi);
      if (content instanceof HTMLCanvasElement) {
        layer.runtime.ctx.drawImage(content, 0, 0);
        markRasterContent(layer, { x: 0, y: 0, w: content.width, h: content.height }, documentPpi);
      }
      else if (content) {
        const sparse = await SparseRasterSurface.fromBlob(content);
        layer.runtime.sparse = sparse;
        sparse.drawDocumentTo(layer.runtime.ctx, { x: 0, y: 0, w: env.pageFrame.w, h: env.pageFrame.h }, documentPpi);
      }
      return layer.runtime;
    },
    async scaleStored(state, _env) {
      return state;
    },
  },

  renderer: {
    draw(ctx, layer, env) {
      if (layer.runtime.deferred) return;
      let source: HTMLCanvasElement = layer.runtime.canvas;
      let sourceOrigin = { x: 0, y: 0 };
      const borrowed: ReturnType<LayerDrawEnv['borrowCanvas']>[] = [];
      if (layer.runtime.sparse?.tileCount) {
        const region = env.borrowCanvas();
        layer.runtime.sparse.drawDocumentTo(region.ctx, {
          x: env.originX, y: env.originY,
          w: region.canvas.width, h: region.canvas.height,
        }, env.ppi);
        borrowed.push(region);
        source = region.canvas;
        sourceOrigin = { x: env.originX, y: env.originY };
      }
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(source, sourceOrigin.x, sourceOrigin.y);
      env.drawAboveLayer?.(ctx, layer.id);
      for (const lease of borrowed) lease.release();
    },
    drawMask(ctx, layer) {
      if (layer.runtime.deferred) return;
      ctx.drawImage(layer.runtime.canvas, 0, 0);
    },
    bakeOnto(target, layer) {
      if (layer.runtime.deferred) return;
      ensureRasterSurface(target);
      target.runtime.ctx.save();
      target.runtime.ctx.globalAlpha = layer.opacity;
      target.runtime.ctx.globalCompositeOperation = layer.blend;
      target.runtime.ctx.drawImage(layer.runtime.canvas, 0, 0);
      target.runtime.ctx.restore();
    },
    contentCanvas: layer => layer.runtime.deferred ? null : layer.runtime.canvas,
  },

  parameters: emptyCatalog(),

  capabilities: {
    maskSource: {
      nativeCanvas: layer => layer.runtime.deferred ? null : layer.runtime.canvas,
      drawOpacity: layer => layer.opacity,
    },
  },
};

export function scaleRasterRuntime(layer: RasterLayer, factor: number, width: number, height: number): void {
  if (layer.runtime.deferred) {
    layer.runtime.logicalWidth = width;
    layer.runtime.logicalHeight = height;
    return;
  }
  const contentBounds = layer.runtime.contentBounds;
  const sparse = layer.runtime.sparse?.resample(layer.runtime.sparse.ppi * factor);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('キャンバス用のメモリを確保できませんでした');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(layer.runtime.canvas, 0, 0, layer.runtime.canvas.width * factor, layer.runtime.canvas.height * factor);
  layer.runtime = {
    canvas,
    ctx,
    sparse,
    logicalWidth: width,
    logicalHeight: height,
    ...(contentBounds === null ? { contentBounds: null } : contentBounds ? {
      contentBounds: {
        x: contentBounds.x * factor,
        y: contentBounds.y * factor,
        w: contentBounds.w * factor,
        h: contentBounds.h * factor,
      },
    } : {}),
  };
}
