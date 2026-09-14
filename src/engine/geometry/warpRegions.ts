import { inverse, project, transformBounds, type Homography, type RectMm } from './homography';

/** Rectangles here are pixel-space requests. No allocation depends on distance from the origin. */
export interface WarpRegion { output: RectMm; input: RectMm }
const MAX_INPUT_SIDE = 1024;
const OUTPUT_TILE_SIDE = 256;

/** Split requests near projective horizons and under strong minification.
 * A single output pixel needs only the bilinear neighborhood of its inverse-mapped center.
 */
export function* warpRegions(matrix: Homography, output: RectMm): IterableIterator<WarpRegion> {
  const inv = inverse(matrix);
  if (!inv || output.w <= 0 || output.h <= 0) return;
  function* split(rect: RectMm): IterableIterator<WarpRegion> {
    let needed = transformBounds(inv!,rect);
    if (rect.w === 1 && rect.h === 1) {
      const center = project(inv!,{x:rect.x+.5,y:rect.y+.5});
      if (!center) return;
      needed = {x:center.x-.5,y:center.y-.5,w:1,h:1};
    }
    if (needed) {
      const x=Math.floor(needed.x)-1,y=Math.floor(needed.y)-1;
      const w=Math.ceil(needed.x+needed.w)+1-x,h=Math.ceil(needed.y+needed.h)+1-y;
      if ([x,y,w,h].every(Number.isSafeInteger) && w>0 && h>0 && w<=MAX_INPUT_SIDE && h<=MAX_INPUT_SIDE) {
        yield {output:rect,input:{x,y,w,h}};
        return;
      }
    }
    if (rect.w === 1 && rect.h === 1) return;
    if (rect.w >= rect.h && rect.w > 1) {
      const width=Math.floor(rect.w/2);
      yield* split({...rect,w:width});
      yield* split({...rect,x:rect.x+width,w:rect.w-width});
    } else {
      const height=Math.floor(rect.h/2);
      yield* split({...rect,h:height});
      yield* split({...rect,y:rect.y+height,h:rect.h-height});
    }
  }
  for(let y=0;y<output.h;y+=OUTPUT_TILE_SIDE) for(let x=0;x<output.w;x+=OUTPUT_TILE_SIDE) {
    yield* split({x:output.x+x,y:output.y+y,w:Math.min(OUTPUT_TILE_SIDE,output.w-x),h:Math.min(OUTPUT_TILE_SIDE,output.h-y)});
  }
}
