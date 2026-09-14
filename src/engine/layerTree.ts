import type { LayerType } from '../model';

export interface TreeLayerLike {
  id: string;
  type: LayerType;
  childIds?: string[];
}

export function layerChildren(layer: TreeLayerLike | null | undefined): string[] {
  return layer?.type === 'canvas' ? layer.childIds ?? [] : [];
}

export function scopeOwner(layers: readonly TreeLayerLike[], id: string): string | null {
  return layers.find(layer => layer.type === 'canvas' && layerChildren(layer).includes(id))?.id ?? null;
}

/** Only ancestors and the selected layer are open; siblings remain visible. */
export function selectedLayerRows(roots: string[], layers: TreeLayerLike[], activeId: string | string[]): { id: string; depth: number }[] {
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  const open = new Set<string>();
  for (const selected of Array.isArray(activeId) ? activeId : [activeId]) {
    let cursor: string | null = selected;
    while (cursor && !open.has(cursor)) { open.add(cursor); cursor = scopeOwner(layers, cursor); }
  }
  const rows: { id: string; depth: number }[] = [];
  const visit = (ids: string[], depth: number) => {
    for (const id of ids) {
      const layer = byId.get(id);
      if (!layer) continue;
      rows.push({ id, depth });
      if (layer.type === 'canvas' && open.has(id)) visit(layerChildren(layer), depth);
    }
  };
  visit(roots, 0);
  return rows;
}

export function canReparent(layers: TreeLayerLike[], id: string, parentId: string | null): boolean {
  if (id === parentId || !layers.some((layer) => layer.id === id)) return false;
  if (parentId === null) return true;
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  if (byId.get(parentId)?.type !== 'canvas') return false;
  let cursor: string | null = parentId;
  while (cursor) {
    if (cursor === id) return false;
    cursor = scopeOwner(layers, cursor);
  }
  return true;
}

export function validateLayerTree(roots: string[], layers: TreeLayerLike[]): boolean {
  const byId = new Map<string, TreeLayerLike>();
  for (const layer of layers) {
    if (byId.has(layer.id)) return false;
    byId.set(layer.id, layer);
  }
  const seen = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    const layer = byId.get(id);
    if (!layer || visiting.has(id) || seen.has(id)) return false;
    visiting.add(id);
    if (layer.childIds?.length && layer.type !== 'canvas') return false;
    for (const childId of layerChildren(layer)) if (!visit(childId)) return false;
    visiting.delete(id);
    seen.add(id);
    return true;
  };
  for (const root of roots) if (!visit(root)) return false;
  return seen.size === layers.length;
}

export function flattenRenderOrder(roots: string[], layers: TreeLayerLike[]): string[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const result: string[] = [];
  const visit = (id: string) => {
    const layer = byId.get(id);
    if (!layer) return;
    result.push(id);
    for (const child of layerChildren(layer)) visit(child);
  };
  for (const root of roots) visit(root);
  return result;
}

export function closestRasterOrRoot(layers: TreeLayerLike[], activeId: string): string | null {
  const layer = layers.find(layer => layer.id === activeId);
  return layer?.type === 'canvas' ? layer.id : scopeOwner(layers, activeId);
}

export function structuralLowerId(layer: TreeLayerLike, roots: string[], layers: TreeLayerLike[]): string | null {
  if (layerChildren(layer).length) return null;
  const byId = new Map(layers.map((item) => [item.id, item]));
  const owner = scopeOwner(layers, layer.id);
  const siblings = owner ? byId.get(owner)?.childIds ?? [] : roots;
  const index = siblings.indexOf(layer.id);
  if (index < 0) return null;
  return index > 0 ? siblings[index - 1] : null;
}
