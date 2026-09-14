import type { LayerDocument } from './types';

interface PatchValue { present: boolean; value?: unknown }
export interface AuthoredChange { path: string[]; before: PatchValue; after: PatchValue }
export interface DocumentPatch { changes: AuthoredChange[] }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Arrays encode authored ordering; objects are patched by field so unrelated live state survives Undo. */
export function documentPatch(before: LayerDocument, after: LayerDocument): DocumentPatch {
  const changes: AuthoredChange[] = [];
  const visit = (a: PatchValue, b: PatchValue, path: string[]): void => {
    if (a.present === b.present && JSON.stringify(a.value) === JSON.stringify(b.value)) return;
    if (a.present && b.present && object(a.value) && object(b.value)) {
      for (const key of new Set([...Object.keys(a.value), ...Object.keys(b.value)])) {
        visit({present: Object.hasOwn(a.value, key), value: a.value[key]},
          {present: Object.hasOwn(b.value, key), value: b.value[key]}, [...path, key]);
      }
    } else changes.push({path, before: structuredClone(a), after: structuredClone(b)});
  };
  visit({present: true, value: before}, {present: true, value: after}, []);
  return {changes};
}

export function applyDocumentPatch(current: LayerDocument, patch: DocumentPatch, side: 'before' | 'after'): LayerDocument {
  const result = structuredClone(current);
  const changes = side === 'before' ? [...patch.changes].reverse() : patch.changes;
  for (const change of changes) {
    if (!change.path.length || change.path[0] === 'key') throw new Error('編集対象は変更できません');
    let target = result as unknown as Record<string, unknown>;
    for (const key of change.path.slice(0, -1)) {
      const nested = target[key];
      if (!object(nested)) throw new Error('履歴の対象が存在しません');
      target = nested;
    }
    const value = change[side], key = change.path.at(-1)!;
    if (value.present) target[key] = structuredClone(value.value);
    else delete target[key];
  }
  return result;
}
