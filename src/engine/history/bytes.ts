import type { Op, PersistedAtomicOp, PersistedOp, LayerSnapshot } from './historyTree';
import type { TilePatch } from './tilePatch';

function snapshotBytes(snapshot: LayerSnapshot | { blob?: Blob }): number {
  if ('blob' in snapshot && snapshot.blob) return snapshot.blob.size;
  if ('canvas' in snapshot && snapshot.canvas) {
    return snapshot.canvas.width * snapshot.canvas.height * 4;
  }
  return 0;
}

function tileBytes(tile: TilePatch): number {
  return (tile.before?.size ?? tile.w * tile.h * 4) + (tile.after?.size ?? tile.w * tile.h * 4);
}

export function atomicBytes(op: PersistedAtomicOp | Exclude<Op, { kind: 'batch' }>): number {
  if (op.kind === 'raster') return op.tiles.reduce((n, t) => n + tileBytes(t), 0);
  if (op.kind === 'layerAdd') return snapshotBytes(op.snapshot);
  if (op.kind === 'layerRemove') return op.snapshots.reduce((n, s) => n + snapshotBytes(s), 0);
  if (op.kind === 'canvasChange') {
    return [...op.before.layers, ...op.after.layers].reduce((n, s) => n + snapshotBytes(s), 0);
  }
  if (op.kind === 'layerMerge') {
    return snapshotBytes(op.removed.snapshot) + op.tiles.reduce((n, t) => n + tileBytes(t), 0);
  }
  return 0;
}

export function opBytes(op: PersistedOp | Op | null): number {
  if (!op) return 0;
  return op.kind === 'batch' ? op.ops.reduce((n, item) => n + atomicBytes(item), 0) : atomicBytes(op);
}
