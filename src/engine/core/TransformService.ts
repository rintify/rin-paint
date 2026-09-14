import { ScopeTransforms } from './ScopeTransforms';
import { useStore } from '../../state/store';
import type { PaintEngine } from '../PaintEngine';
import { newLayerId, type Layer, type RasterLayer } from '../layers';
import { layerHandler } from '../layer-types/registry';
import { IDENTITY, multiply, scaling, translation, transformBounds, type Homography } from '../geometry/homography';
import type { ObjectBounds } from '../layer-types/types';

export interface TransformTarget { id:string; mode:'content'|'operator'|'terminal'; canvasId?:string; basisLayerId?:string; basis?:Homography }

/** Selection stays in the GUI; operation targets are expanded independently and frozen by the tool. */
export class TransformService {
  constructor(private readonly engine:PaintEngine) {}
  targets():TransformTarget[] {
    const state=useStore.getState(),ls=this.engine.layerService;
    const selected=state.multiSelectMode?state.selectedLayerIds:[ls.activeLayerId];
    const result=new Map<string,TransformTarget>();
    const visit=(id:string,propagated:boolean,basisLayerId?:string):void=>{
      const layer=ls.byId(id);
      if (!layer) return;
      if (layer.type==='canvas') {
        if (layer.state.propagateTransforms) for(const child of layer.childIds) visit(child,true,basisLayerId ?? layer.id);
        else {
          const last=ls.byId(layer.childIds.at(-1)??'');
          const target:TransformTarget=last?.type==='transform'?{id:last.id,mode:'terminal'}:{id:newLayerId(),mode:'terminal',canvasId:layer.id};
          result.set(target.id,{...target,basisLayerId:basisLayerId ?? layer.id});
        }
      } else result.set(id,{id,mode:layer.type==='transform'?(propagated?'operator':'terminal'):'content',basisLayerId:basisLayerId ?? id});
    };
    for(const id of selected) visit(id,false);
    const ignored = new Set([...result.values()].filter(target => this.engine.layerById(target.id)?.type === 'transform').map(target => target.id));
    const scopes = new ScopeTransforms(this.engine.getRootLayerIds(), this.engine.allLayers(), this.engine.getPageSpec().ppi, ignored);
    return [...result.values()].map(target => ({...target, basis: scopes.layerToPage(target.basisLayerId!)}));
  }
  rasters(targets=this.targets()):RasterLayer[] {
    return targets.flatMap(target=>{const layer=this.engine.layerById(target.id);return layer?.type==='raster'?[layer]:[];});
  }
  selectionBounds():ObjectBounds|null {
    const state=useStore.getState();
    const ids = state.multiSelectMode ? state.selectedLayerIds : [this.engine.getActiveLayerId()];
    const scopes = new ScopeTransforms(this.engine.getRootLayerIds(), this.engine.allLayers(), this.engine.getPageSpec().ppi);
    let bounds: ObjectBounds | null = null;
    for (const id of ids) {
      const local = this.boundsForIds([id]); if (!local) continue;
      const projected = transformBounds(scopes.layerToPage(id), local); if (!projected) continue;
      if (!bounds) bounds = projected;
      else {
        const x = Math.min(bounds.x, projected.x), y = Math.min(bounds.y, projected.y);
        bounds = {x, y, w: Math.max(bounds.x + bounds.w, projected.x + projected.w) - x,
          h: Math.max(bounds.y + bounds.h, projected.y + projected.h) - y};
      }
    }
    return bounds;
  }
  boundsForIds(ids:readonly string[]):ObjectBounds|null {
    let result:ObjectBounds|null=null;
    const merge=(next:ObjectBounds|null)=>{
      if(!next) return;
      if(!result) {result=next;return;}
      const x=Math.min(result.x,next.x),y=Math.min(result.y,next.y);
      result={x,y,w:Math.max(result.x+result.w,next.x+next.w)-x,h:Math.max(result.y+result.h,next.y+next.h)-y};
    };
    for(const id of ids) {
      const layer=this.engine.layerById(id);if(!layer) continue;
      if(layer.type==='canvas') {merge(this.boundsForIds(layer.childIds));continue;}
      if(layer.type==='transform') {
        if (!result) {
          const siblings = this.engine.layerService.siblingIds(this.engine.layerService.scopeOf(layer.id));
          merge(this.boundsForIds(siblings.slice(0, siblings.indexOf(id))));
        }
        if (result) {
          const px = this.engine.getPageSpec().ppi / 25.4;
          result = transformBounds(multiply(scaling(px), multiply(layer.state.matrix, scaling(1 / px))), result);
        }
        continue;
      }
      merge(this.contentBounds(layer));
    }
    return result;
  }
  private contentBounds(layer:Layer):ObjectBounds|null {
    if (layer.type === 'raster') {
      const surface = layer.runtime.surface, bounds = surface.bounds();
      const px = this.engine.getPageSpec().ppi / 25.4;
      const matrix = multiply(scaling(px), multiply(layer.state.matrix,
        multiply(translation(surface.originMm.x, surface.originMm.y), scaling(25.4 / surface.intrinsicPpi))));
      return bounds ? transformBounds(matrix, bounds) : null;
    }
    return layerHandler(layer).capabilities.objectTransform?.bounds(layer as never,this.engine.compositor.measureEnv())??null;
  }
}

export const initialOperator=():{matrix:Homography}=>({matrix:[...IDENTITY]});
