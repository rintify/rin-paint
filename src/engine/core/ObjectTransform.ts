import { useStore } from '../../state/store';
import type { LayerProps } from '../history/historyTree';
import { shapeBounds } from '../shapes';
import type { DirtyRect } from '../brush';
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
    return eng.layerService.layers.flatMap(layer => {
      if (!ids.has(layer.id) || (layer.type !== 'shape' && layer.type !== 'text')) return [];
      let bounds: { x: number; y: number; w: number; h: number };
      let width: number | undefined, height: number | undefined;
      if (layer.type === 'shape') bounds = shapeBounds(layer.shape);
      else {
        const canvas = eng.compositor.textRenderer.get(layer.id);
        width = layer.text.width ?? Math.max(24, Number(canvas?.dataset.textWidth ?? 100));
        height = layer.text.height ?? Math.max(24, Number(canvas?.dataset.textHeight ?? 60));
        bounds = { x: layer.text.x, y: layer.text.y, w: width, h: height };
      }
      if (bounds.x > rect.maxX || bounds.y > rect.maxY || bounds.x + bounds.w < rect.minX || bounds.y + bounds.h < rect.minY || !intersectsPolygon(bounds)) return [];
      return [{ id: layer.id, before: layer.type === 'shape' ? { shape: { ...layer.shape } } : { text: structuredClone(layer.text) }, width, height }];
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
    for (const entry of entries) {
      const layer = eng.layerService.byId(entry.id);
      if (layer?.type === 'shape' && entry.before.shape) {
        const shape = entry.before.shape;
        if (shape.kind === 'line') { const a = transform(shape.x1, shape.y1), b = transform(shape.x2, shape.y2); layer.shape = { ...shape, x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: shape.width * scale }; }
        else if (shape.kind === 'rect') { const c = transform(shape.x + shape.width / 2, shape.y + shape.height / 2), w = shape.width * scale, h = shape.height * scale; layer.shape = { ...shape, x: c.x - w / 2, y: c.y - h / 2, width: w, height: h, strokeWidth: shape.strokeWidth * scale, rotation: (shape.rotation ?? 0) + angle }; }
        else { const c = transform(shape.cx, shape.cy); layer.shape = { ...shape, cx: c.x, cy: c.y, rx: shape.rx * scale, ry: shape.ry * scale, strokeWidth: shape.strokeWidth * scale, rotation: (shape.rotation ?? 0) + angle }; }
      } else if (layer?.type === 'text' && entry.before.text) {
        const text = entry.before.text, width = entry.width ?? text.width ?? 100, height = entry.height ?? text.height ?? 60;
        const center = transform(text.x + width / 2, text.y + height / 2), nextWidth = width * scale, nextHeight = height * scale;
        layer.text = { ...structuredClone(text), x: center.x - nextWidth / 2, y: center.y - nextHeight / 2, width: text.width === null ? null : nextWidth, height: text.height === null ? null : nextHeight, rotation: (text.rotation ?? 0) + angle, style: { ...text.style, sizePt: text.style.sizePt * scale }, ranges: text.ranges.map(range => ({ ...range, sizePt: range.sizePt * scale })) };
      }
      eng.layerService.bumpLayer(entry.id);
    }
    eng.syncTextRendersPublic(); eng.requestRender(); eng.syncStore();
  }

  commitObjectGroup(entries: SelectedObjectTransform[]): void {
    const eng = this.engine;
    const ops = entries.flatMap(entry => {
      const layer = eng.layerService.byId(entry.id);
      if (!layer) return [];
      const after: LayerProps = layer.type === 'shape' ? { shape: { ...layer.shape } } : layer.type === 'text' ? { text: structuredClone(layer.text) } : {};
      return [{ kind: 'layerProps' as const, layerId: entry.id, before: entry.before, after }];
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
