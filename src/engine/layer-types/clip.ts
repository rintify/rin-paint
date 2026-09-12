import { createClipLayer, type ClipLayer } from '../layers';
import { applyClip } from './effectUtils';
import type { LayerTypeHandler } from './types';

export const clipLayerType: LayerTypeHandler<ClipLayer> = {
  type: 'clip', canMask: false, maskSourceLabel: null, supportsBlend: false,
  defaultName: index => `クリップ ${index}`,
  snapshot(layer, snapshot) { snapshot.maskLayerIds = [...layer.maskLayerIds]; },
  async restore(source, env) {
    const layer = createClipLayer(env.name, source.id);
    layer.maskLayerIds = [...(source.maskLayerIds ?? [])];
    return layer;
  },
  async toSaved(layer) { return { maskLayerIds: [...layer.maskLayerIds] }; },
  applyProps(layer, props) { if (props.maskLayerIds) layer.maskLayerIds = [...props.maskLayerIds]; },
  captureProps: layer => ({ maskLayerIds: [...layer.maskLayerIds] }),
  scale() {}, async scaleStored() {},
  draw() {},
  effect: {
    apply(scope, layer, env) {
      if (!layer.maskLayerIds.length || layer.opacity <= 0) return;
      const mask = env.maskCanvas(layer.maskLayerIds);
      if (mask) {
        applyClip(scope, mask.canvas, layer.opacity);
        mask.release();
      }
    },
  },
  bakeOnto() {}, contentCanvas: () => null, parameterDescriptors: () => [],
};
