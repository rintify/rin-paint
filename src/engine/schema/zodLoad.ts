import { z } from 'zod';
import { fillMissing, isPlainObject, unknownKeyPaths } from './defaults';
import type { LoadResult } from './loadResult';

export function loadWithZod<T>(
  schema: z.ZodType<T>,
  loadDefaults: T,
  raw: unknown,
): LoadResult<T> {
  if (raw === undefined) {
    const parsed = schema.safeParse(structuredClone(loadDefaults));
    return parsed.success
      ? { status: 'ok', value: parsed.data }
      : { status: 'invalid', reason: '既定値を検証できません', raw };
  }
  if (!isPlainObject(raw) && isPlainObject(loadDefaults)) {
    return { status: 'invalid', reason: '保存データの構造が不正です', raw };
  }
  const extra = unknownKeyPaths(loadDefaults, raw);
  if (extra.length) {
    return {
      status: 'unsupported',
      reason: `未対応の項目があります: ${extra.join(', ')}`,
      raw,
    };
  }
  const filled = fillMissing(loadDefaults, raw);
  const parsed = schema.safeParse(filled);
  if (!parsed.success) {
    return { status: 'invalid', reason: '保存データの値が不正です', raw };
  }
  return { status: 'ok', value: parsed.data };
}

export function finiteNumber(): z.ZodNumber {
  return z.number().finite();
}
