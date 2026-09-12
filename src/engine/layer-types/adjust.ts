import { DEFAULT_ADJUST, type AdjustParams } from '../../model';
import { buildFilter, createAdjustLayer, type AdjustLayer } from '../layers';
import { mixCanvases } from './effectUtils';
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

  draw() {},

  effect: {
    dependencyLayerIds: layer => layer.maskLayerIds,
    apply(scope, layer, env) {
      if (layer.opacity <= 0 || (
        layer.params.brightness === 100 && layer.params.contrast === 100 &&
        layer.params.hue === 0 && layer.params.saturation === 100
      )) return;
      const filtered = env.borrowCanvas();
      filtered.ctx.save();
      filtered.ctx.filter = buildFilter(layer.params);
      filtered.ctx.drawImage(scope.canvas, 0, 0);
      filtered.ctx.restore();
      const mask = layer.maskLayerIds.length ? env.maskCanvas(layer.maskLayerIds) : null;
      mixCanvases(scope, filtered.canvas, layer.opacity, mask);
      mask?.release();
      filtered.release();
    },
  },

  bakeOnto(target, layer, env) {
    const work = env.borrowCanvas();
    work.ctx.save();
    work.ctx.filter = buildFilter(layer.params);
    work.ctx.drawImage(target.canvas, 0, 0);
    work.ctx.restore();
    target.ctx.save();
    target.ctx.globalAlpha = layer.opacity;
    target.ctx.globalCompositeOperation = 'source-over';
    target.ctx.drawImage(work.canvas, 0, 0);
    target.ctx.restore();
    work.release();
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
