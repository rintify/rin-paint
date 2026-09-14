import { RasterEditSession, RasterSurface } from './RasterSurface';
import { tileRect, type PixelRect } from './geometry';
export class RasterSelectionContent {
  constructor(
    readonly surface: RasterSurface,
    readonly rect: PixelRect,
  ) {}
  static extract(
    source: RasterSurface,
    rect: PixelRect,
    trace: (ctx: CanvasRenderingContext2D) => void,
    edit: RasterEditSession,
    rectangular = false,
  ): RasterSelectionContent {
    const snapshot = source.clone(),
      result = new RasterSurface(),
      extraction = new RasterEditSession(result);
    for (const tile of snapshot.queryTiles(rect)) {
      const r = tileRect(tile.tx, tile.ty);
      const b = tile.asset.bounds;
      if (
        rectangular &&
        r.x + b.x >= rect.x &&
        r.y + b.y >= rect.y &&
        r.x + b.x + b.w <= rect.x + rect.w &&
        r.y + b.y + b.h <= rect.y + rect.h
      ) {
        result.set(tile.tx, tile.ty, tile.asset);
        edit.removeTile(tile.tx, tile.ty);
        continue;
      }
      extraction.mutateRegion(r, (ctx) => {
        trace(ctx);
        ctx.clip();
        snapshot.drawRegion(ctx, r);
      });
      edit.mutateRegion(
        r,
        (ctx) => {
          ctx.globalCompositeOperation = 'destination-out';
          trace(ctx);
          ctx.fill();
        },
        true,
      );
    }
    extraction.commit();
    return new RasterSelectionContent(result, rect);
  }
}
