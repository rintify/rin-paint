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
    (loc.scopeId === null || typeof loc.scopeId === 'string') &&
    typeof loc.index === 'number'
  );
}

function isScopedLayerAddress(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const address = value as Record<string, unknown>;
  const document = address.document as Record<string, unknown> | undefined;
  return !!document
    && (document.kind === 'page' || document.kind === 'bin')
    && typeof document.id === 'string'
    && Array.isArray(address.scopePath)
    && address.scopePath.every(id => typeof id === 'string')
    && typeof address.nodeId === 'string';
}

function isLayerLink(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const link = value as Record<string, unknown>;
  const source = link.source as Record<string, unknown> | undefined;
  const fallback = link.fallbackValues as Record<string, unknown> | undefined;
  return !!source
    && isScopedLayerAddress(source)
    && typeof link.sourceNameHint === 'string'
    && typeof link.sourcePageIndexHint === 'number'
    && Array.isArray(link.linkedParameterIds)
    && link.linkedParameterIds.every(id => typeof id === 'string')
    && !!fallback
    && Object.values(fallback).every(item => item === null
      || typeof item === 'string'
      || typeof item === 'boolean'
      || (typeof item === 'number' && Number.isFinite(item)));
}

function isCommon(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.name === 'string' &&
    typeof c.opacity === 'number' &&
    typeof c.blend === 'string' &&
    typeof c.visible === 'boolean' &&
    (c.parameterLink === undefined || isLayerLink(c.parameterLink))
  );
}

function isLayerSnapshot(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.type === 'string' &&
    isCommon(s.common) &&
    'state' in s &&
    (s.geometryUnit === undefined || s.geometryUnit === 'mm') &&
    (s.dataLink === undefined || isScopedLayerAddress(s.dataLink)) &&
    (s.dataLinkInstanceId === undefined || typeof s.dataLinkInstanceId === 'string') &&
    (s.canvasStructureSource === undefined || isScopedLayerAddress(s.canvasStructureSource)) &&
    (s.content === undefined || isBlob(s.content))
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
    case 'hierarchyChange':
      return (op.scopeId === null || typeof op.scopeId === 'string')
        && Array.isArray(op.before) && Array.isArray(op.after);
    case 'layerProps':
      return typeof op.layerId === 'string' && !!op.before && !!op.after;
    case 'layerParameter':
      return typeof op.layerId === 'string' && typeof op.parameterId === 'string'
        && (op.before === null || typeof op.before === 'string' || typeof op.before === 'boolean'
          || (typeof op.before === 'number' && Number.isFinite(op.before)))
        && (op.after === null || typeof op.after === 'string' || typeof op.after === 'boolean'
          || (typeof op.after === 'number' && Number.isFinite(op.after)));
    case 'layerLink': {
      const target = op.target;
      return isScopedLayerAddress(target)
        && isLayerLink(op.before) && isLayerLink(op.after);
    }
    case 'layerDataLink':
      return typeof op.layerId === 'string'
        && (op.before === null || isScopedLayerAddress(op.before))
        && (op.after === null || isScopedLayerAddress(op.after))
        && (op.beforeInstanceId === undefined || typeof op.beforeInstanceId === 'string')
        && (op.afterInstanceId === undefined || typeof op.afterInstanceId === 'string')
        && (op.beforeStructureSource === undefined || isScopedLayerAddress(op.beforeStructureSource))
        && (op.afterStructureSource === undefined || isScopedLayerAddress(op.afterStructureSource));
    case 'layerReplace': {
      const side = (value: unknown) => {
        if (!value || typeof value !== 'object') return false;
        const s = value as Record<string, unknown>;
        const selection = s.selection as Record<string, unknown> | undefined;
        return Array.isArray(s.rootIds)
          && Array.isArray(s.entries)
          && s.entries.every(entry => !!entry && typeof entry === 'object'
            && isLocation((entry as Record<string, unknown>).location)
            && isLayerSnapshot((entry as Record<string, unknown>).snapshot))
          && !!selection
          && typeof selection.activeLayerId === 'string'
          && Array.isArray(selection.selectedLayerIds)
          && typeof selection.multiSelectMode === 'boolean';
      };
      return side(op.before) && side(op.after);
    }
    case 'pageChange':
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
    case 'layerContent':
      return typeof op.layerId === 'string' && isLayerSnapshot(op.before) && isLayerSnapshot(op.after);
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
      !Array.isArray(node.scopeLayerIds) ||
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
    Array.isArray(m.binOrder) &&
    typeof m.lastPagePpi === 'number'
  );
}

export function isSavedPage(value: unknown): value is SavedPage {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<SavedPage>;
  return (
    typeof p.id === 'string' &&
    !!p.pageSpec &&
    Array.isArray(p.rootLayerIds) &&
    Array.isArray(p.hierarchy) &&
    Array.isArray(p.layers) && p.layers.every(isLayerSnapshot) &&
    typeof p.activeLayerId === 'string' &&
    isPersistedHistory(p.history) &&
    !!p.view &&
    typeof p.thumbnailVersion === 'number'
  );
}
