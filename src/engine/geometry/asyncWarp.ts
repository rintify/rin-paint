import type {WarpPixelsRequest} from './sampleWarp';
import {ByteLru} from '../raster/ByteLru';

const cache=new ByteLru<string,Uint8ClampedArray>(11*1024*1024);
let worker:Worker|null|undefined, sequence=0, pendingBytes=0;
const jobs=new Map<string,{id:number;ready:()=>void;bytes:number;width:number;height:number}>();
let context:{ready:()=>void;pending:boolean}|null=null;

export function withAsyncWarp(ready:()=>void, render:()=>void): void {
  const previous=context;context={ready,pending:false};
  try {render();} finally {context=previous;}
}
export function hasPendingWarp(): boolean {return context?.pending ?? false;}
function backend(): Worker|null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') return worker=null;
  try {
    worker=new Worker(new URL('./warpWorker.ts',import.meta.url),{type:'module'});
    worker.onmessage=event=>{
      const {id,pixels}=event.data as {id:number;pixels?:Uint8ClampedArray};
      const entry=[...jobs].find(([,job])=>job.id===id);if (!entry) return;
      const [key,job]=entry;jobs.delete(key);pendingBytes-=job.bytes;
      if (pixels) cache.set(key,pixels,pixels.byteLength);
      else {worker?.terminate();worker=null;}
      job.ready();
    };
    worker.onerror=()=>{
      worker?.terminate();worker=null;
      const waiting=[...jobs.values()];jobs.clear();pendingBytes=0;waiting.forEach(job=>job.ready());
    };
  } catch {worker=null;}
  return worker;
}
function keyFor(request:WarpPixelsRequest):string {
  let a=2166136261,b=2246822519;
  for (const byte of request.pixels) {a=Math.imul(a^byte,16777619);b=Math.imul(b^byte,3266489917);}
  return `${a>>>0}:${b>>>0}:${JSON.stringify({...request,pixels:undefined})}`;
}

/** Returns false for immediate read operations or when the bounded Worker queue is full. */
export function deferredWarp(request:WarpPixelsRequest, target:CanvasRenderingContext2D): boolean {
  if (!context) return false;
  const sampler=backend();if (!sampler) return false;
  const key=keyFor(request), pixels=cache.get(key);
  if (pixels) {const image=target.createImageData(request.width,request.height);image.data.set(pixels);target.putImageData(image,0,0);return true;}
  if (jobs.has(key)) {context.pending=true;return true;}
  // In-flight data is bounded too. Synchronous reads use the same kernel if saturated.
  const bytes=request.pixels.byteLength+request.width*request.height*4;
  if (pendingBytes+bytes>8*1024*1024 || cache.byteLength+request.width*request.height*4>cache.capacity) return false;
  const id=++sequence;
  jobs.set(key,{id,ready:context.ready,bytes,width:request.width,height:request.height});pendingBytes+=bytes;
  context.pending=true;
  sampler.postMessage({id,request},[request.pixels.buffer]);return true;
}
