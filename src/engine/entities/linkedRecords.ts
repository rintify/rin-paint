import { flattenHierarchy, type HierarchyItem, type ScopedLayerAddress } from '../../model';
import type { SavedBinItem, SavedLayer } from '../persistence/db';
import { remapRecordIds } from '../layer-types/registry';

/** Hydrate lightweight linked occurrences from bin-owned layer entities. */
export function hydrateLinkedRecords(records: readonly SavedLayer[], bins: readonly SavedBinItem[]): SavedLayer[] {
  const binsById = new Map(bins.map(bin => [bin.id, bin]));
  const targetBySource = new Map<string, string>();
  for (const record of records) {
    const link = record.dataLink;
    if (link?.document.kind === 'bin') targetBySource.set(`${record.dataLinkInstanceId ?? ''}:${link.document.id}:${link.nodeId}`, record.id);
  }
  const resolve = (target: SavedLayer, visited: Set<string>): SavedLayer => {
    const link = target.dataLink;
    if (!link || link.document.kind !== 'bin') return structuredClone(target);
    const key = `${link.document.id}:${link.nodeId}`;
    if (visited.has(key)) throw new Error('レイヤーリンクが循環しています');
    const source = binsById.get(link.document.id)?.layers.find(layer => layer.id === link.nodeId);
    if (!source) return {
      ...structuredClone(target), dataLink: undefined,
      dataLinkInstanceId: undefined, canvasStructureSource: undefined,
    };
    const hydratedSource = resolve(source, new Set([...visited, key]));
    const result = structuredClone(hydratedSource);
    remapRecordIds(result, sourceId => targetBySource.get(`${target.dataLinkInstanceId ?? ''}:${link.document.id}:${sourceId}`));
    result.id = target.id;
    result.dataLink = structuredClone(link);
    result.dataLinkInstanceId = target.dataLinkInstanceId;
    return result;
  };
  return records.map(record => resolve(record, new Set()));
}

export function savedCanvasScopePath(layerId: string, records: readonly SavedLayer[]): string[] {
  const path: string[] = [];
  let currentId: string | undefined = layerId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const parent = records.find(record => {
      if (record.type !== 'canvas' || !record.state || typeof record.state !== 'object') return false;
      const hierarchy = (record.state as { hierarchy?: HierarchyItem[] }).hierarchy ?? [];
      return flattenHierarchy(hierarchy).includes(currentId!);
    });
    if (!parent) break;
    path.unshift(parent.id);
    currentId = parent.id;
  }
  return path;
}

/** Synchronize linked Canvas descendants while leaving stack/root composition local. */
export function synchronizeCanvasLinkedRecords(
  records: readonly SavedLayer[],
  item: SavedBinItem,
  newId: (sourceId: string) => string = sourceId => `${sourceId}-${crypto.randomUUID().slice(0, 8)}`,
): { records: SavedLayer[]; changed: boolean } {
  let output = structuredClone(records) as SavedLayer[];
  let changed = false;
  const sourceById = new Map(item.layers.map(layer => [layer.id, layer]));
  const sourcePaths = new Map(item.layers.map(layer => [layer.id, savedCanvasScopePath(layer.id, item.layers)]));
  const association = (layer: SavedLayer) => layer.dataLink ?? layer.canvasStructureSource;
  const instances = new Set(output.flatMap(layer => {
    const address = association(layer);
    return address?.document.kind === 'bin' && address.document.id === item.id && layer.dataLinkInstanceId
      ? [layer.dataLinkInstanceId] : [];
  }));
  for (const instanceId of instances) {
    const targetBySource = new Map(output.flatMap(layer => {
      const address = association(layer);
      return layer.dataLinkInstanceId === instanceId
        && address?.document.kind === 'bin' && address.document.id === item.id
        ? [[address.nodeId, layer.id] as const] : [];
    }));
    let added = true;
    while (added) {
      added = false;
      for (const source of item.layers) {
        const path = sourcePaths.get(source.id) ?? [];
        if (!path.length || targetBySource.has(source.id) || !targetBySource.has(path.at(-1)!)) continue;
        const targetId = newId(source.id);
        targetBySource.set(source.id, targetId);
        const copy = structuredClone(source) as SavedLayer;
        remapRecordIds(copy, sourceId => targetBySource.get(sourceId));
        const address: ScopedLayerAddress = {
          document: { kind: 'bin', id: item.id }, scopePath: [...path], nodeId: source.id,
        };
        copy.id = targetId;
        copy.dataLink = structuredClone(address);
        copy.dataLinkInstanceId = instanceId;
        copy.canvasStructureSource = structuredClone(address);
        copy.content = undefined;
        output.push(copy);
        changed = true;
        added = true;
      }
    }
    output = output.flatMap(target => {
      if (target.dataLinkInstanceId !== instanceId) return [target];
      const address = association(target);
      if (address?.document.kind !== 'bin' || address.document.id !== item.id) return [target];
      const source = sourceById.get(address.nodeId);
      if (!source) {
        changed = true;
        return address.scopePath.length ? [] : [{ ...target, dataLink: undefined, dataLinkInstanceId: undefined }];
      }
      if (!target.dataLink) return [target];
      const copy = structuredClone(source) as SavedLayer;
      remapRecordIds(copy, sourceId => targetBySource.get(sourceId));
      copy.id = target.id;
      copy.dataLink = structuredClone(target.dataLink);
      copy.dataLinkInstanceId = instanceId;
      copy.canvasStructureSource = target.canvasStructureSource
        ? structuredClone(target.canvasStructureSource) : undefined;
      copy.content = undefined;
      changed = true;
      return [copy];
    });
  }
  return { records: output, changed };
}
