/** A layer occurrence in a rendering scope. The layer data lives in the entity store. */
export interface LayerHierarchyItem {
  kind: 'layer';
  id: string;
  layerId: string;
}

/**
 * A stack is deliberately presentation-only: its members remain in render order and
 * it cannot contain another stack.
 */
export interface StackHierarchyItem {
  kind: 'stack';
  id: string;
  layerIds: string[];
}

export type HierarchyItem = LayerHierarchyItem | StackHierarchyItem;

export interface HierarchyLocation {
  scopeId: string | null;
  index: number;
  stackId?: string;
  memberIndex?: number;
}

export function newHierarchyId(prefix: 'node' | 'stack' = 'node'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function layerItem(layerId: string, id = newHierarchyId()): LayerHierarchyItem {
  return { kind: 'layer', id, layerId };
}

export function stackItem(layerIds: readonly string[], id = newHierarchyId('stack')): StackHierarchyItem {
  if (layerIds.length < 2) throw new Error('スタックには2つ以上のレイヤーが必要です');
  if (new Set(layerIds).size !== layerIds.length) throw new Error('同じレイヤーをスタックへ重複配置できません');
  return { kind: 'stack', id, layerIds: [...layerIds] };
}

/** Stack membership never changes compositing order. */
export function flattenHierarchy(items: readonly HierarchyItem[]): string[] {
  return items.flatMap(item => item.kind === 'layer' ? [item.layerId] : item.layerIds);
}

export function hierarchyContains(items: readonly HierarchyItem[], layerId: string): boolean {
  return items.some(item => item.kind === 'layer' ? item.layerId === layerId : item.layerIds.includes(layerId));
}

export function findHierarchyLocation(
  scopes: ReadonlyMap<string | null, readonly HierarchyItem[]>,
  layerId: string,
): HierarchyLocation | null {
  for (const [scopeId, items] of scopes) {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item.kind === 'layer' && item.layerId === layerId) return { scopeId, index };
      if (item.kind === 'stack') {
        const memberIndex = item.layerIds.indexOf(layerId);
        if (memberIndex >= 0) return { scopeId, index, stackId: item.id, memberIndex };
      }
    }
  }
  return null;
}

/**
 * Normalizes an edited scope. Invalid/duplicate occurrences are discarded and a
 * stack with fewer than two members dissolves without changing render order.
 */
export function normalizeHierarchy(items: readonly HierarchyItem[]): HierarchyItem[] {
  const seen = new Set<string>();
  const result: HierarchyItem[] = [];
  for (const item of items) {
    if (item.kind === 'layer') {
      if (!seen.has(item.layerId)) {
        seen.add(item.layerId);
        result.push({ ...item });
      }
      continue;
    }
    const layerIds = item.layerIds.filter(id => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (layerIds.length === 1) result.push(layerItem(layerIds[0]));
    else if (layerIds.length > 1) result.push({ ...item, layerIds });
  }
  return result;
}

export function stackDisplayName(item: StackHierarchyItem, nameOf: (layerId: string) => string): string {
  return item.layerIds.map(nameOf).join('・');
}

/** Only lower entries in the same rendering scope can be referenced as masks. */
export function lowerLayerIds(items: readonly HierarchyItem[], layerId: string): string[] {
  const order = flattenHierarchy(items);
  const index = order.indexOf(layerId);
  return index < 0 ? [] : order.slice(0, index);
}

