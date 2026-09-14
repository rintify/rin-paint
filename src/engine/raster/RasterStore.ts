import { ByteLru } from './ByteLru';
import { RASTER_TILE_SIZE, type RasterTile, type SparseRasterSnapshot, type TileKey, tileCoordinates } from './SparseRaster';

export interface RasterRevision {
  id: string;
  intrinsicPpi: number;
  originMm: {x:number;y:number};
  tiles: Record<TileKey,string>;
}
export interface RasterArchive {
  revisions: RasterRevision[];
  resources: {id:string;encoding:'deflate';blob:Blob}[];
}
const TILE_BYTES = RASTER_TILE_SIZE * RASTER_TILE_SIZE * 4;

/** Encoded resources are authoritative; decoded pixels have a bounded residency. */
export class RasterStore {
  private readonly resources = new Map<string, Blob>();
  private readonly revisions = new Map<string, RasterRevision>();
  private readonly decoded: ByteLru<string,RasterTile>;
  private readonly pending = new Map<string,Promise<RasterTile>>();
  private generation = 0;
  constructor(decodedBudget = 128 * 1024 * 1024) {
    this.decoded = new ByteLru(decodedBudget);
  }
  get decodedBytes(): number { return this.decoded.byteLength; }
  get resourceCount(): number { return this.resources.size; }

  async commit(snapshot: SparseRasterSnapshot): Promise<string> {
    const entries = [...snapshot.tiles];
    const encoded = await Promise.all(entries.map(async ([key,tile]) => {
      if (tile.pixels.length !== TILE_BYTES) throw new Error('タイルの寸法が不正です');
      const blob = this.resources.get(tile.id) ?? await new Response(
        new Blob([tile.pixels.slice().buffer]).stream().pipeThrough(new CompressionStream('deflate')),
      ).blob();
      return {key,tile,blob};
    }));
    const id = crypto.randomUUID();
    const revision: RasterRevision = {id,intrinsicPpi:snapshot.intrinsicPpi,originMm:{...snapshot.originMm},tiles:{}};
    for (const {key,tile,blob} of encoded) {
      this.resources.set(tile.id,blob); this.decoded.set(tile.id,tile,TILE_BYTES); revision.tiles[key] = tile.id;
    }
    this.revisions.set(id,revision); return id;
  }

  revision(id: string): RasterRevision {
    const revision = this.revisions.get(id);
    if (!revision) throw new Error('ラスターのリビジョンが存在しません');
    return structuredClone(revision);
  }

  async tile(id: string): Promise<RasterTile> {
    const cached = this.decoded.get(id);
    if (cached) return cached;
    const pending = this.pending.get(id);
    if (pending) return pending;
    const blob = this.resources.get(id);
    if (!blob) throw new Error('タイルリソースが存在しません');
    const generation = this.generation;
    const task = (async () => {
      const bytes = await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
      if (bytes.byteLength !== TILE_BYTES) throw new Error('タイルリソースが破損しています');
      const tile = {id,pixels:new Uint8ClampedArray(bytes)};
      // A GC during decode must not resurrect an unreferenced cache entry.
      if (generation === this.generation && this.resources.has(id)) this.decoded.set(id,tile,TILE_BYTES);
      return tile;
    })().finally(() => { if (generation === this.generation) this.pending.delete(id); });
    this.pending.set(id,task); return task;
  }

  async snapshot(id: string): Promise<SparseRasterSnapshot> {
    const revision = this.revision(id);
    const tiles = await Promise.all(Object.entries(revision.tiles).map(async ([key,id]) => [key as TileKey,await this.tile(id)] as const));
    return {intrinsicPpi:revision.intrinsicPpi,originMm:revision.originMm,tiles:new Map(tiles)};
  }

  archive(revisionIds: Iterable<string>): RasterArchive {
    const revisions = [...new Set(revisionIds)].map(id => this.revision(id));
    const ids = new Set(revisions.flatMap(revision => Object.values(revision.tiles)));
    return {revisions,resources:[...ids].map(id => {
      const blob = this.resources.get(id);
      if (!blob) throw new Error('共有タイルが欠損しています');
      return {id,encoding:'deflate' as const,blob};
    })};
  }

  load(archive: RasterArchive): void {
    const resources = new Map(archive.resources.map(resource => [resource.id,resource]));
    if (resources.size !== archive.resources.length) throw new Error('共有タイルの識別子が重複しています');
    const revisions = new Map<string,RasterRevision>();
    for (const revision of archive.revisions) {
      if (revisions.has(revision.id) || !Number.isFinite(revision.intrinsicPpi) || revision.intrinsicPpi <= 0
        || !Number.isFinite(revision.originMm.x) || !Number.isFinite(revision.originMm.y)) throw new Error('ラスターのリビジョンが不正です');
      for (const [key,id] of Object.entries(revision.tiles)) {
        const [x,y] = tileCoordinates(key as TileKey);
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || key !== `${x},${y}` || resources.get(id)?.encoding !== 'deflate') {
          throw new Error('タイル索引が不正です');
        }
      }
      revisions.set(revision.id,structuredClone(revision));
    }
    this.generation++; this.pending.clear();
    this.decoded.clear(); this.resources.clear(); this.revisions.clear();
    for (const [id,resource] of resources) this.resources.set(id,resource.blob);
    for (const [id,revision] of revisions) this.revisions.set(id,revision);
  }

  /** Callers supply roots from live state, links, and every Undo/Redo branch. */
  collect(referencedRevisionIds: Iterable<string>): void {
    const keep = new Set(referencedRevisionIds), tiles = new Set<string>();
    for (const id of keep) for (const tile of Object.values(this.revision(id).tiles)) tiles.add(tile);
    for (const id of this.revisions.keys()) if (!keep.has(id)) this.revisions.delete(id);
    for (const id of this.resources.keys()) if (!tiles.has(id)) { this.resources.delete(id); this.decoded.delete(id); }
  }
}
