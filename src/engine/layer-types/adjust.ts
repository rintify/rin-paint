import { z } from 'zod';
import { DEFAULT_ADJUST, type AdjustState } from '../../model';
import { buildFilter, createAdjustLayer } from '../layers';
import { LAYER_KIND_IDS } from '../modules/ids';
import { buildCatalog } from '../parameters/catalog';
import { finiteNumber, loadWithZod } from '../schema';
import type { LayerDefinition } from './definition';
import { mixCanvases } from './effectUtils';

const ADJUST_LOAD_DEFAULTS: AdjustState = {
  params: { ...DEFAULT_ADJUST },
  maskLayerIds: [],
};
const ADJUST_CREATE_DEFAULTS: AdjustState = {
  params: { ...DEFAULT_ADJUST },
  maskLayerIds: [],
};

const adjustStateSchema = z.object({
  params: z.object({
    brightness: finiteNumber(),
    contrast: finiteNumber(),
    hue: finiteNumber(),
    saturation: finiteNumber(),
  }),
  maskLayerIds: z.array(z.string()),
});

function cloneState(state: AdjustState): AdjustState {
  return { params: { ...state.params }, maskLayerIds: [...state.maskLayerIds] };
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
    kindId: LAYER_KIND_IDS.adjust,
    revision: 1,
    canMask: false,
    maskSourceLabel: null,
    supportsBlend: false,
    defaultName: (index) => `色調補正 ${index}`,
    addMenu: { group: 'effect', label: '色調補正を追加', historyLabel: '補正レイヤー追加' },
    effectBadge: '補正',
  },
  factory: {
    create: (name, id) => createAdjustLayer(name, id),
  },
  schema: {
    loadDefaults: structuredClone(ADJUST_LOAD_DEFAULTS),
    createDefaults: structuredClone(ADJUST_CREATE_DEFAULTS),
    load: (raw) => loadWithZod(adjustStateSchema, ADJUST_LOAD_DEFAULTS, raw),
  },
  state: {
    initial: () => structuredClone(ADJUST_CREATE_DEFAULTS),
    clone: cloneState,
    normalize: cloneState,
    applyPatch: (state, patch) =>
      cloneState({
        ...state,
        ...patch,
        params: { ...state.params, ...patch.params },
      }),
    scale: (state) => cloneState(state),
    remapReferences: (state, mapId) => ({
      ...cloneState(state),
      maskLayerIds: state.maskLayerIds
        .map((id) => mapId(id))
        .filter((id): id is string => !!id),
    }),
  },
  codec: {
    encode: cloneState,
    decode: (value) => {
      const loaded = loadWithZod(adjustStateSchema, ADJUST_LOAD_DEFAULTS, value);
      return loaded.status === 'ok' ? loaded.value : null;
    },
  },
  renderer: {
    draw() {},
    contentCanvas: () => null,
    effect: {
      dependencyLayerIds: (layer) => layer.state.maskLayerIds,
      apply(scope, layer, env) {
        const p = layer.state.params;
        if (
          layer.opacity <= 0 ||
          (p.brightness === 100 &&
            p.contrast === 100 &&
            p.hue === 0 &&
            p.saturation === 100)
        )
          return;
        const filtered = env.borrowCanvas();
        filtered.ctx.save();
        filtered.ctx.filter = buildFilter(p);
        filtered.ctx.drawImage(scope.canvas, 0, 0);
        filtered.ctx.restore();
        const mask = layer.state.maskLayerIds.length
          ? env.maskCanvas(layer.state.maskLayerIds)
          : null;
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
  enumerateLayerIds: (state) => [...state.maskLayerIds],
};
