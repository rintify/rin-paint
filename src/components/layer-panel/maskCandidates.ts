import type { LayerMeta } from '../../model';
import { canMaskLayerType } from '../../engine/layer-types/registry';

export function canUseLayerAsMask(
  roots: string[],
  layers: LayerMeta[],
  targetId: string,
  sourceId: string,
): boolean {
  const source = layers.find(layer => layer.id === sourceId);
  const target = layers.find(layer => layer.id === targetId);
  if (!source || source.id === targetId || !canMaskLayerType(source.type)) return false;
  if (!target || source.scopeId !== target.scopeId) return false;
  const siblings = target.scopeId
    ? layers.find(layer => layer.id === target.scopeId)?.scopeLayerIds ?? []
    : roots;
  return siblings.indexOf(source.id) >= 0 && siblings.indexOf(source.id) < siblings.indexOf(target.id);
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
  const target = byId.get(excludedId);
  const scopeIds = target?.scopeId ? byId.get(target.scopeId)?.scopeLayerIds ?? [] : roots;
  const result: { layer: LayerMeta; depth: number }[] = [];
  const visit = (ids: string[], depth: number) => {
    for (const id of ids) {
      const layer = byId.get(id);
      if (!layer) continue;
      if (layer.id !== excludedId && canMaskLayerType(layer.type) && matching.has(layer.id)) {
        result.push({ layer, depth });
      }
    }
  };
  visit(scopeIds, 0);
  return result;
}
