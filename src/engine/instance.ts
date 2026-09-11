import { PaintEngine } from './PaintEngine';

let cached: PaintEngine | null = null;

/** 初回アクセス時に生成。純粋モジュールの import だけでは起動しない。 */
export function getEngine(): PaintEngine {
  return (cached ??= new PaintEngine());
}

/** Proxy 経由の遅延シングルトン (既存の `import { engine }` 互換) */
export const engine: PaintEngine = new Proxy({} as PaintEngine, {
  get(_target, prop) {
    const inst = getEngine();
    const value = Reflect.get(inst, prop, inst);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(inst) : value;
  },
  set(_target, prop, value) {
    return Reflect.set(getEngine(), prop, value);
  },
});
