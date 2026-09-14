/** 読み込み結果。未知項目の削除や、不正値の黙った置換はしない。 */
export type LoadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'unsupported'; reason: string; raw: unknown }
  | { status: 'invalid'; reason: string; raw: unknown };

export function isOk<T>(result: LoadResult<T>): result is { status: 'ok'; value: T } {
  return result.status === 'ok';
}

export function loadError(result: LoadResult<unknown>): Error {
  return new Error(result.status === 'ok' ? '読み込み結果が成功です' : result.reason);
}
