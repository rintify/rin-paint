export interface StateOverride { value?: unknown; remove?: true }
export type StateOverrides = Record<string, StateOverride>;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const encode = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** Matrices expose independent coefficients; other arrays represent one authored content field. */
export function stateChanges(before: unknown, after: unknown, path = ''): StateOverrides {
  if (JSON.stringify(before) === JSON.stringify(after)) return {};
  const matrix = path.endsWith('/matrix') && Array.isArray(before) && Array.isArray(after) && before.length === after.length;
  if ((record(before) && record(after)) || matrix) {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>;
    return Object.assign({}, ...[...new Set([...Object.keys(a), ...Object.keys(b)])]
      .map(key => stateChanges(a[key], b[key], `${path}/${encode(key)}`)));
  }
  return {[path]: after === undefined ? {remove: true} : {value: structuredClone(after)}};
}

export function applyStateOverrides(value: unknown, changes: StateOverrides): unknown {
  let result = structuredClone(value);
  for (const [path, change] of Object.entries(changes)) {
    if (!path) {result = change.remove ? undefined : structuredClone(change.value); continue;}
    const keys = path.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
    if (!path.startsWith('/') || keys.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('項目差分のパスが不正です');
    let target = result as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      target = target[key] as Record<string, unknown>;
    }
    if (change.remove) delete target[keys.at(-1)!]; else target[keys.at(-1)!] = structuredClone(change.value);
  }
  return result;
}
