import { HISTORY_VERSION, PROJECT_VERSION } from './version';
import type { PersistedHistory, PersistedOp, PersistedAtomicOp } from '../history/historyTree';
import type { SavedPage, SavedProjectMeta } from './db';

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function isTile(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.x === 'number' &&
    typeof t.y === 'number' &&
    typeof t.w === 'number' &&
    typeof t.h === 'number' &&
    isBlob(t.before) &&
    isBlob(t.after)
  );
}

function isLocation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const loc = value as Record<string, unknown>;
  return (
    (loc.parentId === null || typeof loc.parentId === 'string') &&
    typeof loc.index === 'number'
  );
}

function isLayerSnapshot(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.type === 'string' &&
    typeof s.name === 'string' &&
    typeof s.opacity === 'number' &&
    typeof s.blend === 'string' &&
    typeof s.visible === 'boolean' &&
    (s.parentId === null || typeof s.parentId === 'string') &&
    Array.isArray(s.childIds) &&
    (s.blob === undefined || isBlob(s.blob))
  );
}

function isAtomicOp(value: unknown): value is PersistedAtomicOp {
  if (!value || typeof value !== 'object') return false;
  const op = value as Record<string, unknown>;
  switch (op.kind) {
    case 'raster':
      return typeof op.layerId === 'string' && Array.isArray(op.tiles) && op.tiles.every(isTile);
    case 'layerAdd':
      return isLocation(op.location) && isLayerSnapshot(op.snapshot);
    case 'layerRemove':
      return isLocation(op.location) && Array.isArray(op.snapshots) && op.snapshots.every(isLayerSnapshot);
    case 'layerMove':
      return typeof op.layerId === 'string' && isLocation(op.from) && isLocation(op.to);
    case 'layerProps':
      return typeof op.layerId === 'string' && !!op.before && !!op.after;
    case 'canvasChange':
      return !!op.before && !!op.after;
    case 'layerMerge':
      return (
        op.format === 'tiles-v1' &&
        typeof op.targetLayerId === 'string' &&
        !!op.removed &&
        typeof op.removed === 'object' &&
        isLocation((op.removed as { location: unknown }).location) &&
        isLayerSnapshot((op.removed as { snapshot: unknown }).snapshot) &&
        Array.isArray(op.tiles) &&
        op.tiles.every(isTile) &&
        typeof op.beforeActiveId === 'string' &&
        typeof op.afterActiveId === 'string'
      );
    default:
      return false;
  }
}

function isPersistedOp(value: unknown): value is PersistedOp {
  if (!value || typeof value !== 'object') return false;
  const op = value as Record<string, unknown>;
  if (op.kind === 'batch') {
    return Array.isArray(op.ops) && op.ops.every(isAtomicOp);
  }
  return isAtomicOp(value);
}

export function isPersistedHistory(value: unknown): value is PersistedHistory {
  if (!value || typeof value !== 'object') return false;
  const h = value as Partial<PersistedHistory>;
  if (h.version !== HISTORY_VERSION || !Array.isArray(h.nodes) || h.nodes.length === 0) return false;
  if (!Number.isInteger(h.rootId) || !Number.isInteger(h.currentId)) return false;
  const ids = new Set<number>();
  for (const node of h.nodes) {
    if (
      !node ||
      !Number.isInteger(node.id) ||
      typeof node.label !== 'string' ||
      !Array.isArray(node.childIds) ||
      (node.op !== null && !isPersistedOp(node.op))
    ) {
      return false;
    }
    if (ids.has(node.id)) return false;
    ids.add(node.id);
  }
  if (!ids.has(h.rootId!) || !ids.has(h.currentId!)) return false;
  return true;
}

export function isSavedProjectMeta(value: unknown): value is SavedProjectMeta {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<SavedProjectMeta>;
  return (
    m.version === PROJECT_VERSION &&
    Array.isArray(m.pageOrder) &&
    m.pageOrder.length > 0 &&
    typeof m.activePageId === 'string' &&
    Array.isArray(m.fonts) &&
    typeof m.penColor === 'string' &&
    typeof m.penSize === 'number' &&
    Array.isArray(m.colorHistory) &&
    Array.isArray(m.tools) &&
    Array.isArray(m.toolLayout) &&
    Array.isArray(m.toolStacks)
  );
}

export function isSavedPage(value: unknown): value is SavedPage {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<SavedPage>;
  return (
    typeof p.id === 'string' &&
    !!p.canvasSpec &&
    Array.isArray(p.rootLayerIds) &&
    Array.isArray(p.layers) &&
    typeof p.activeLayerId === 'string' &&
    isPersistedHistory(p.history) &&
    !!p.view &&
    typeof p.thumbnailVersion === 'number'
  );
}
