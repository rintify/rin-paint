import { layoutMatrixPixels } from '../geometry/layoutTransform';
import type { Layer } from '../layers';
import { IDENTITY, multiply, scaling, type Homography } from '../geometry/homography';
import { SceneQuery } from './SceneQuery';

/** Geometry at a canvas boundary is shared by hit testing and color sampling.
 * Outer opacity, adjustment and backgrounds deliberately do not enter scope queries.
 */
export class ScopeTransforms {
  private readonly query: SceneQuery<Layer>;
  private readonly layers: Map<string,Layer>;
  constructor(roots: readonly string[], layers: readonly Layer[], private readonly ppi: number, private readonly ignoredOperators: ReadonlySet<string> = new Set()) {
    this.query=new SceneQuery(roots,layers);
    this.layers=new Map(layers.map(layer=>[layer.id,layer]));
  }

  scopeToPage(scopeId: string | null): Homography {
    let matrix=IDENTITY;
    const seen=new Set<string>();
    while(scopeId !== null) {
      if (seen.has(scopeId)) throw new Error('キャンバスの包含が循環しています');
      seen.add(scopeId);
      const canvas=this.layers.get(scopeId);
      if (canvas?.type !== 'canvas') throw new Error('描画スコープが存在しません');
      matrix=multiply(this.following(canvas),matrix);
      scopeId=this.query.scopeOf(canvas.id);
    }
    return matrix;
  }

  layerToPage(layerId:string): Homography {
    const layer=this.layers.get(layerId);
    if (!layer) throw new Error('レイヤーが存在しません');
    return multiply(this.scopeToPage(this.query.scopeOf(layer.id)),this.following(layer));
  }

  geometryToPage(layerId: string): Homography {
    const layer = this.layers.get(layerId);
    const placement = layer && (layer.type === 'shape' || layer.type === 'image' || layer.type === 'text')
      ? layoutMatrixPixels(layer.state, this.ppi) : IDENTITY;
    return multiply(this.layerToPage(layerId), placement);
  }

  private following(source:Layer):Homography {
    const siblings=this.query.members(this.query.scopeOf(source.id));
    let matrix=IDENTITY;
    for(const layer of siblings.slice(siblings.indexOf(source)+1)) {
      if(layer.type !== 'transform' || !layer.visible || this.ignoredOperators.has(layer.id)) continue;
      const px=this.ppi/25.4;
      matrix=multiply(multiply(scaling(px),multiply(layer.state.matrix,scaling(1/px))),matrix);
    }
    return matrix;
  }
}
