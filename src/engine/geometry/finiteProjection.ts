import {project,transformBounds,type Homography,type RectMm} from './homography';

/** Preserve finite parts of a brush/tile straddling a projective horizon. Requests are
 * subdivided in source pixels; near-singular pixel footprints never create huge tile ranges.
 */
export function* finiteProjection(matrix:Homography,source:RectMm):IterableIterator<RectMm> {
  const projective=Math.abs(matrix[6])+Math.abs(matrix[7])>1e-12;
  const extent=transformBounds(matrix,source);
  if (!projective) {if(extent)yield extent;return;}
  const maxFootprint=4096;
  if (extent && extent.w<=maxFootprint && extent.h<=maxFootprint) {yield extent;return;}
  if (source.w<=1 && source.h<=1) {
    const center=project(matrix,{x:source.x+source.w/2,y:source.y+source.h/2});
    if (center && extent && extent.w<=maxFootprint && extent.h<=maxFootprint) yield extent;
    return;
  }
  if(source.w>=source.h && source.w>1) {
    const width=source.w/2;yield* finiteProjection(matrix,{...source,w:width});yield* finiteProjection(matrix,{...source,x:source.x+width,w:source.w-width});
  } else {
    const height=source.h/2;yield* finiteProjection(matrix,{...source,h:height});yield* finiteProjection(matrix,{...source,y:source.y+height,h:source.h-height});
  }
}
