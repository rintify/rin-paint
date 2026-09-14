import { ScopeTransforms } from './ScopeTransforms';
import { isSimilarity } from '../geometry/layoutTransform';
import { useStore } from '../../state/store';
import { createTransformLayer } from '../layers';
import { initialOperator } from './TransformService';
import { IDENTITY, inverse, project, transformBounds, fromQuads, multiply, scaling, conjugate, type Homography } from '../geometry/homography';
import { layerHandler, layerTypeProps } from '../layer-types/registry';
import { unionRect, type DirtyRect } from '../brush';
import type { PaintEngine, SelectedObjectTransform } from '../PaintEngine';

/** Multi-object selection transforms (lasso free-transform of shapes/text). */
export class ObjectTransform {
  constructor(private engine: PaintEngine) {}

  selectedObjectsInRect(rect: DirtyRect, polygon?: { x: number; y: number }[]): SelectedObjectTransform[] {
    const targets=this.engine.transforms.targets();
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
    const scopes = new ScopeTransforms(eng.getRootLayerIds(), eng.allLayers(), eng.getPageSpec().ppi);
    return targets.flatMap((target):SelectedObjectTransform[]=>{
      const layer=eng.layerById(target.id);
      if(target.canvasId) return [{...target,before:{state:initialOperator()}}];
      if(!layer || layer.type==='raster') return [];
      if(layer.type==='transform'||layer.type==='outline') return [{...target,before:layerTypeProps(layer)}];
      const bounds=layerHandler(layer).capabilities.objectTransform?.bounds(layer as never,env);
      const visible = bounds && transformBounds(scopes.layerToPage(layer.id), bounds);
      if(!bounds || !visible || visible.x>rect.maxX || visible.y>rect.maxY || visible.x+visible.w<rect.minX || visible.y+visible.h<rect.minY || !intersectsPolygon(visible)) return [];
      return [{...target,before:layerTypeProps(layer),width:bounds.width,height:bounds.height}];
    });
  }

  previewObjectGroup(entries: SelectedObjectTransform[], source: { x: number; y: number }[], target: { x: number; y: number }[]): void {
    if (source.length < 4 || target.length < 4) return;
    const eng = this.engine;
    const matrix=fromQuads(source,target);
    if(!matrix) return;
    const px=eng.getPageSpec().ppi/25.4;
    const env = eng.compositor.measureEnv();
    const dirtyFor = (bounds: { x: number; y: number; w: number; h: number } | null): DirtyRect | null => bounds ? ({
      minX: bounds.x - 2,
      minY: bounds.y - 2,
      maxX: bounds.x + bounds.w + 2,
      maxY: bounds.y + bounds.h + 2,
    }) : null;
    for (const entry of entries) {
      const basis = entry.basis ?? IDENTITY, inverseBasis = inverse(basis); if (!inverseBasis) continue;
      const local = multiply(inverseBasis, multiply(matrix, basis));
      const matrixMm = multiply(scaling(1 / px), multiply(local, scaling(px)));
      const scale = Math.hypot(matrixMm[0], matrixMm[3]) / Math.abs(matrixMm[8]);
      const angle = Math.atan2(matrixMm[3], matrixMm[0]);
      let layer = eng.layerService.byId(entry.id);
      if(!layer && entry.canvasId) {
        const canvas=eng.layerById(entry.canvasId);
        if(canvas?.type!=='canvas') continue;
        layer=createTransformLayer(eng.layerService.nextLayerName('transform'),entry.id);
        eng.layerService.layers.push(layer);
        eng.layerService.insertAt(layer.id,{parentId:canvas.id,index:canvas.childIds.length});
        entry.created=true;
      }
      if (layer) {
        if (layer.type === 'raster') {
          layer.state.matrix = multiply(matrixMm, (entry.before.state as typeof layer.state).matrix);
          eng.links.propagateFrom({document: eng.documentKey, layerId: layer.id}, true);
          eng.bumpLayer(layer.id); continue;
        }
        if(layer.type==='transform') {
          const before=(entry.before.state as {matrix:Homography}).matrix;
          layer.state.matrix=entry.mode==='operator'?conjugate(before,matrixMm):multiply(matrixMm,before);
          eng.links.propagateFrom({document:eng.documentKey,layerId:layer.id},true);
          eng.bumpLayer(layer.id);continue;
        }
        if(layer.type==='outline') {
          const before=entry.before.state as typeof layer.state;
          layer.state = isSimilarity(matrixMm)
            ? {matrix: conjugate(before.matrix ?? IDENTITY, matrixMm), outline: {...before.outline, widthMm: before.outline.widthMm * scale}}
            : {matrix: multiply(matrixMm, before.matrix ?? IDENTITY), outline: {...before.outline}};
          eng.links.propagateFrom({document:eng.documentKey,layerId:layer.id},true);
          eng.bumpLayer(layer.id);continue;
        }
        if (layer.type === 'shape' || layer.type === 'image' || layer.type === 'text') {
          const original = entry.before.state as typeof layer.state;
          if (!isSimilarity(matrixMm)) {
            layer.state = {...structuredClone(original), matrix: multiply(matrixMm, original.matrix ?? IDENTITY)};
            eng.links.propagateFrom({document: eng.documentKey, layerId: layer.id}, true);
            eng.bumpLayer(layer.id); continue;
          }
          if (original.matrix) layer.state.matrix = conjugate(original.matrix, matrixMm);
        }
        const objectTransform = layerHandler(layer).capabilities.objectTransform;
        const beforeBounds = dirtyFor(objectTransform?.bounds(layer as never, env) ?? null);
        const beforeState = (entry.before.state ?? layerHandler(layer).state.clone(layer.state as never)) as never;
        objectTransform?.apply(layer as never, {
          before: beforeState,
          transform: (x, y) => project(matrixMm, {x, y}) ?? {x, y},
          scale,
          angle,
          width: entry.width === undefined ? undefined : entry.width / px,
          height: entry.height === undefined ? undefined : entry.height / px,
        });
        const afterBounds = dirtyFor(objectTransform?.bounds(layer as never, env) ?? null);
        const dirty = beforeBounds && afterBounds ? unionRect(beforeBounds, afterBounds) : beforeBounds ?? afterBounds;
        eng.layerService.bumpLayer(entry.id, dirty ?? undefined);
        eng.links.propagateFrom({ document: eng.documentKey, layerId: entry.id }, true);
      }
    }
    eng.syncTextRendersPublic(); eng.syncStore();
  }

