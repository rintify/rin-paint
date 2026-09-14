import type { LayerMeta } from '../../model';
import { SceneQuery } from '../../engine/core/SceneQuery';

export function canUseLayerAsMask(roots: string[], layers: LayerMeta[], targetId: string, sourceId: string): boolean {
  return new SceneQuery(roots,layers).maskProblem(targetId,sourceId) === null;
}

export function maskCandidateRows(roots: string[], layers: LayerMeta[], excludedId: string, query: string): { layer: LayerMeta; depth: number }[] {
  const scene = new SceneQuery(roots,layers);
  const text = query.trim().toLocaleLowerCase();
  return scene.members(scene.scopeOf(excludedId))
    .filter(layer => scene.maskProblem(excludedId,layer.id) === null && (!text || layer.name.toLocaleLowerCase().includes(text)))
    .map(layer => ({layer,depth:0}));
}
