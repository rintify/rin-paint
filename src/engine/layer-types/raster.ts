import { canvasToBlob, createRasterLayer, makeCanvas, type Layer, type RasterLayer } from '../layers';
import type { LayerDrawEnv, LayerTypeHandler } from './types';

/** ラスターレイヤー: ピクセル内容そのものを持つ唯一の種別。 */
export const rasterLayerType: LayerTypeHandler<RasterLayer> = {
  type: 'raster',
  canMask: true,
  maskSourceLabel: 'ラスター',
  supportsBlend: true,

  defaultName: (index) => `レイヤー ${index}`,

  snapshot(layer, snapshot, env) {
    if (!env.withContent) return;
    const copy = makeCanvas(env.artboard.w, env.artboard.h);
    copy.getContext('2d')!.drawImage(layer.canvas, 0, 0);
    snapshot.canvas = copy;
    if (env.keepCanvas) return;
    void canvasToBlob(copy).then((blob) => {
      snapshot.blob = blob;
      snapshot.canvas = undefined;
      env.onEncoded();
    });
  },

  async restore(source, env) {
    const layer = createRasterLayer(env.name, env.artboard.w, env.artboard.h, source.id);
    if (source.canvas) {
      layer.ctx.drawImage(source.canvas, 0, 0);
    } else if (source.blob) {
      const bitmap = await createImageBitmap(source.blob);
      layer.ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    }
    return layer;
  },

  async toSaved(layer, env) {
    // 呼び出し直後に同期でコピーするので、PNG 化を待つ間の描画とは競合しない。
    const copy = makeCanvas(env.artboard.w, env.artboard.h);
    copy.getContext('2d')!.drawImage(layer.canvas, 0, 0);
    return { blob: await canvasToBlob(copy) };
  },

  applyProps() {},
  captureProps: () => ({}),

  scale(layer, factor, env) {
    const canvas = makeCanvas(env.width, env.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('キャンバス用のメモリを確保できませんでした');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(layer.canvas, 0, 0, layer.canvas.width * factor, layer.canvas.height * factor);
    layer.canvas = canvas;
    layer.ctx = ctx;
  },

  async scaleStored(source, env) {
    if (!source.blob) return;
    const bitmap = await createImageBitmap(source.blob);
    const canvas = makeCanvas(env.artboard.w, env.artboard.h);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, bitmap.width * env.factor, bitmap.height * env.factor);
    bitmap.close();
    source.canvas = canvas;
    source.blob = undefined;
  },

  draw(ctx, layer, env) {
    const erasers = layer.childIds
      .map((id) => env.layerById(id))
      .filter((child): child is Layer => !!child && child.visible && !!env.handlerFor(child).eraser?.applies(child));
    let source: HTMLCanvasElement = layer.canvas;
    let borrowed: ReturnType<LayerDrawEnv['borrowCanvas']> | null = null;
    if (erasers.length) {
      borrowed = env.borrowCanvas();
      borrowed.ctx.save();
      borrowed.ctx.drawImage(layer.canvas, 0, 0);
      for (const eraser of erasers) env.handlerFor(eraser).eraser!.draw(borrowed.ctx, eraser, env);
      borrowed.ctx.restore();
      source = borrowed.canvas;
    }
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend;
    ctx.drawImage(source, 0, 0);
    env.drawAboveLayer?.(ctx, layer.id);
    borrowed?.release();
  },

  drawMask(ctx, layer) {
    ctx.drawImage(layer.canvas, 0, 0);
  },

  bakeOnto(target, layer) {
    target.ctx.save();
    target.ctx.globalAlpha = layer.opacity;
    target.ctx.globalCompositeOperation = layer.blend;
    target.ctx.drawImage(layer.canvas, 0, 0);
    target.ctx.restore();
  },

  contentCanvas: (layer) => layer.canvas,

  parameterDescriptors: () => [],
};
