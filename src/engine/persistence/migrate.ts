import { isSavedPage, isSavedProjectMeta } from './schema';
import { HISTORY_VERSION, PROJECT_VERSION } from './version';
import type { LayerClipboard, SavedPage, SavedProjectMeta } from './db';

type MutableRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MutableRecord {
  return !!value && typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof Blob);
}

function normalizeShapeRecord(value: MutableRecord): void {
  if (value.kind === 'line'
    && typeof value.x1 === 'number'
    && typeof value.y1 === 'number'
    && typeof value.x2 === 'number'
    && typeof value.y2 === 'number') {
    if (typeof value.strokeWidth !== 'number') {
      value.strokeWidth = typeof value.width === 'number' ? value.width : 1;
    }
    delete value.width;
    return;
  }
  const isRect = value.kind === 'rect'
    && ['x', 'y', 'width', 'height'].every(key => typeof value[key] === 'number');
  const isEllipse = value.kind === 'ellipse'
    && ['cx', 'cy', 'rx', 'ry'].every(key => typeof value[key] === 'number');
  const isPolygon = value.kind === 'polygon'
    && typeof value.cx === 'number'
    && typeof value.cy === 'number'
    && Array.isArray(value.points);
  if (isRect || isEllipse || isPolygon) {
    if (typeof value.strokeWidth !== 'number') value.strokeWidth = 1;
    if (value.paintMode !== 'fill-inside' && value.paintMode !== 'fill-outside') value.paintMode = 'stroke';
  }
}

/** Pages, every history branch, and embedded canvas snapshots are normalized recursively. */
export function normalizePersistedShapes(value: unknown, seen = new Set<object>()): void {
  if (!isRecord(value) && !Array.isArray(value)) return;
  if (seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) normalizePersistedShapes(item, seen);
    return;
  }
  normalizeShapeRecord(value);
  for (const child of Object.values(value)) normalizePersistedShapes(child, seen);
}

export function migrateSavedPage(value: unknown): SavedPage {
  if (!isRecord(value)) throw new Error('保存ページの形式が不正です');
  normalizePersistedShapes(value);
  if (isRecord(value.history) && value.history.version === HISTORY_VERSION) {
    value.history.version = HISTORY_VERSION;
  }
  if (!isSavedPage(value)) throw new Error('保存ページの形式が不正です');
  return value;
}

export function migrateProjectMeta(value: unknown): SavedProjectMeta {
  if (!isRecord(value) || value.version !== PROJECT_VERSION) {
    throw new Error('対応していないプロジェクト形式です');
  }
  if (!isSavedProjectMeta(value)) throw new Error('プロジェクト設定の形式が不正です');
  return value;
}

export function migrateClipboard(value: unknown): LayerClipboard | undefined {
  if (!isRecord(value) || value.version !== 2 || typeof value.sourcePageIndex !== 'number' || !Array.isArray(value.layers)) return undefined;
  normalizePersistedShapes(value.layers);
  return value as unknown as LayerClipboard;
}
