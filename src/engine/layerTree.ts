import type { LayerType } from '../model';

export interface TreeLayerLike {
  id: string;
  type: LayerType;
  scopeId: string | null;
  scopeLayerIds: string[];
}

/** Only ancestors and the selected layer are open; siblings remain visible. */
export function selectedLayerRows(roots: string[], layers: TreeLayerLike[], activeId: string | string[]): { id: string; depth: number }[] {
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  const open = new Set<string>();
  for (const selected of Array.isArray(activeId) ? activeId : [activeId]) {
    let cursor: string | null = selected;
    while (cursor && !open.has(cursor)) { open.add(cursor); cursor = byId.get(cursor)?.scopeId ?? null; }
  }
  const rows: { id: string; depth: number }[] = [];
  const visit = (ids: string[], depth: number) => {
    for (const id of ids) {
      const layer = byId.get(id);
      if (!layer) continue;
      rows.push({ id, depth });
      if (open.has(id)) visit(layer.scopeLayerIds, layer.type === 'canvas' ? depth : depth + 1);
    }
  };
  visit(roots, 0);
  return rows;
}

export function canReparent(layers: TreeLayerLike[], id: string, scopeId: string | null): boolean {
  if (id === scopeId || !layers.some((layer) => layer.id === id)) return false;
  if (scopeId === null) return true;
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  if (byId.get(scopeId)?.type !== 'canvas') return false;
  let cursor: string | null = scopeId;
  while (cursor) {
    if (cursor === id) return false;
    cursor = byId.get(cursor)?.scopeId ?? null;
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
  const visit = (id: string, scopeId: string | null): boolean => {
    const layer = byId.get(id);
    if (!layer || layer.scopeId !== scopeId || visiting.has(id) || seen.has(id)) return false;
    visiting.add(id);
    for (const childId of layer.scopeLayerIds) if (!visit(childId, id)) return false;
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
    // Canvas children form a sealed render/pick/reference scope. From outside the
    // canvas occurrence is the only addressable item.
    if (layer.type !== 'canvas') for (const child of layer.scopeLayerIds) visit(child);
  };
  for (const root of roots) visit(root);
  return result;
}

export function activeCanvasScope(layers: TreeLayerLike[], activeId: string): string | null {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const active = byId.get(activeId);
  return active?.scopeId && byId.get(active.scopeId)?.type === 'canvas' ? active.scopeId : null;
}

export function structuralLowerId(layer: TreeLayerLike, roots: string[], layers: TreeLayerLike[]): string | null {
  if (layer.scopeLayerIds.length) return null;
  const byId = new Map(layers.map((item) => [item.id, item]));
  const siblings = layer.scopeId ? byId.get(layer.scopeId)?.scopeLayerIds ?? [] : roots;
  const index = siblings.indexOf(layer.id);
  if (index < 0) return null;
  return index > 0 ? siblings[index - 1] : layer.scopeId;
}
