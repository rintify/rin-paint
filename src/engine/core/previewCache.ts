import {ByteLru} from '../raster/ByteLru';
/** Image and text thumbnails share the same eight-MiB render-cache allocation. */
export const previewCache=new ByteLru<object,HTMLCanvasElement>(8*1024*1024,canvas=>{canvas.width=canvas.height=0;});
