import type { CanvasLayerState, HierarchyItem } from '../../model';
import { normalizeHierarchy } from '../../model';
import { createCanvasLayer } from '../layers';
import { buildCatalog } from '../parameters/catalog';
import type { LayerDefinition } from './definition';

function normalizeState(value: unknown): CanvasLayerState {
  const source = value && typeof value === 'object'
    ? value as { hierarchy?: unknown; propagateTransform?: unknown }
    : {};
  const hierarchy = Array.isArray(source.hierarchy)
    ? normalizeHierarchy(source.hierarchy.filter((item): item is HierarchyItem => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<HierarchyItem>;
      return candidate.kind === 'layer'
        ? typeof candidate.id === 'string' && typeof candidate.layerId === 'string'
        : candidate.kind === 'stack' && typeof candidate.id === 'string' && Array.isArray(candidate.layerIds);
    }))
    : [];
  return { hierarchy, propagateTransform: source.propagateTransform !== false };
}

const SURFACES = ['single', 'multi', 'link'] as const;

export const canvasLayerType: LayerDefinition<'canvas'> = {
  info: {
    type: 'canvas', canMask: true, maskSourceLabel: 'キャンバスレイヤー', supportsBlend: true,
    defaultName: index => `キャンバス ${index}`,
  },
  state: {
    initial: () => createCanvasLayer('tmp').state,
    clone: state => structuredClone(state),
    normalize: normalizeState,
    applyPatch: (state, patch) => normalizeState({ ...state, ...patch }),
    scale: state => structuredClone(state),
    remapReferences: (state, mapId) => ({
      ...structuredClone(state),
      hierarchy: normalizeHierarchy(state.hierarchy.flatMap<HierarchyItem>(item => {
        if (item.kind === 'layer') {
          const layerId = mapId(item.layerId);
          return layerId ? [{ ...item, layerId }] : [];
        }
        return [{ ...item, layerIds: item.layerIds.map(id => mapId(id)).filter((id): id is string => !!id) }];
      })),
    }),
  },
  codec: { encode: structuredClone, decode: normalizeState },
  renderer: {
    draw() {},
    bakeOnto() {},
    contentCanvas: () => null,
  },
  parameters: buildCatalog(
    [{ id: 'canvas', label: 'キャンバスレイヤー' }],
    [{
      id: 'canvas.propagateTransform', semanticId: 'canvas.propagateTransform', groupId: 'canvas',
      label: 'トランスフォームを子へ伝播',
      editor: { kind: 'switch', trueLabel: 'オン', falseLabel: 'オフ' }, surfaces: SURFACES,
      read: state => state.propagateTransform,
      write: (state, value) => ({ ...state, propagateTransform: Boolean(value) }),
    }],
  ),
  capabilities: { maskSource: { drawOpacity: layer => layer.opacity } },
};
