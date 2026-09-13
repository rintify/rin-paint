import { MAX_ART_SIZE, MIN_ART_SIZE } from '../model/page';

/** アートボードのピクセルサイズ。エンジンが所有し、作業キャンバス・ツールが参照する。 */
export class Artboard {
  private _w = 1600;
  private _h = 1200;

  get w(): number {
    return this._w;
  }

  get h(): number {
    return this._h;
  }

  resize(w: number, h: number): void {
    this._w = Math.round(Math.max(MIN_ART_SIZE, Math.min(MAX_ART_SIZE, w)));
    this._h = Math.round(Math.max(MIN_ART_SIZE, Math.min(MAX_ART_SIZE, h)));
  }
}
