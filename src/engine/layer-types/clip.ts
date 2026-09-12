import type { ClipState } from '../../model';
import { createClipLayer, type ClipLayer } from '../layers';
import { emptyCatalog } from '../parameters/catalog';
import { applyClip } from './effectUtils';
import type { LayerDefinition } from './definition';

function cloneState(state: ClipState): ClipState {
  return { maskLayerIds: [...state.maskLayerIds] };
}

function asClipState(value: unknown): ClipState | null {
  if (!value || typeof value !== 'object') return { maskLayerIds: [] };
  const maskLayerIds = (value as { maskLayerIds?: unknown }).maskLayerIds;
  return { maskLayerIds: Array.isArray(maskLayerIds) ? maskLayerIds.filter((id): id is string => typeof id === 'string') : [] };
}

export const clipLayerType: LayerDefinition<'clip'> = {
  info: {
    type: 'clip',
    canMask: false,
    maskSourceLabel: null,
    supportsBlend: false,
    defaultName: index => `クリップ ${index}`,
  },
  state: {
    initial: () => createClipLayer('tmp').state,
    clone: cloneState,
    normalize: cloneState,
    applyPatch: (state, patch) => cloneState({ ...state, ...patch }),
    scale: state => cloneState(state),
    remapReferences: (state, mapId) => ({
      maskLayerIds: state.maskLayerIds.map(id => mapId(id)).filter((id): id is string => !!id),
    }),
  },
  codec: {
    encode: cloneState,
    decode: asClipState,
  },
  renderer: {
    draw() {},
    bakeOnto() {},
    contentCanvas: () => null,
    effect: {
      dependencyLayerIds: layer => layer.state.maskLayerIds,
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
};

export type { ClipLayer };
