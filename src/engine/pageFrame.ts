import { MAX_PAGE_PIXEL_SIZE, MIN_PAGE_PIXEL_SIZE } from '../model/page';

/** ページのピクセルサイズ。エンジンが所有し、描画境界でのみ参照する。 */
export class PageFrame {
  private _w = 1600;
  private _h = 1200;
  private _originX = 0;
  private _originY = 0;

  get w(): number {
    return this._w;
  }

  get h(): number {
    return this._h;
  }

  get originX(): number { return this._originX; }
  get originY(): number { return this._originY; }

  setOrigin(x: number, y: number): void {
    this._originX = Number.isFinite(x) ? Math.floor(x) : 0;
    this._originY = Number.isFinite(y) ? Math.floor(y) : 0;
  }

  resize(w: number, h: number): void {
    this._w = Math.round(Math.max(MIN_PAGE_PIXEL_SIZE, Math.min(MAX_PAGE_PIXEL_SIZE, w)));
    this._h = Math.round(Math.max(MIN_PAGE_PIXEL_SIZE, Math.min(MAX_PAGE_PIXEL_SIZE, h)));
  }
}
