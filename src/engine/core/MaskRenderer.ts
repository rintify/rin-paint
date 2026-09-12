import type { Layer } from '../layers';
import type { LayerDrawEnv, MaskCanvas } from '../layer-types/types';
import type { EffectCache } from './EffectCache';

interface CacheEntry {
  canvas: HTMLCanvasElement;
}

const noop = () => undefined;

/** 表示状態に依存しない、効果レイヤー共通のアルファマスク生成・LRUキャッシュ。 */
export class MaskRenderer {
  private readonly keysByLayer = new Map<string, Set<string>>();
  private readonly layersByKey = new Map<string, string[]>();
  hits = 0;
  misses = 0;

  constructor(private readonly cache: EffectCache) {}

  render(
    ids: string[],
    env: LayerDrawEnv,
    revisionFor: (id: string) => number,
  ): MaskCanvas | null {
    const sources = [...new Set(ids)].sort()
      .map(id => env.layerById(id))
      .filter((layer): layer is Layer => !!layer && !!env.handlerFor(layer).renderer.drawMask);
    if (!sources.length) return null;

    const mask = env.handlerFor(sources[0]).capabilities.maskSource?.nativeCanvas?.(sources[0] as never);
    if (sources.length === 1 && mask) {
      return { canvas: mask, opacity: sources[0].opacity, release: noop };
    }

    if (sources.some(source => env.handlerFor(source).capabilities.maskSource?.uncacheable?.(source as never))) {
      const canvas = document.createElement('canvas');
      canvas.width = env.artboard.w;
      canvas.height = env.artboard.h;
      const ctx = canvas.getContext('2d')!;
      for (const source of sources) {
        ctx.save();
        // 効果の contribution は適用時の不透明度をすでに含む。
        ctx.globalAlpha = env.handlerFor(source).capabilities.maskSource?.drawOpacity(source as never) ?? source.opacity;
        ctx.globalCompositeOperation = 'source-over';
        env.handlerFor(source).renderer.drawMask!(ctx, source as never, env);
        ctx.restore();
      }
      return {
        canvas,
        opacity: 1,
        release: () => { canvas.width = 0; canvas.height = 0; },
      };
    }

    const key = [
      env.artboard.w,
      env.artboard.h,
      ...sources.map(layer => `${layer.id}:${revisionFor(layer.id)}:${layer.opacity}`),
    ].join('|');
    const cached = this.cache.get<CacheEntry>(key);
    if (cached) {
      this.hits++;
      return { canvas: cached.canvas, opacity: 1, release: noop };
    }

    this.misses++;
    const canvas = document.createElement('canvas');
    canvas.width = env.artboard.w;
    canvas.height = env.artboard.h;
    const ctx = canvas.getContext('2d')!;
    for (const source of sources) {
      ctx.save();
      ctx.globalAlpha = env.handlerFor(source).capabilities.maskSource?.drawOpacity(source as never) ?? source.opacity;
      ctx.globalCompositeOperation = 'source-over';
      env.handlerFor(source).renderer.drawMask!(ctx, source as never, env);
      ctx.restore();
    }
    const entry: CacheEntry = { canvas };
    this.cache.set(
      key,
      entry,
      canvas.width * canvas.height * 4,
      () => {
        canvas.width = 0;
        canvas.height = 0;
        this.forgetReferences(key);
      },
    );
    this.layersByKey.set(key, sources.map(source => source.id));
    for (const source of sources) {
      const keys = this.keysByLayer.get(source.id) ?? new Set<string>();
      keys.add(key);
      this.keysByLayer.set(source.id, keys);
    }
    return { canvas, opacity: 1, release: noop };
  }

  invalidateLayer(id: string): void {
    for (const key of [...(this.keysByLayer.get(id) ?? [])]) this.cache.delete(key);
    this.keysByLayer.delete(id);
  }

  clear(): void {
    const keys = new Set([...this.keysByLayer.values()].flatMap(value => [...value]));
    for (const key of keys) this.cache.delete(key);
    this.keysByLayer.clear();
    this.layersByKey.clear();
  }

  private forgetReferences(key: string): void {
    for (const id of this.layersByKey.get(key) ?? []) {
      const keys = this.keysByLayer.get(id);
      keys?.delete(key);
      if (!keys?.size) this.keysByLayer.delete(id);
    }
    this.layersByKey.delete(key);
  }
}
