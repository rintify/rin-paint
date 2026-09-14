import type { HistoryNode, Op } from '../history/historyTree';
import { findLayerModule } from '../layer-types/registry';
import type { Layer } from '../layers';
import type { LayerRecord } from '../layer-types/definition';

export function collectLayerAssetIds(layer: Layer, out = new Set<string>()): Set<string> {
  for (const id of findLayerModule(layer.type)?.enumerateAssetIds(layer) ?? []) out.add(id);
  return out;
}

export function collectRecordAssetIds(record: LayerRecord, out = new Set<string>()): Set<string> {
  const ids = findLayerModule(record.kindId || record.type)?.enumerateContentAssetIds(record.content) ?? [];
  for (const id of ids) out.add(id);
  return out;
}

export function collectHistoryAssetIds(root: HistoryNode, out = new Set<string>()): Set<string> {
  const visit = (node: HistoryNode) => {
    collectOpAssetIds(node.op, out);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return out;
}

function snapshotsOf(op: Exclude<Op, { kind: 'batch' }>): Array<{ type: string; kindId?: string; content?: unknown }> {
  switch (op.kind) {
    case 'layerAdd':
      return [op.snapshot];
    case 'layerRemove':
      return op.snapshots;
    case 'layerContent':
      return [op.before, op.after];
    case 'layerReplace':
      return [...op.before.entries, ...op.after.entries].map((entry) => entry.snapshot);
    case 'layerMerge':
      return [op.removed.snapshot];
    default:
      return [];
  }
}

function collectOpAssetIds(op: Op | null, out: Set<string>): void {
  if (!op) return;
  if (op.kind === 'batch') {
    for (const item of op.ops) collectOpAssetIds(item, out);
    return;
  }
  if (op.kind === 'raster' || op.kind === 'layerMerge') {
    for (const tile of op.tiles) {
      if (tile.before) out.add(tile.before);
      if (tile.after) out.add(tile.after);
    }
  }
  for (const snapshot of snapshotsOf(op)) {
    const mod = findLayerModule(snapshot.kindId || snapshot.type);
    for (const id of mod?.enumerateContentAssetIds(snapshot.content) ?? []) out.add(id);
  }
}
