/// <reference lib="webworker" />
import { analyzeFill } from './fillAlgorithm';

interface Request {
  pixels: ArrayBuffer;
  width: number;
  height: number;
  seedX: number;
  seedY: number;
  tolerance: number;
  gapClosePx: number;
}

self.onmessage = (event: MessageEvent<Request>) => {
  const result = analyzeFill({
    ...event.data,
    pixels: new Uint8ClampedArray(event.data.pixels),
    progress: value => self.postMessage({ type: 'progress', value }),
  });
  self.postMessage(
    { type: 'result', mask: result.mask.buffer, bounds: result.bounds },
    { transfer: [result.mask.buffer] },
  );
};
