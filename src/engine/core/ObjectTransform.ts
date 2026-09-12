import { useStore } from '../../state/store';
import { layerHandler, objectTransformProps } from '../layer-types/registry';
import { unionRect, type DirtyRect } from '../brush';
import type { PaintEngine, SelectedObjectTransform } from '../PaintEngine';

/** Multi-object selection transforms (lasso free-transform of shapes/text). */
export class ObjectTransform {
  constructor(private engine: PaintEngine) {}

  selectedObjectsInRect(rect: DirtyRect, polygon?: { x: number; y: number }[]): SelectedObjectTransform[] {
    const ids = new Set(useStore.getState().selectedLayerIds);
    const pointInPolygon = (point: { x: number; y: number }) => {
      if (!polygon?.length) return true;
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    const intersectsPolygon = (bounds: { x: number; y: number; w: number; h: number }) => {
      if (!polygon?.length) return true;
      const corners = [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.w, y: bounds.y }, { x: bounds.x + bounds.w, y: bounds.y + bounds.h }, { x: bounds.x, y: bounds.y + bounds.h }];
      if (polygon.some(point => point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h) || corners.some(pointInPolygon)) return true;
      const cross = (a: {x:number;y:number}, b: {x:number;y:number}, c: {x:number;y:number}) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
      for (let i = 0; i < polygon.length; i++) for (let j = 0; j < 4; j++) { const a=polygon[i], b=polygon[(i+1)%polygon.length], c=corners[j], d=corners[(j+1)%4]; if (cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0) return true; }
      return false;
    };
    const eng = this.engine;
    const env = eng.compositor.measureEnv();
    return eng.layerService.layers.flatMap(layer => {
      if (!ids.has(layer.id)) return [];
      const bounds = layerHandler(layer).objectTransform?.bounds(layer, env);
      if (!bounds) return [];
      if (bounds.x > rect.maxX || bounds.y > rect.maxY || bounds.x + bounds.w < rect.minX || bounds.y + bounds.h < rect.minY || !intersectsPolygon(bounds)) return [];
      return [{ id: layer.id, before: objectTransformProps(layer), width: bounds.width, height: bounds.height }];
    });
  }

  previewObjectGroup(entries: SelectedObjectTransform[], source: { x: number; y: number }[], target: { x: number; y: number }[]): void {
    if (source.length < 4 || target.length < 4) return;
    const eng = this.engine;
    const src = { x: (source[0].x + source[2].x) / 2, y: (source[0].y + source[2].y) / 2 };
    const dst = { x: (target[0].x + target[2].x) / 2, y: (target[0].y + target[2].y) / 2 };
    const srcEdge = { x: source[1].x - source[0].x, y: source[1].y - source[0].y };
    const dstEdge = { x: target[1].x - target[0].x, y: target[1].y - target[0].y };
    const scale = Math.max(.01, Math.hypot(dstEdge.x, dstEdge.y) / Math.max(.01, Math.hypot(srcEdge.x, srcEdge.y)));
    const angle = Math.atan2(dstEdge.y, dstEdge.x) - Math.atan2(srcEdge.y, srcEdge.x);
    const transform = (x: number, y: number) => { const dx = (x - src.x) * scale, dy = (y - src.y) * scale; return { x: dst.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: dst.y + dx * Math.sin(angle) + dy * Math.cos(angle) }; };
    const env = eng.compositor.measureEnv();
    const dirtyFor = (bounds: { x: number; y: number; w: number; h: number } | null): DirtyRect | null => bounds ? ({
      minX: bounds.x - 2,
      minY: bounds.y - 2,
      maxX: bounds.x + bounds.w + 2,
      maxY: bounds.y + bounds.h + 2,
    }) : null;
    for (const entry of entries) {
      const layer = eng.layerService.byId(entry.id);
      if (layer) {
        const objectTransform = layerHandler(layer).objectTransform;
        const beforeBounds = dirtyFor(objectTransform?.bounds(layer, env) ?? null);
        objectTransform?.apply(layer, {
          before: entry.before,
          transform,
          scale,
          angle,
          width: entry.width,
          height: entry.height,
        });
        const afterBounds = dirtyFor(objectTransform?.bounds(layer, env) ?? null);
        const dirty = beforeBounds && afterBounds ? unionRect(beforeBounds, afterBounds) : beforeBounds ?? afterBounds;
        eng.layerService.bumpLayer(entry.id, dirty ?? undefined);
      }
    }
    eng.syncTextRendersPublic(); eng.syncStore();
  }

  commitObjectGroup(entries: SelectedObjectTransform[]): void {
    const eng = this.engine;
    const ops = entries.flatMap(entry => {
      const layer = eng.layerService.byId(entry.id);
      if (!layer) return [];
      return [{ kind: 'layerProps' as const, layerId: entry.id, before: entry.before, after: objectTransformProps(layer) }];
    });
    if (!ops.length) return;
    eng.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, '複数オブジェクトを変形');
    eng.committed();
  }

  restoreObjectGroup(entries: SelectedObjectTransform[]): void {
    const eng = this.engine;
    for (const entry of entries) {
      const layer = eng.layerService.byId(entry.id);
      if (layer) eng.layerService.assignProps(layer, entry.before);
    }
    eng.syncTextRendersPublic();
    eng.requestRender();
    eng.syncStore();
  }
}
