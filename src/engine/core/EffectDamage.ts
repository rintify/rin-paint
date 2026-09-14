import type { DirtyRect } from '../brush';
import type { Layer } from '../layers';
import type { LayerDrawEnv } from '../layer-types/types';
import type { PixelRect } from '../raster/geometry';

interface Damage {
  // null is unbounded (a projective horizon); keep it unbounded through later effects.
  rects: (PixelRect | null)[];
  padding: number;
}

function expand(rect: PixelRect, amount: number): PixelRect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    w: rect.w + amount * 2,
    h: rect.h + amount * 2,
  };
}

/** Follow the same accumulated/isolated scopes as RegionRenderer, in render order. */
export function effectDamage(
  roots: string[],
  env: LayerDrawEnv,
  damages: ReadonlyMap<string, DirtyRect[]> = new Map(),
): Map<string, Damage> {
  const own = (id: string): Damage => ({
    rects: (damages.get(id) ?? []).map((r) => ({
      x: r.minX,
      y: r.minY,
      w: r.maxX - r.minX,
      h: r.maxY - r.minY,
    })),
    padding: 0,
  });
  const merge = (target: Map<string, Damage>, id: string, value: Damage) => {
    const previous = target.get(id);
    target.set(
      id,
      previous
        ? {
            rects: [...previous.rects, ...value.rects],
            padding: Math.max(previous.padding, value.padding),
          }
        : value,
    );
  };
  const activeEffect = (layer: Layer): boolean => {
    if (!env.handlerFor(layer).renderer.effect) return false;
    return (
      layer.visible ||
      layer.childIds.some((id) => {
        const child = env.layerById(id);
        return !!child && activeEffect(child);
      })
    );
  };
  const visit = (ids: string[], state: Map<string, Damage>) => {
    for (const id of ids) {
      const layer = env.layerById(id);
      if (!layer) continue;
      const effect = env.handlerFor(layer).renderer.effect;
      if (effect) {
        if (layer.visible && layer.opacity > 0) {
          const padding = Math.max(0, effect.paddingPx?.(layer, env) ?? 0);
          for (const [sourceId, value] of state) {
            const rects = value.rects.map((rect) => {
              if (!rect) return null;
              const padded = expand(rect, padding);
              return effect.mapDamage
                ? effect.mapDamage(padded, layer, env)
                : padded;
            });
            state.set(sourceId, {
              rects:
                effect.mapDamage && layer.opacity < 1
                  ? [...value.rects, ...rects]
                  : rects,
              padding: value.padding + padding,
            });
          }
          // Mask/dependency edits enter at the effect that consumes them.
          for (const dependency of effect.dependencyLayerIds?.(layer) ?? []) {
            const damage = own(dependency);
            merge(state, dependency, {
              rects: damage.rects.map((r) => r && expand(r, padding)),
              padding,
            });
          }
          if (damages.has(id)) merge(state, id, own(id));
        }
        visit(layer.childIds, state);
      } else if (
        layer.childIds.some((id) => {
          const child = env.layerById(id);
          return !!child && activeEffect(child);
        })
      ) {
        const local = new Map<string, Damage>();
        if (layer.visible) local.set(id, own(id));
        visit(layer.childIds, local);
        for (const [sourceId, value] of local) merge(state, sourceId, value);
      } else {
        if (layer.visible) merge(state, id, own(id));
        visit(layer.childIds, state);
      }
    }
  };
  const result = new Map<string, Damage>();
  visit(roots, result);
  return result;
}
