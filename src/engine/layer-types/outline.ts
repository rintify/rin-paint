import { DEFAULT_OUTLINE, type OutlineParams } from '../../model';
import { SIZE_MM_MAX, SIZE_MM_MIN, roundMm } from '../units';
import { createOutlineLayer, type OutlineLayer } from '../layers';
import { applyOutline } from './effectUtils';
import type { LayerParameterLayer, LayerTypeHandler } from './types';

function outlineOf(layer: LayerParameterLayer): OutlineParams {
  if (layer.type !== 'outline' || !layer.outline) throw new Error('Outline parameter applied to another layer');
  return layer.outline;
}

function normalize(value: Partial<OutlineParams> | undefined): OutlineParams {
  const width = Number(value?.widthMm);
  const threshold = Number(value?.alphaThreshold);
  return {
    color: typeof value?.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color)
      ? value.color : DEFAULT_OUTLINE.color,
    widthMm: Number.isFinite(width)
      ? roundMm(Math.max(SIZE_MM_MIN, Math.min(SIZE_MM_MAX, width)))
      : DEFAULT_OUTLINE.widthMm,
    alphaThreshold: Number.isFinite(threshold)
      ? Math.max(0, Math.min(1, threshold))
      : DEFAULT_OUTLINE.alphaThreshold,
    cornerStyle: value?.cornerStyle === 'sharp' ? 'sharp' : 'round',
  };
}

export const outlineLayerType: LayerTypeHandler<OutlineLayer> = {
  type: 'outline', canMask: true, maskSourceLabel: '縁どり', supportsBlend: false,
  defaultName: index => `縁どり ${index}`,
  snapshot(layer, snapshot) { snapshot.outline = { ...layer.outline }; },
  async restore(source, env) {
    const layer = createOutlineLayer(env.name, source.id);
    layer.outline = normalize(source.outline);
    return layer;
  },
  async toSaved(layer) { return { outline: { ...layer.outline } }; },
  applyProps(layer, props) { if (props.outline) layer.outline = normalize(props.outline); },
  captureProps: layer => ({ outline: { ...layer.outline } }),
  scale() {}, async scaleStored() {},
  draw() {},
  drawMask(ctx, layer, env) {
    env.drawEffectContribution(ctx, layer.id);
  },
  effect: {
    paddingPx(layer, env) {
      return Math.ceil(layer.outline.widthMm * env.ppi / 25.4 + 1);
    },
    apply(scope, layer, env) {
      applyOutline(scope, layer.id, layer.outline.color, layer.outline.widthMm, layer.outline.alphaThreshold, layer.outline.cornerStyle ?? 'round', layer.opacity, env);
    },
  },
  bakeOnto() {}, contentCanvas: () => null,
  parameterDescriptors: () => [
    {
      key: 'outline.color', semanticId: 'appearance.color', label: '縁の色', control: 'color',
      read: layer => outlineOf(layer).color,
      write: (layer, value) => ({ outline: { ...outlineOf(layer), color: String(value) } }),
    },
    {
      key: 'outline.widthMm', semanticId: 'appearance.widthMm', label: '太さ (mm)', control: 'number', min: SIZE_MM_MIN, max: SIZE_MM_MAX,
      read: layer => outlineOf(layer).widthMm,
      write: (layer, value) => ({ outline: { ...outlineOf(layer), widthMm: roundMm(Number(value)) } }),
    },
    {
      key: 'outline.alphaThreshold', semanticId: 'outline.alphaThreshold', label: '透明度閾値 (%)', control: 'number', min: 0, max: 100,
      read: layer => Math.round(outlineOf(layer).alphaThreshold * 100),
      write: (layer, value) => ({ outline: { ...outlineOf(layer), alphaThreshold: Number(value) / 100 } }),
    },
    {
      key: 'outline.cornerStyle', semanticId: 'appearance.cornerStyle', label: '縁の角', control: 'select',
      options: [{ value: 'round', label: '丸' }, { value: 'sharp', label: '角' }],
      read: layer => outlineOf(layer).cornerStyle ?? 'round',
      write: (layer, value) => ({ outline: { ...outlineOf(layer), cornerStyle: value === 'sharp' ? 'sharp' : 'round' } }),
    },
  ],
};
