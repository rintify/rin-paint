import type { LayerMeta } from '../../model';

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
        layer.id !== excludedId
        && layer.type !== 'adjust'
        && (!normalized || layer.name.toLocaleLowerCase().includes(normalized)))
      .map(layer => layer.id),
  );
  const shown = new Set(matching);
  if (normalized) {
    for (const id of matching) {
      let parent = byId.get(id)?.parentId ?? null;
      while (parent) {
        const layer = byId.get(parent);
        if (layer?.type !== 'adjust') shown.add(parent);
        parent = layer?.parentId ?? null;
      }
    }
  }
  const result: { layer: LayerMeta; depth: number }[] = [];
  const visit = (ids: string[], depth: number) => {
    for (const id of [...ids].reverse()) {
      const layer = byId.get(id);
      if (!layer) continue;
      if (layer.id !== excludedId && layer.type !== 'adjust' && shown.has(layer.id)) {
        result.push({ layer, depth });
      }
      visit(layer.childIds, depth + 1);
    }
  };
  visit(roots, 0);
  return result;
}
