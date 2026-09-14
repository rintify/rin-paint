import { isSavedPage, isSavedProjectMeta } from './schema';
import { CLIPBOARD_VERSION, HISTORY_VERSION, PROJECT_VERSION } from './version';
import type { LayerClipboard, SavedPage, SavedProjectMeta } from './db';

type MutableRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MutableRecord {
  return !!value && typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof Blob);
}

export function migrateSavedPage(value: unknown): SavedPage {
  if (!isRecord(value)) throw new Error('保存ページの形式が不正です');
  if (isRecord(value.history) && value.history.version !== HISTORY_VERSION) {
    throw new Error('対応していないプロジェクト形式です');
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
  if (!isRecord(value) || value.version !== CLIPBOARD_VERSION || !isRecord(value.sourceDocument) || !['page', 'bin-item'].includes(String(value.sourceDocument.kind)) || typeof value.sourceDocument.id !== 'string' || typeof value.sourcePageIndex !== 'number' || !Array.isArray(value.layers)) {
    return undefined;
  }
  return value as unknown as LayerClipboard;
}
