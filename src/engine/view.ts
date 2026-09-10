import { ART_H, ART_W } from '../types';

export interface ViewState {
  x: number;
  y: number;
  scale: number;
  rot: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 32;

/**
 * キャンバス表示のパン・回転・拡大縮小。
 * アートボード要素へ CSS transform (translate → rotate → scale) を適用し、
 * クライアント座標 ⇔ アート座標の相互変換を提供する。
 */
export class ViewController {
  x = 0;
  y = 0;
  scale = 1;
  rot = 0;

  /** アートボードを領域にフィットさせたときの CSS ピクセル幅/高さ */
  private fitW = ART_W;
  private area: HTMLElement | null = null;
  private board: HTMLElement | null = null;

  onChange: (() => void) | null = null;

  attach(area: HTMLElement, board: HTMLElement): void {
    this.area = area;
    this.board = board;
    this.apply();
  }

  detach(): void {
    this.area = null;
    this.board = null;
  }

  setFitWidth(w: number): void {
    this.fitW = Math.max(1, w);
    this.onChange?.();
  }

  fitScale(): number {
    return this.fitW / ART_W;
  }

  /** アート座標の1pxが画面上で何pxになるか */
  displayScale(): number {
    return Math.max(0.0001, this.fitScale() * this.scale);
  }

  snapshot(): ViewState {
    return { x: this.x, y: this.y, scale: this.scale, rot: this.rot };
  }

  restore(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const state = value as Partial<ViewState>;
    if (![state.x, state.y, state.scale, state.rot].every(Number.isFinite)) {
      return false;
    }
    this.x = state.x!;
    this.y = state.y!;
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale!));
    this.rot = state.rot!;
    this.apply();
    return true;
  }

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.scale = 1;
    this.rot = 0;
    this.apply();
  }

  private centerClient(): { x: number; y: number } {
    const r = this.area?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  clientToArt(clientX: number, clientY: number): { x: number; y: number } {
    const c = this.centerClient();
    const dx = clientX - c.x - this.x;
    const dy = clientY - c.y - this.y;
    const cos = Math.cos(this.rot);
    const sin = Math.sin(this.rot);
    const ux = (dx * cos + dy * sin) / this.scale;
    const uy = (-dx * sin + dy * cos) / this.scale;
    const fs = this.fitScale();
    return { x: ux / fs + ART_W / 2, y: uy / fs + ART_H / 2 };
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.apply();
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const k = next / this.scale;
    if (k === 1) return;
    const c = this.centerClient();
    const qx = clientX - c.x;
    const qy = clientY - c.y;
    this.x = qx - k * (qx - this.x);
    this.y = qy - k * (qy - this.y);
    this.scale = next;
    this.apply();
  }

  rotateAt(clientX: number, clientY: number, dRad: number): void {
    const c = this.centerClient();
    const qx = clientX - c.x;
    const qy = clientY - c.y;
    const ox = qx - this.x;
    const oy = qy - this.y;
    const cos = Math.cos(dRad);
    const sin = Math.sin(dRad);
    this.x = qx - (ox * cos - oy * sin);
    this.y = qy - (ox * sin + oy * cos);
    this.rot += dRad;
    this.apply();
  }

  /**
   * 2本指ジェスチャ。開始時のビュー状態と2点の重心/距離/角度の変化から
   * パン・回転・拡縮を一括で適用する (指の下のアート座標が指に追従する)。
   */
  applyGesture(
    start: ViewState,
    c0: { x: number; y: number },
    d0: number,
    a0: number,
    c1: { x: number; y: number },
    d1: number,
    a1: number,
  ): void {
    const rawK = d0 > 1 ? d1 / d0 : 1;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, start.scale * rawK));
    const k = next / start.scale;
    const dr = a1 - a0;
    const c = this.centerClient();
    // 開始時のアートボード中心を c0 基準で回転・拡縮し、現在の重心へ移す
    const zx = c.x + start.x - c0.x;
    const zy = c.y + start.y - c0.y;
    const cos = Math.cos(dr);
    const sin = Math.sin(dr);
    this.x = c1.x + k * (zx * cos - zy * sin) - c.x;
    this.y = c1.y + k * (zx * sin + zy * cos) - c.y;
    this.scale = next;
    this.rot = start.rot + dr;
    this.apply();
  }

  private apply(): void {
    if (this.board) {
      this.board.style.transform = `translate(${this.x}px, ${this.y}px) rotate(${this.rot}rad) scale(${this.scale})`;
    }
    this.onChange?.();
  }
}
