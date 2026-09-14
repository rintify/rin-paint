import { DEFAULT_ADJUST, type AdjustParams, type AdjustState } from '../../model';
import { buildFilter, createAdjustLayer } from '../layers';
import { buildCatalog } from '../parameters/catalog';
import type { LayerDefinition } from './definition';
import { mixCanvases } from './effectUtils';

function cloneState(state: AdjustState): AdjustState {
  return { params: { ...state.params }, maskLayerIds: [...state.maskLayerIds] };
}

function asAdjustState(value: unknown): AdjustState {
  const record = value && typeof value === 'object' ? value as { params?: Partial<AdjustParams>; maskLayerIds?: unknown } : {};
  const maskLayerIds = Array.isArray(record.maskLayerIds)
    ? record.maskLayerIds.filter((id): id is string => typeof id === 'string')
    : [];
  return { params: { ...DEFAULT_ADJUST, ...(record.params ?? {}) }, maskLayerIds };
}

const SLIDERS = [
  ['brightness', '明度', 0, 200],
  ['contrast', 'コントラスト', 0, 200],
  ['hue', '色相', -180, 180],
  ['saturation', '彩度', 0, 200],
] as const;

const SURFACES = ['single', 'multi', 'link'] as const;

export const adjustLayerType: LayerDefinition<'adjust'> = {
  info: {
    type: 'adjust',
    canMask: false,
    maskSourceLabel: null,
    supportsBlend: false,
    defaultName: index => `色調補正 ${index}`,
  },
  state: {
    initial: () => createAdjustLayer('tmp').state,
    clone: cloneState,
    normalize: cloneState,
    applyPatch: (state, patch) => cloneState({ ...state, ...patch, params: { ...state.params, ...patch.params } }),
    scale: state => cloneState(state),
    remapReferences: (state, mapId) => ({
      ...cloneState(state),
      maskLayerIds: state.maskLayerIds.map(id => mapId(id)).filter((id): id is string => !!id),
    }),
  },
  codec: {
    encode: cloneState,
    decode: asAdjustState,
  },
  renderer: {
    draw() {},
    bakeOnto(target, layer, env) {
      const work = env.borrowCanvas();
      work.ctx.save();
      work.ctx.filter = buildFilter(layer.state.params);
      work.ctx.drawImage(target.runtime.canvas, 0, 0);
      work.ctx.restore();
      target.runtime.ctx.save();
      target.runtime.ctx.globalAlpha = layer.opacity;
      target.runtime.ctx.globalCompositeOperation = 'source-over';
      target.runtime.ctx.drawImage(work.canvas, 0, 0);
      target.runtime.ctx.restore();
      work.release();
    },
    contentCanvas: () => null,
    effect: {
      dependencyLayerIds: layer => layer.state.maskLayerIds,
      apply(scope, layer, env) {
        const p = layer.state.params;
        if (layer.opacity <= 0 || (p.brightness === 100 && p.contrast === 100 && p.hue === 0 && p.saturation === 100)) return;
        const mask = layer.state.maskLayerIds.length ? env.maskCanvas(layer.state.maskLayerIds) : null;
        if (layer.state.maskLayerIds.length && !mask) return;
        const filtered = env.borrowCanvas();
        filtered.ctx.save();
        filtered.ctx.filter = buildFilter(p);
        filtered.ctx.drawImage(scope.canvas, 0, 0);
        filtered.ctx.restore();
        mixCanvases(scope, filtered.canvas, layer.opacity, mask);
        mask?.release();
        filtered.release();
      },
    },
  },
  parameters: buildCatalog(
    [{ id: 'adjust', label: '色調補正' }],
    SLIDERS.map(([key, label, min, max]) => ({
      id: `adjust.${key}`,
      semanticId: `adjust.${key}`,
      groupId: 'adjust',
      label,
      editor: { kind: 'slider' as const, min, max },
      surfaces: SURFACES,
      read: (state: AdjustState) => state.params[key],
      write: (state: AdjustState, value) => ({
        ...cloneState(state),
        params: { ...state.params, [key]: Number(value) },
      }),
    })),
  ),
  capabilities: {},
};
