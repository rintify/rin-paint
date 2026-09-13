import type { LayerMeta } from '../../model';
import { canMaskLayerType } from '../../engine/layer-types/registry';
import { flattenRenderOrder } from '../../engine/layerTree';

export function canUseLayerAsMask(
  roots: string[],
  layers: LayerMeta[],
  targetId: string,
  sourceId: string,
): boolean {
  const source = layers.find(layer => layer.id === sourceId);
  if (!source || source.id === targetId || !canMaskLayerType(source.type)) return false;
  if (source.type !== 'outline') return true;
  const order = flattenRenderOrder(roots, layers);
  return order.indexOf(source.id) < order.indexOf(targetId);
}

export function maskCandidateRows(
  roots: string[],
  layers: LayerMeta[],
  excludedId: string,
  query: string,
): { layer: LayerMeta; depth: number }[] {
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  const normalized = query.trim().toLocaleLowerCase();
  const matching = new Set(
    layers
      .filter(layer =>
        canUseLayerAsMask(roots, layers, excludedId, layer.id)
        && (!normalized || layer.name.toLocaleLowerCase().includes(normalized)))
      .map(layer => layer.id),
  );
  const shown = new Set(matching);
  if (normalized) {
    for (const id of matching) {
      let parent = byId.get(id)?.parentId ?? null;
      while (parent) {
        const layer = byId.get(parent);
        if (layer && canMaskLayerType(layer.type)) shown.add(parent);
        parent = layer?.parentId ?? null;
      }
    }
  }
  const result: { layer: LayerMeta; depth: number }[] = [];
  const visit = (ids: string[], depth: number) => {
    for (const id of ids) {
      const layer = byId.get(id);
      if (!layer) continue;
      if (layer.id !== excludedId && canMaskLayerType(layer.type) && shown.has(layer.id)) {
        result.push({ layer, depth });
      }
      visit(layer.childIds, depth + 1);
    }
  };
  visit(roots, 0);
  return result;
}
