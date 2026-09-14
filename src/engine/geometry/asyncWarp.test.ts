// @vitest-environment happy-dom
import {describe,expect,it,vi} from 'vitest';
import {sampleWarp, type WarpPixelsRequest} from './sampleWarp';
import {deferredWarp,hasPendingWarp,withAsyncWarp} from './asyncWarp';

describe('Worker projective fallback',()=>{
  it('stages rendering until the Worker result is ready, using the identical transparent-color kernel',async()=>{
    let instance:FakeWorker;
    class FakeWorker {
      onmessage:((event:{data:unknown})=>void)|null=null;
      onerror:(()=>void)|null=null;
      sent=0;
      constructor(){instance=this;}
      postMessage({id,request}:{id:number;request:WarpPixelsRequest}) {
        this.sent++;
        queueMicrotask(()=>this.onmessage?.({data:{id,pixels:sampleWarp(request)}}));
      }
      terminate(){}
    }
    vi.stubGlobal('Worker',FakeWorker);
    const request:WarpPixelsRequest={pixels:new Uint8ClampedArray([255,0,0,255,0,0,255,0]),sourceWidth:2,sourceHeight:1,
      inverse:[1,0,.5,0,1,0,.01,0,1],sourceOrigin:{x:0,y:0},targetOrigin:{x:0,y:0},width:2,height:1};
    const ready=vi.fn(),put=vi.fn();
    const target={createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:put} as unknown as CanvasRenderingContext2D;
    try {
      expect(deferredWarp(request,target)).toBe(false);
      withAsyncWarp(ready,()=>{expect(deferredWarp(request,target)).toBe(true);expect(hasPendingWarp()).toBe(true);});
      expect(put).not.toHaveBeenCalled();await Promise.resolve();expect(ready).toHaveBeenCalledOnce();
      withAsyncWarp(ready,()=>{expect(deferredWarp(request,target)).toBe(true);expect(hasPendingWarp()).toBe(false);});
      expect(instance!.sent).toBe(1);
      expect(put.mock.calls[0][0].data).toEqual(sampleWarp(request));
      expect(put.mock.calls[0][0].data[2]).toBe(0);
    } finally {vi.unstubAllGlobals();}
  });
});
