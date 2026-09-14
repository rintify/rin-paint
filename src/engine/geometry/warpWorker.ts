import {sampleWarp, type WarpPixelsRequest} from './sampleWarp';
self.onmessage=(event:MessageEvent<{id:number;request:WarpPixelsRequest}>)=>{
  const {id,request}=event.data;
  try {
    const pixels=sampleWarp(request);
    (self as unknown as Worker).postMessage({id,pixels},[pixels.buffer]);
  } catch(error) {(self as unknown as Worker).postMessage({id,error:String(error)});}
};
