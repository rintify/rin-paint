import type {RectMm} from '../geometry/homography';
import { ByteLru } from './ByteLru';
import type { RasterTile } from './SparseRaster';

const PIXELS = 256 * 256;
const BYTES = PIXELS * 4;
const decoded = new ByteLru<RasterTileResource, Uint8ClampedArray>(128 * 1024 * 1024);
const normalized = new WeakMap<RasterTile, RasterTileResource>();

/** RGBA runs and literal blocks. Random pixels cost at most two bytes per 32767 pixels. */
function compress(pixels: Uint8ClampedArray): Uint8Array {
  const aligned = pixels.byteOffset % 4 ? pixels.slice() : pixels;
  const words = new Uint32Array(aligned.buffer, aligned.byteOffset, PIXELS);
  const output = new Uint8Array(BYTES + Math.ceil(PIXELS / 32767) * 2 + 4);
  const view = new DataView(output.buffer);
  let input = 0, offset = 0;
  while (input < PIXELS) {
    let run = 1;
    while (input + run < PIXELS && run < 32767 && words[input + run] === words[input]) run++;
    if (run >= 3) {
      view.setUint16(offset, 0x8000 | run, true); offset += 2;
      output.set(pixels.subarray(input * 4, input * 4 + 4), offset); offset += 4;
      input += run;
    } else {
      const start = input; input += run;
      while (input < PIXELS && input - start < 32767) {
        if (input + 2 < PIXELS && words[input] === words[input + 1] && words[input] === words[input + 2]) break;
        input++;
      }
      const count = input - start;
      view.setUint16(offset, count, true); offset += 2;
      output.set(pixels.subarray(start * 4, input * 4), offset); offset += count * 4;
    }
  }
  return output.slice(0, offset);
}

function expand(encoded: Uint8Array): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(BYTES);
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  let offset = 0, target = 0;
  while (offset < encoded.length) {
    if (offset + 2 > encoded.length) throw new Error('圧縮タイルが破損しています');
    const token = view.getUint16(offset, true); offset += 2;
    const count = token & 0x7fff;
    if (!count || target + count > PIXELS) throw new Error('圧縮タイルの長さが不正です');
    const length = token & 0x8000 ? 4 : count * 4;
    if (offset + length > encoded.length) throw new Error('圧縮タイルが欠損しています');
    if (token & 0x8000) {
      const rgba = encoded.subarray(offset, offset + 4);
      for (let i = 0; i < count; i++) pixels.set(rgba, (target + i) * 4);
    } else pixels.set(encoded.subarray(offset, offset + length), target * 4);
    offset += length; target += count;
  }
  if (target !== PIXELS) throw new Error('タイルの画素数が不正です');
  return pixels;
}

export function alphaBounds(pixels:Uint8ClampedArray):RectMm|null {
  let x0=256,y0=256,x1=0,y1=0;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(pixels[(y*256+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
  return x1>x0&&y1>y0?{x:x0,y:y0,w:x1-x0,h:y1-y0}:null;
}

/** Immutable compressed content shared by the live document, references, and history branches. */
export class RasterTileResource implements RasterTile {
  private readonly encoded: Uint8Array;
  readonly blob: Blob;
  private bounds:RectMm|null|undefined;
  constructor(readonly id: string, pixels: Uint8ClampedArray, encoded?: Uint8Array) {
    if (!encoded && pixels.byteLength !== BYTES) throw new Error('タイルの寸法が不正です');
    this.encoded = encoded ?? compress(pixels);
    this.blob = new Blob([this.encoded.slice().buffer], {type: 'application/x-rin-rgba-runs'});
    if (!encoded) decoded.set(this, pixels.slice(), BYTES);
  }
  get pixels(): Uint8ClampedArray {
    const cached = decoded.get(this);
    if (cached) return cached;
    const pixels = expand(this.encoded); decoded.set(this, pixels, BYTES); return pixels;
  }
  get boundsPx():RectMm|null {if(this.bounds===undefined)this.bounds=alphaBounds(this.pixels);return this.bounds;}
  get encodedBytes(): number { return this.encoded.byteLength; }
  static from(tile: RasterTile): RasterTileResource {
    if (tile instanceof RasterTileResource) return tile;
    let resource = normalized.get(tile);
    if (!resource) {resource = new RasterTileResource(tile.id, tile.pixels); normalized.set(tile, resource);}
    return resource;
  }
  static async decode(id: string, blob: Blob, bounds?:RectMm|null): Promise<RasterTileResource> {
    const tile=new RasterTileResource(id, new Uint8ClampedArray(), new Uint8Array(await blob.arrayBuffer()));
    tile.bounds=bounds;return tile;
  }
  static get decodedBytes(): number {return decoded.byteLength;}
  static clearDecoded(): void {decoded.clear();}
}
