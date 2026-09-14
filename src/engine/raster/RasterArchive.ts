import type {RectMm} from '../geometry/homography';
import type {TileKey} from './SparseRaster';

export const RASTER_CONTENT_TYPE = 'application/x-rin-sparse-raster';
export interface RasterArchive {
  ppi: number;
  origin: {x: number; y: number};
  tiles: {key: TileKey; id: string; blob: Blob; bounds?:RectMm|null}[];
}

/** The index and individually compressed immutable tiles stay separable in every archive. */
export function packRasterArchive(archive: RasterArchive): Blob {
  const header = new TextEncoder().encode(JSON.stringify({ppi: archive.ppi, origin: archive.origin,
    tiles: archive.tiles.map(tile => ({key: tile.key, id: tile.id, size: tile.blob.size, bounds:tile.bounds}))}));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, header.length, true);
  return new Blob([length, header, ...archive.tiles.map(tile => tile.blob)], {type: RASTER_CONTENT_TYPE});
}
export async function unpackRasterArchive(blob: Blob): Promise<RasterArchive> {
  const prefix = await blob.slice(0,4).arrayBuffer();
  if (prefix.byteLength !== 4) throw new Error('ラスタ索引が欠損しています');
  const length = new DataView(prefix).getUint32(0,true);
  if (length > blob.size-4) throw new Error('ラスタ索引の長さが不正です');
  const header = JSON.parse(await blob.slice(4,4+length).text()) as {
    ppi: number; origin: {x:number;y:number}; tiles: {key:TileKey;id:string;size:number;bounds?:RectMm|null}[];
  };
  if (!(header.ppi > 0) || !Number.isFinite(header.ppi) || !Number.isFinite(header.origin?.x)
    || !Number.isFinite(header.origin?.y) || !Array.isArray(header.tiles)) throw new Error('ラスタ座標が不正です');
  let offset = 4+length;
  const keys = new Set<string>();
  const tiles = header.tiles.map(tile => {
    const [x,y] = tile.key.split(',').map(Number);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || `${x},${y}` !== tile.key || keys.has(tile.key)
      || typeof tile.id !== 'string' || !Number.isSafeInteger(tile.size) || tile.size < 1 || offset+tile.size > blob.size) throw new Error('ラスタタイル索引が不正です');
    if(tile.bounds && (![tile.bounds.x,tile.bounds.y,tile.bounds.w,tile.bounds.h].every(Number.isFinite) || tile.bounds.x<0 || tile.bounds.y<0 || tile.bounds.w<0 || tile.bounds.h<0 || tile.bounds.x+tile.bounds.w>256 || tile.bounds.y+tile.bounds.h>256)) throw new Error('タイルの内容境界が不正です');
    keys.add(tile.key);
    const content = blob.slice(offset,offset+tile.size,'application/x-rin-rgba-runs'); offset += tile.size;
    return {key:tile.key,id:tile.id,blob:content,bounds:tile.bounds};
  });
  if (offset !== blob.size) throw new Error('ラスタ内容の長さが不正です');
  return {ppi:header.ppi,origin:header.origin,tiles};
}
