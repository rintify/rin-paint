import { DEFAULT_ADJUST, type AdjustParams } from '../../model';
import { buildFilter, createAdjustLayer, type AdjustLayer } from '../layers';
import type { LayerParameterDescriptor, LayerParameterLayer, LayerTypeHandler } from './types';

function adjustOf(layer: LayerParameterLayer): AdjustParams {
  if (layer.type !== 'adjust' || !layer.params) throw new Error('Adjustment parameter applied to another layer');
  return layer.params;
}

const SLIDERS = [
  ['brightness', '明度', 0, 200],
  ['contrast', 'コントラスト', 0, 200],
  ['hue', '色相', -180, 180],
  ['saturation', '彩度', 0, 200],
] as const;

/** 色調補正レイヤー: 下の合成結果に CSS フィルターを掛けて重ねる。 */
export const adjustLayerType: LayerTypeHandler<AdjustLayer> = {
  type: 'adjust',
  canMask: false,
  maskSourceLabel: null,
  supportsBlend: false,

  defaultName: (index) => `色調補正 ${index}`,

  snapshot(layer, snapshot) {
    snapshot.params = { ...layer.params };
    snapshot.maskLayerIds = [...layer.maskLayerIds];
  },

  async restore(source, env) {
    const layer = createAdjustLayer(env.name, source.id);
    layer.params = { ...DEFAULT_ADJUST, ...(source.params ?? {}) };
    layer.maskLayerIds = [...(source.maskLayerIds ?? [])];
    return layer;
  },

  async toSaved(layer) {
    return { params: { ...layer.params }, maskLayerIds: [...layer.maskLayerIds] };
  },

  applyProps(layer, props) {
    if (props.params !== undefined) layer.params = { ...props.params };
    if (props.maskLayerIds !== undefined) layer.maskLayerIds = [...props.maskLayerIds];
  },
  captureProps: (layer) => ({ params: { ...layer.params }, maskLayerIds: [...layer.maskLayerIds] }),

  scale() {},
  async scaleStored() {},

  draw(ctx, layer, env) {
    if (!env.backdrop) return;
    const { w, h } = env.artboard;
    const work = env.workCtx('adjust');
    work.save();
    work.clearRect(0, 0, w, h);
    work.filter = buildFilter(layer.params);
    work.drawImage(env.backdrop, 0, 0);
    work.restore();
    if (layer.maskLayerIds.length) {
      const mask = env.workCtx('adjust-mask');
      mask.save();
      mask.clearRect(0, 0, w, h);
      mask.globalCompositeOperation = 'source-over';
      for (const id of layer.maskLayerIds) {
        const source = env.layerById(id);
        if (!source?.visible) continue;
        const handler = env.handlerFor(source);
        if (!handler.drawMask) continue;
        mask.globalAlpha = source.opacity;
        handler.drawMask(mask, source, env);
      }
      mask.restore();
      work.save();
      work.globalCompositeOperation = 'destination-in';
      work.globalAlpha = 1;
      work.drawImage(mask.canvas, 0, 0);
      work.restore();
    }
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(work.canvas, 0, 0);
  },

  bakeOnto(target, layer, env) {
    const { w, h } = env.artboard;
    const work = env.workCtx('adjust');
    work.save();
    work.clearRect(0, 0, w, h);
    work.filter = buildFilter(layer.params);
    work.drawImage(target.canvas, 0, 0);
    work.restore();
    target.ctx.save();
    target.ctx.globalAlpha = layer.opacity;
    target.ctx.globalCompositeOperation = 'source-over';
    target.ctx.drawImage(work.canvas, 0, 0);
    target.ctx.restore();
  },

  contentCanvas: () => null,

  parameterDescriptors: () =>
    SLIDERS.map(([key, label, min, max]): LayerParameterDescriptor => ({
      key: `adjust.${key}`,
      label,
      control: 'number',
      min,
      max,
      read: (layer) => adjustOf(layer)[key],
      write: (layer, value) => ({ params: { ...adjustOf(layer), [key]: Number(value) } }),
    })),
};
