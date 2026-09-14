import {composeCanvasTransform} from '../geometry/canvasPrecision';
import {RasterTileResource} from '../raster/RasterTileResource';
import {RasterSurface} from '../raster/RasterSurface';
import {previewCache} from '../core/previewCache';
import type {ImageParams} from '../../model';

/** Immutable original image plus compressed tiles; decoded pixels share the raster material LRU. */
export class ImageAsset {
  readonly width:number;
  readonly height:number;
  private readonly surface:RasterSurface;
  private readonly encoded:Promise<Blob>;
  constructor(source:HTMLCanvasElement, original?:Blob) {
    this.width=source.width;this.height=source.height;
    this.encoded=original ? Promise.resolve(original) : new Promise<Blob>((resolve,reject)=>source.toBlob(blob=>blob?resolve(blob):reject(new Error('画像の保存に失敗しました')),'image/png'));
    this.surface=new RasterSurface(25.4);
    this.surface.paint({x:0,y:0,w:this.width,h:this.height},ctx=>ctx.drawImage(source,0,0));
  }
  get retainedBytes():number {return [...this.surface.snapshot().tiles.values()].reduce((bytes,tile)=>bytes+RasterTileResource.from(tile).encodedBytes,0);}
  encode():Promise<Blob> {return this.encoded;}
  draw(ctx:CanvasRenderingContext2D,placement:ImageParams):void {
    ctx.save();composeCanvasTransform(ctx,1,0,0,1,placement.x+placement.width/2,placement.y+placement.height/2);ctx.rotate(placement.rotation);
    ctx.scale(placement.width/this.width,placement.height/this.height);ctx.translate(-this.width/2,-this.height/2);
    this.surface.drawTo(ctx);ctx.restore();
  }
  thumbnail():HTMLCanvasElement {
    const existing=previewCache.get(this);if(existing)return existing;
    const scale=Math.min(1,512/Math.max(this.width,this.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.ceil(this.width*scale));canvas.height=Math.max(1,Math.ceil(this.height*scale));
    const ctx=canvas.getContext('2d')!;ctx.scale(scale,scale);this.surface.drawTo(ctx);
    previewCache.set(this,canvas,canvas.width*canvas.height*4);return canvas;
  }
}
