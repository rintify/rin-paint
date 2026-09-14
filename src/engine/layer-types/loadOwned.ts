import type { LoadResult } from '../schema';
import { fillMissing, isPlainObject, unknownKeyPaths } from '../schema';

export function loadOwned<S>(
  loadDefaults: S,
  raw: unknown,
  decode: (raw: unknown) => S | null,
): LoadResult<S> {
  if (raw === undefined) return { status: 'ok', value: structuredClone(loadDefaults) };
  const extra = unknownKeyPaths(loadDefaults, raw);
  if (extra.length) {
    return {
      status: 'unsupported',
      reason: `未対応の項目があります: ${extra.join(', ')}`,
      raw,
    };
  }
  const decoded = decode(raw);
  if (!decoded) return { status: 'invalid', reason: '保存データの値が不正です', raw };
  return { status: 'ok', value: decoded };
}

/** 可変な入れ子を持つ状態は、外側のキーだけを検査する。 */
export function loadEnvelope<S>(
  knownKeys: readonly string[],
  loadDefaults: S,
  raw: unknown,
  decode: (raw: unknown) => S | null,
): LoadResult<S> {
  if (raw === undefined) return { status: 'ok', value: structuredClone(loadDefaults) };
  if (!isPlainObject(raw)) {
    return { status: 'invalid', reason: '保存データの構造が不正です', raw };
  }
  const extra = Object.keys(raw).filter((key) => !knownKeys.includes(key));
  if (extra.length) {
    return {
      status: 'unsupported',
      reason: `未対応の項目があります: ${extra.join(', ')}`,
      raw,
    };
  }
  const decoded = decode(fillMissing(loadDefaults, raw));
  if (!decoded) return { status: 'invalid', reason: '保存データの値が不正です', raw };
  return { status: 'ok', value: decoded };
}
