import type { RasterLayer } from '../layers';
export { TILE_SIZE } from '../raster/geometry';
export type { RasterTilePatch as TilePatch } from '../raster/RasterSurface';
import type { RasterTilePatch } from '../raster/RasterSurface';
export async function applyTiles(
  layer: RasterLayer,
  tiles: RasterTilePatch[],
  which: 'before' | 'after',
): Promise<void> {
  await layer.runtime.surface.apply(tiles, which);
}
