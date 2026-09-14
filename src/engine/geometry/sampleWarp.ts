import {project, type Homography} from './homography';
export interface WarpPixelsRequest {
  pixels: Uint8ClampedArray; sourceWidth:number; sourceHeight:number;
  inverse:Homography; sourceOrigin:{x:number;y:number}; targetOrigin:{x:number;y:number}; width:number; height:number;
}
/** Premultiplied bilinear interpolation shared by synchronous reads and the rendering Worker. */
export function sampleWarp(request: WarpPixelsRequest): Uint8ClampedArray {
  const {pixels,sourceWidth,sourceHeight,inverse,sourceOrigin,targetOrigin,width,height}=request;
  const output=new Uint8ClampedArray(width*height*4);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const point=project(inverse,{x:x+.5+targetOrigin.x,y:y+.5+targetOrigin.y}); if (!point) continue;
    const sx=point.x-sourceOrigin.x-.5,sy=point.y-sourceOrigin.y-.5;
    const ix=Math.floor(sx),iy=Math.floor(sy),dx=sx-ix,dy=sy-iy;
    let alpha=0,r=0,g=0,b=0;
    for(let j=0;j<2;j++) for(let i=0;i<2;i++) {
      const px=ix+i,py=iy+j; if(px<0||py<0||px>=sourceWidth||py>=sourceHeight) continue;
      const offset=(py*sourceWidth+px)*4,a=pixels[offset+3]/255*(i?dx:1-dx)*(j?dy:1-dy);
      alpha+=a;r+=pixels[offset]*a;g+=pixels[offset+1]*a;b+=pixels[offset+2]*a;
    }
    const offset=(y*width+x)*4;
    if (alpha) {output[offset]=r/alpha;output[offset+1]=g/alpha;output[offset+2]=b/alpha;output[offset+3]=alpha*255;}
  }
  return output;
}
