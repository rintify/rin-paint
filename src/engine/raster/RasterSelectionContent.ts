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
  ): RasterSelectionContent {
    const snapshot = source.clone(),
      result = new RasterSurface(),
      extraction = new RasterEditSession(result);
    for (const tile of snapshot.queryTiles(rect)) {
      const r = tileRect(tile.tx, tile.ty);
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
