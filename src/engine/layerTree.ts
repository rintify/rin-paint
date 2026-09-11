export interface TreeLayerLike {
  id: string;
  type: 'raster' | 'adjust' | 'shape' | 'text';
  parentId: string | null;
  childIds: string[];
}

/** Only ancestors and the selected layer are open; siblings remain visible. */
export function selectedLayerRows(roots: string[], layers: TreeLayerLike[], activeId: string): { id: string; depth: number }[] {
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  const open = new Set<string>();
  let cursor: string | null = activeId;
  while (cursor && !open.has(cursor)) { open.add(cursor); cursor = byId.get(cursor)?.parentId ?? null; }
  const rows: { id: string; depth: number }[] = [];
  const visit = (ids: string[], depth: number) => {
    for (const id of [...ids].reverse()) {
      const layer = byId.get(id);
      if (!layer) continue;
      rows.push({ id, depth });
      if (open.has(id)) visit(layer.childIds, depth + 1);
    }
  };
  visit(roots, 0);
  return rows;
}

export function canReparent(layers: TreeLayerLike[], id: string, parentId: string | null): boolean {
  if (id === parentId || !layers.some((layer) => layer.id === id)) return false;
  if (parentId === null) return true;
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  if (!byId.has(parentId)) return false;
  let cursor: string | null = parentId;
  while (cursor) {
    if (cursor === id) return false;
    cursor = byId.get(cursor)?.parentId ?? null;
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
  const visit = (id: string, parentId: string | null): boolean => {
    const layer = byId.get(id);
    if (!layer || layer.parentId !== parentId || visiting.has(id) || seen.has(id)) return false;
    visiting.add(id);
    for (const childId of layer.childIds) if (!visit(childId, id)) return false;
    visiting.delete(id);
    seen.add(id);
    return true;
  };
  for (const root of roots) if (!visit(root, null)) return false;
  return seen.size === layers.length;
}

export function flattenRenderOrder(roots: string[], layers: TreeLayerLike[]): string[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const result: string[] = [];
  const visit = (id: string) => {
    const layer = byId.get(id);
    if (!layer) return;
    result.push(id);
    for (const child of layer.childIds) visit(child);
  };
  for (const root of roots) visit(root);
  return result;
}

export function closestRasterOrRoot(layers: TreeLayerLike[], activeId: string): string | null {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  let cursor = byId.get(activeId);
  if (cursor?.type === 'raster') return cursor.id;
  while (cursor?.parentId) {
    cursor = byId.get(cursor.parentId);
    if (cursor?.type === 'raster') return cursor.id;
  }
  return null;
}

export function structuralLowerId(layer: TreeLayerLike, roots: string[], layers: TreeLayerLike[]): string | null {
  if (layer.childIds.length) return null;
  const byId = new Map(layers.map((item) => [item.id, item]));
  const siblings = layer.parentId ? byId.get(layer.parentId)?.childIds ?? [] : roots;
  const index = siblings.indexOf(layer.id);
  if (index < 0) return null;
  return index > 0 ? siblings[index - 1] : layer.parentId;
}
