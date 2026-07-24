import { useStore } from '../../state/store';
import type { StrokePoint } from '../../types';
import { emptyRect, expandRect, rectValid, type DirtyRect } from '../brush';
import type { RasterLayer } from '../layers';
import type { PaintEngine } from '../PaintEngine';
import type { Tool } from './types';

/**
 * ぼかしブラシ。なぞった場所を円形のソフトマスクで
 * 「元画像」と「ぼかした画像」のクロスフェードに置き換える。
 */
export class BlurTool implements Tool {
  private layer: RasterLayer | null = null;
  private lastX = 0;
  private lastY = 0;
  private radius = 16;
  private blurPx = 4;
  private rect: DirtyRect = emptyRect();
  private acc = 0;

  // ダブ毎の使い回し作業キャンバス
  private src = document.createElement('canvas');
  private srcCtx = this.src.getContext('2d', { willReadFrequently: true })!;
  private blurred = document.createElement('canvas');
  private blurredCtx = this.blurred.getContext('2d')!;
  private mix = document.createElement('canvas');
  private mixCtx = this.mix.getContext('2d')!;

  constructor(private engine: PaintEngine) {}

  onDown(p: StrokePoint): void {
    const layer = this.engine.activeRaster();
    if (!layer) return;
    this.layer = layer;
    this.engine.captureBefore(layer);
    const size = useStore.getState().penSize;
    this.radius = Math.max(3, size * 0.5);
    this.blurPx = Math.max(1, size * 0.14);
    this.rect = emptyRect();
    this.acc = 0;
    this.dab(p.x, p.y);
    this.lastX = p.x;
    this.lastY = p.y;
    this.engine.requestRender();
  }

  onMove(p: StrokePoint): void {
    if (!this.layer) return;
    const spacing = Math.max(1.5, this.radius * 0.35);
    const dx = p.x - this.lastX;
    const dy = p.y - this.lastY;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;
    const ux = dx / dist;
    const uy = dy / dist;
    // 線分に沿って spacing 間隔でダブを打つ (端数は acc に持ち越す)
    let travelled = 0;
    while (this.acc + (dist - travelled) >= spacing) {
      travelled += spacing - this.acc;
      this.acc = 0;
      this.dab(this.lastX + ux * travelled, this.lastY + uy * travelled);
    }
    this.acc += dist - travelled;
    this.lastX = p.x;
    this.lastY = p.y;
    this.engine.requestRender();
  }

  onUp(): void {
    if (!this.layer) return;
    if (rectValid(this.rect)) {
      this.engine.commitRasterEdit(this.layer, this.rect, 'ぼかし');
    }
    this.layer = null;
  }

  cancel(): void {
    if (!this.layer) return;
    this.engine.restoreBefore(this.layer);
    this.layer = null;
    this.engine.requestRender();
  }

  private ensureSize(s: number): void {
    for (const c of [this.src, this.blurred, this.mix]) {
      if (c.width !== s || c.height !== s) {
        c.width = s;
        c.height = s;
      }
    }
  }

  private dab(cx: number, cy: number): void {
    const layer = this.layer!;
    const r = this.radius;
    const pad = Math.ceil(this.blurPx * 2) + 2;
    const s = Math.ceil((r + pad) * 2);
    const ox = Math.round(cx - s / 2);
    const oy = Math.round(cy - s / 2);
    this.ensureSize(s);

    // 元画像の切り出し
    this.srcCtx.save();
    this.srcCtx.clearRect(0, 0, s, s);
    this.srcCtx.drawImage(layer.canvas, -ox, -oy);
    this.srcCtx.restore();

    // ぼかし版
    this.blurredCtx.save();
    this.blurredCtx.clearRect(0, 0, s, s);
    this.blurredCtx.filter = `blur(${this.blurPx}px)`;
    this.blurredCtx.drawImage(this.src, 0, 0);
    this.blurredCtx.restore();

    // ソフト円マスク g: 中心1 → 縁0
    const mx = s / 2;
    const inner = r * 0.4;
    const gIn = this.blurredCtx.createRadialGradient(mx, mx, inner, mx, mx, r);
    gIn.addColorStop(0, 'rgba(0,0,0,1)');
    gIn.addColorStop(1, 'rgba(0,0,0,0)');
    this.blurredCtx.save();
    this.blurredCtx.globalCompositeOperation = 'destination-in';
    this.blurredCtx.fillStyle = gIn;
    this.blurredCtx.fillRect(0, 0, s, s);
    this.blurredCtx.restore();

    // 元画像 × (1-g): destination-out は g のアルファ分を削るので 1-g が残る
    const gMask = this.srcCtx.createRadialGradient(mx, mx, inner, mx, mx, r);
    gMask.addColorStop(0, 'rgba(0,0,0,1)');
    gMask.addColorStop(1, 'rgba(0,0,0,0)');
    this.srcCtx.save();
    this.srcCtx.globalCompositeOperation = 'destination-out';
    this.srcCtx.fillStyle = gMask;
    this.srcCtx.fillRect(0, 0, s, s);
    this.srcCtx.restore();

    // mix = src*(1-g) + blurred*g (プリマルチプライ加算で正確なクロスフェード)
    this.mixCtx.save();
    this.mixCtx.clearRect(0, 0, s, s);
    this.mixCtx.drawImage(this.src, 0, 0);
    this.mixCtx.globalCompositeOperation = 'lighter';
    this.mixCtx.drawImage(this.blurred, 0, 0);
    this.mixCtx.restore();

    // 領域を置き換え
    layer.ctx.save();
    layer.ctx.clearRect(ox, oy, s, s);
    layer.ctx.drawImage(this.mix, ox, oy);
    layer.ctx.restore();

    expandRect(this.rect, cx, cy, r + pad);
  }
}
