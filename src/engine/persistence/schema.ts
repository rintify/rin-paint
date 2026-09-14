import { recordLocation } from '../layer-types/scopes';
import { isLayerStacks, stacksMatchScopes } from '../../model/layerStack';
import { HISTORY_VERSION, PROJECT_VERSION } from './version';
import type { PersistedHistory, PersistedOp, PersistedAtomicOp } from '../history/historyTree';
import type { SavedPage, SavedProjectMeta, SavedBin } from './db';

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

function isDocumentKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const key = value as Record<string, unknown>;
  return (key.kind === 'page' || key.kind === 'bin-item') && typeof key.id === 'string';
}

function isLayerLink(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const link = value as Record<string, unknown>;
  const source = link.source as Record<string, unknown> | undefined;
  const fallback = link.fallbackValues as Record<string, unknown> | undefined;
  const optionalBoolean = (key: string) => link[key] === undefined || typeof link[key] === 'boolean';
  const structure = link.structure as {inherited?:unknown;suppressed?:unknown;placements?:unknown} | undefined;
  const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item=>typeof item === 'string');
  const overrides = link.stateOverrides;
  const validOverrides = overrides === undefined || !!overrides && typeof overrides === 'object' && !Array.isArray(overrides)
    && Object.entries(overrides).every(([path,change]) => (path === '' || path.startsWith('/')
      && !path.slice(1).split('/').some(key=>['__proto__','constructor','prototype'].includes(key.replaceAll('~1','/').replaceAll('~0','~'))))
      && !!change && typeof change === 'object' && ('value' in change || (change as {remove?:unknown}).remove === true));
  const validStructure = structure === undefined || !!structure && typeof structure === 'object'
    && !!structure.inherited && typeof structure.inherited === 'object' && !Array.isArray(structure.inherited)
    && Object.values(structure.inherited).every(id=>typeof id === 'string')
    && stringList(structure.suppressed) && Array.isArray(structure.placements)
    && structure.placements.every(place=>!!place && typeof place.id === 'string' && Number.isSafeInteger(place.index) && place.index >= 0);
  return validOverrides && validStructure && ['linkedContent','linkedState','linkedName'].every(optionalBoolean)
    && !!source
    && isDocumentKey(source.document)
    && typeof source.layerId === 'string'
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
    (c.parameterLink === undefined || isLayerLink(c.parameterLink)) &&
    (c.linkRecovery === undefined || !!c.linkRecovery && typeof c.linkRecovery === 'object'
      && typeof (c.linkRecovery as {signature?:unknown}).signature === 'string' && isLayerLink((c.linkRecovery as {link?:unknown}).link))
  );
}

function isLayerSnapshot(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    s.unit === 'mm' &&
    typeof s.id === 'string' &&
    typeof s.type === 'string' &&
    isCommon(s.common) &&
    'state' in s &&
    (s.referenceOnly === undefined || s.referenceOnly === true && !!(s.common as {parameterLink?:unknown}).parameterLink) &&
    (s.type === 'canvas' ? !!s.scope && typeof s.scope === 'object'
      && typeof (s.scope as {id?: unknown}).id === 'string'
      && Array.isArray((s.scope as {children?: unknown}).children)
      && (s.scope as {children: unknown[]}).children.every(child => !!child && typeof child === 'object'
        && typeof (child as {id?: unknown}).id === 'string' && typeof (child as {entityId?: unknown}).entityId === 'string')
      : s.scope === undefined) &&
    (s.content === undefined || isBlob(s.content))
  );
}

function isAtomicOp(value: unknown): value is PersistedAtomicOp {
  if (!value || typeof value !== 'object') return false;
  const op = value as Record<string, unknown>;
  switch (op.kind) {
    case 'layerStacks':
      return isLayerStacks(op.before) && isLayerStacks(op.after);
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
    case 'layerParameter':
      return typeof op.layerId === 'string' && typeof op.parameterId === 'string'
        && (op.before === null || typeof op.before === 'string' || typeof op.before === 'boolean'
          || (typeof op.before === 'number' && Number.isFinite(op.before)))
        && (op.after === null || typeof op.after === 'string' || typeof op.after === 'boolean'
          || (typeof op.after === 'number' && Number.isFinite(op.after)));
    case 'layerLink': {
      const target = op.target as Record<string, unknown> | undefined;
      return !!target && isDocumentKey(target.document) && typeof target.layerId === 'string'
        && isLayerLink(op.before) && isLayerLink(op.after);
    }
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
    (m.deletedSources === undefined || Array.isArray(m.deletedSources) && m.deletedSources.every(record =>
      !!record && isDocumentKey(record.address?.document) && typeof record.address?.layerId === 'string' && isLayerSnapshot(record.layer)))
  );
}

export function isSavedPage(value: unknown): value is SavedPage {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<SavedPage>;
  return (
    typeof p.id === 'string' &&
    (p.layerStacks === undefined || isLayerStacks(p.layerStacks)) &&
    (p.selection === undefined || (Array.isArray(p.selection.selectedLayerIds) && p.selection.selectedLayerIds.every(id=>typeof id==='string') && typeof p.selection.multiSelectMode==='boolean')) &&
    !!p.pageSpec &&
    Array.isArray(p.rootLayerIds) &&
    Array.isArray(p.layers) && p.layers.every(isLayerSnapshot) &&
    stacksMatchScopes(p.layerStacks ?? [], p.rootLayerIds, p.layers.map(layer => ({id: layer.id, type: layer.type, ...layer.common, parentId: recordLocation(p.layers!, layer.id).parentId, childIds: layer.scope?.children.map(child => child.id) ?? []}))) &&
    typeof p.activeLayerId === 'string' &&
    isPersistedHistory(p.history) &&
    !!p.view &&
    typeof p.thumbnailVersion === 'number'
  );
}

/** Bin documents cannot retain page dependencies, including in history branches. */
export function isSavedBin(value: unknown): value is SavedBin {
  if (!value || typeof value !== 'object') return false;
  const bin = value as Partial<SavedBin>;
  if (!bin.workArea || ![bin.workArea.widthMm, bin.workArea.heightMm, bin.workArea.ppi]
    .every(n => Number.isFinite(n) && n > 0)) return false;
  if (!isSavedPage({ ...bin, pageSpec: bin.workArea, thumbnailVersion: 0 })) return false;
  if (bin.rootLayerIds!.length !== 1) return false;
  const allowed = (node: unknown): boolean => {
    if (!node || typeof node !== 'object' || node instanceof Blob) return true;
    if (Array.isArray(node)) return node.every(allowed);
    const record = node as Record<string, unknown>;
    if (record.kind === 'page' || record.kind === 'layerStacks' || 'layerStacks' in record) return false;
    return Object.values(record).every(allowed);
  };
  return allowed(value);
}
