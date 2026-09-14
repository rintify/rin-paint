import { canvasToBlob, createRasterLayer, ensureRasterSurface, makeCanvas, type Layer, type RasterLayer } from '../layers';
import { emptyCatalog } from '../parameters/catalog';
import type { LayerDefinition } from './definition';
import type { LayerDrawEnv } from './types';

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
      const copy = makeCanvas(layer.runtime.canvas.width, layer.runtime.canvas.height);
      copy.getContext('2d')!.drawImage(layer.runtime.canvas, 0, 0);
      return canvasToBlob(copy);
    },
    async decodeRuntime(content, env) {
      const layer = createRasterLayer('tmp', env.artboard.w, env.artboard.h, undefined, !content);
      if (content instanceof HTMLCanvasElement) layer.runtime.ctx.drawImage(content, 0, 0);
      else if (content) {
        const bitmap = await createImageBitmap(content);
        layer.runtime.ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
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
      const erasers = layer.childIds
        .map(id => env.layerById(id))
        .filter((child): child is Layer => !!child && child.visible && !!env.handlerFor(child).renderer.eraser?.applies(child as never));
      let source: HTMLCanvasElement = layer.runtime.canvas;
      let borrowed: ReturnType<LayerDrawEnv['borrowCanvas']> | null = null;
      if (erasers.length) {
        borrowed = env.borrowCanvas();
        borrowed.ctx.save();
        borrowed.ctx.setTransform(1, 0, 0, 1, -env.originX, -env.originY);
        borrowed.ctx.drawImage(layer.runtime.canvas, 0, 0);
        for (const eraser of erasers) env.handlerFor(eraser).renderer.eraser!.draw(borrowed.ctx, eraser as never, env);
        borrowed.ctx.restore();
        source = borrowed.canvas;
      }
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(source, borrowed ? env.originX : 0, borrowed ? env.originY : 0);
      env.drawAboveLayer?.(ctx, layer.id);
      borrowed?.release();
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
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('キャンバス用のメモリを確保できませんでした');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(layer.runtime.canvas, 0, 0, layer.runtime.canvas.width * factor, layer.runtime.canvas.height * factor);
  layer.runtime = {
    canvas,
    ctx,
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
