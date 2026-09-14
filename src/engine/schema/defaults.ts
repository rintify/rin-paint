export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 欠けている項目だけ補う。false / 0 / [] / null は欠損にしない。 */
export function fillMissing<T>(loadDefaults: T, raw: unknown): T {
  if (raw === undefined) return structuredClone(loadDefaults);
  if (isPlainObject(loadDefaults) && isPlainObject(raw)) {
    const result = structuredClone(raw) as T;
    for (const key of Object.keys(loadDefaults) as (keyof T & string)[]) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        (result as Record<string, unknown>)[key] = fillMissing(
          (loadDefaults as Record<string, unknown>)[key],
          raw[key],
        );
      } else {
        (result as Record<string, unknown>)[key] = structuredClone(
          (loadDefaults as Record<string, unknown>)[key],
        );
      }
    }
    return result;
  }
  return raw as T;
}

export function unknownKeyPaths(loadDefaults: unknown, raw: unknown, path = ''): string[] {
  if (!isPlainObject(raw) || !isPlainObject(loadDefaults)) return [];
  const extra: string[] = [];
  for (const key of Object.keys(raw)) {
    const next = path ? `${path}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(loadDefaults, key)) extra.push(next);
    else extra.push(...unknownKeyPaths(loadDefaults[key], raw[key], next));
  }
  return extra;
}
