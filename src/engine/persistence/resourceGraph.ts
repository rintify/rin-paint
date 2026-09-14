import {packRasterArchive, unpackRasterArchive, RASTER_CONTENT_TYPE, type RasterArchive} from '../raster/RasterArchive';

export type ResourceId = string;
export interface PackedResources { value: unknown; resources: Map<ResourceId, Blob> }
const hashes = new WeakMap<Blob, Promise<string>>();
function resourceId(blob: Blob): Promise<string> {
  let result = hashes.get(blob);
  if (!result) {
    result = blob.arrayBuffer().then(bytes => crypto.subtle.digest('SHA-256',bytes))
      .then(hash => Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join(''));
    hashes.set(blob,result);
  }
  return result;
}

/** Traverses current content and all Undo branches. Unchanged tiles get one resource ID. */
export async function packResources(value: unknown): Promise<PackedResources> {
  const resources = new Map<ResourceId,Blob>();
  const visit = async (item: unknown): Promise<unknown> => {
    if (item instanceof Blob) {
      if (item.type === RASTER_CONTENT_TYPE) return {$raster:await visit(await unpackRasterArchive(item))};
      const id = await resourceId(item); resources.set(id,item);
      return {$resource:id,type:item.type};
    }
    if (Array.isArray(item)) return Promise.all(item.map(visit));
    if (item && typeof item === 'object') {
      const result: Record<string,unknown> = {};
      for (const [key,value] of Object.entries(item)) if (value !== undefined) result[key] = await visit(value);
      return result;
    }
    return item;
  };
  return {value:await visit(value),resources};
}

export async function unpackResources(value: unknown, read: (id: ResourceId) => Promise<Blob | undefined>): Promise<unknown> {
  const cache = new Map<string,Promise<Blob>>();
  const visit = async (item: unknown): Promise<unknown> => {
    if (Array.isArray(item)) return Promise.all(item.map(visit));
    if (!item || typeof item !== 'object' || item instanceof Blob) return item;
    const record = item as Record<string,unknown>;
    if (typeof record.$resource === 'string') {
      const key = `${record.$resource}:${record.type}`;
      let result = cache.get(key);
      if (!result) {
        result = read(record.$resource).then(blob => {
          if (!blob) throw new Error('共有リソースが欠損しています');
          return blob.slice(0,blob.size,typeof record.type === 'string' ? record.type : '');
        }); cache.set(key,result);
      }
      return result;
    }
    if (record.$raster) return packRasterArchive(await visit(record.$raster) as RasterArchive);
    return Object.fromEntries(await Promise.all(Object.entries(record).map(async ([key,value])=>[key,await visit(value)])));
  };
  return visit(value);
}