  commitObjectGroup(entries: SelectedObjectTransform[]): void {
    const eng = this.engine;
    const ops=this.commitOps(entries);
    if (!ops.length) return;
    eng.history.push(ops.length === 1 ? ops[0] : { kind: 'batch', ops }, '複数オブジェクトを変形');
    eng.committed();
  }

  commitOps(entries:SelectedObjectTransform[]):import('../history/historyTree').AtomicOp[] {
    const eng=this.engine;
    return entries.flatMap((entry):import('../history/historyTree').AtomicOp[]=>{
      const layer=eng.layerById(entry.id);if(!layer) return [];
      if(entry.created) {
        const state=useStore.getState();
        const selection={activeLayerId:eng.getActiveLayerId(),selectedLayerIds:[...state.selectedLayerIds],multiSelectMode:state.multiSelectMode};
        return [{kind:'layerReplace',before:{rootIds:[],entries:[],selection},after:{rootIds:[layer.id],selection,
          entries:[{location:eng.layerService.locationOf(layer.id)!,snapshot:eng.layerService.snapshotLayer(layer,false)}]}}];
      }
      const after=layerTypeProps(layer);
      if(JSON.stringify(entry.before)===JSON.stringify(after)) return [];
      const propsOp={kind:'layerProps' as const,layerId:entry.id,before:entry.before,after};
      const linkOp=eng.layerService.linkOpForUserChange(layer,entry.before,after);
      eng.links.propagateFrom({document:eng.documentKey,layerId:entry.id});
      return linkOp?[propsOp,linkOp]:[propsOp];
    });
  }

  restoreObjectGroup(entries: SelectedObjectTransform[]): void {
    const eng = this.engine;
    for (const entry of entries) {
      const layer = eng.layerService.byId(entry.id);
      if(entry.created) {eng.layerService.removeLayerInternal(entry.id);entry.created=false;}
      else if (layer) eng.layerService.assignProps(layer, entry.before);
    }
    eng.syncTextRendersPublic();
    eng.requestRender();
    eng.syncStore();
  }
}
