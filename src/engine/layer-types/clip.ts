import type { ClipState } from '../../model';
import { createClipLayer, type ClipLayer } from '../layers';
import { LAYER_KIND_IDS } from '../modules/ids';
import { emptyCatalog } from '../parameters/catalog';
import { applyClip } from './effectUtils';
import type { LayerDefinition } from './definition';
import { loadOwned } from './loadOwned';

function cloneState(state: ClipState): ClipState {
  return { maskLayerIds: [...state.maskLayerIds] };
}

function asClipState(value: unknown): ClipState | null {
  if (!value || typeof value !== 'object') return { maskLayerIds: [] };
  const maskLayerIds = (value as { maskLayerIds?: unknown }).maskLayerIds;
  return {
    maskLayerIds: Array.isArray(maskLayerIds)
      ? maskLayerIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

export const clipLayerType: LayerDefinition<'clip'> = {
  info: {
    type: 'clip',
    kindId: LAYER_KIND_IDS.clip,
    revision: 1,
    canMask: false,
    maskSourceLabel: null,
    supportsBlend: false,
    defaultName: (index) => `クリップ ${index}`,
    addMenu: { group: 'effect', label: 'クリップを追加', historyLabel: 'クリップレイヤー追加' },
    effectBadge: 'クリップ',
  },
  factory: { create: (name, id) => createClipLayer(name, id) },
  schema: {
    loadDefaults: { maskLayerIds: [] },
    createDefaults: { maskLayerIds: [] },
    load: (raw) => loadOwned({ maskLayerIds: [] }, raw, asClipState),
  },
  state: {
    initial: () => ({ maskLayerIds: [] }),
    clone: cloneState,
    normalize: cloneState,
    applyPatch: (state, patch) => cloneState({ ...state, ...patch }),
    scale: (state) => cloneState(state),
    remapReferences: (state, mapId) => ({
      maskLayerIds: state.maskLayerIds
        .map((id) => mapId(id))
        .filter((id): id is string => !!id),
    }),
  },
  codec: {
    encode: cloneState,
    decode: asClipState,
  },
  renderer: {
    draw() {},
    contentCanvas: () => null,
    effect: {
      dependencyLayerIds: (layer) => layer.state.maskLayerIds,
      apply(scope, layer, env) {
        if (!layer.state.maskLayerIds.length || layer.opacity <= 0) return;
        const mask = env.maskCanvas(layer.state.maskLayerIds);
        if (mask) {
          applyClip(scope, mask, layer.opacity, env);
          mask.release();
        }
      },
    },
  },
  parameters: emptyCatalog(),
  capabilities: {},
  enumerateLayerIds: (state) => [...state.maskLayerIds],
};

export type { ClipLayer };
