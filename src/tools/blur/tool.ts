import { rasterToPage } from '../../engine/core/RasterCoordinates';
import { readProjectedRaster } from '../../engine/raster/readProjectedRaster';
import { paintProjectedCanvas } from '../../engine/raster/paintProjectedCanvas';
import { IDENTITY, inverse, multiply, translation, type Homography } from '../../engine/geometry/homography';
import type { StrokePoint } from '../../model';
import { emptyRect, expandRect, rectValid, unionRect, type DirtyRect } from '../../engine/brush';
import type { RasterLayer } from '../../engine/layers';
import type { PaintEngine } from '../../engine/PaintEngine';
import { DEFAULT_SIZE_MM, mmToPx } from '../../engine/units';
import type { Tool } from '../types';

/**
 * ぼかしブラシ。なぞった場所を円形のソフトマスクで
 * 「元画像」と「ぼかした画像」のクロスフェードに置き換える。
 */
export class BlurTool implements Tool {
  private layer: RasterLayer | null = null;
  private nativeToPage: Homography = IDENTITY;
  private pageToNative: Homography = IDENTITY;
  private lastX = 0;
  private lastY = 0;
  private radius = 16;
  private blurPx = 4;
  private rect: DirtyRect = emptyRect();
  private acc = 0;

  private src = document.createElement('canvas');
  private srcCtx = this.src.getContext('2d', { willReadFrequently: true })!;
  private blurred = document.createElement('canvas');
  private blurredCtx = this.blurred.getContext('2d')!;
  private mix = document.createElement('canvas');
  private mixCtx = this.mix.getContext('2d')!;

  constructor(private eng: PaintEngine) {}

  onDown(p: StrokePoint): void {
    const layer = this.eng.activeRaster();
    if (!layer) return;
    this.nativeToPage = rasterToPage(this.eng, layer);
    const inverted = inverse(this.nativeToPage); if (!inverted) return;
    this.pageToNative = inverted;
    this.layer = layer;
    this.eng.captureBefore(layer);
    const size = this.eng.activeToolSettings()?.sizePx ?? mmToPx(DEFAULT_SIZE_MM, this.eng.getPageSpec().ppi);
    this.radius = Math.max(3, size * 0.5);
    this.blurPx = Math.max(1, size * 0.14);
    this.rect = emptyRect();
    this.acc = 0;
    const damage = this.dab(p.x, p.y);
    this.lastX = p.x;
    this.lastY = p.y;
    this.eng.invalidateLayer(layer.id, damage);
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
    let travelled = 0;
    let damage: DirtyRect | null = null;
    while (this.acc + (dist - travelled) >= spacing) {
      travelled += spacing - this.acc;
      this.acc = 0;
      const dab = this.dab(this.lastX + ux * travelled, this.lastY + uy * travelled);
      damage = damage ? unionRect(damage, dab) : dab;
    }
    this.acc += dist - travelled;
    this.lastX = p.x;
    this.lastY = p.y;
    if (damage) this.eng.invalidateLayer(this.layer.id, damage);
  }

  onUp(): void {
    if (!this.layer) return;
    if (rectValid(this.rect)) {
      this.eng.commitRasterEdit(this.layer, this.rect, 'ぼかし');
    }
    this.layer = null;
  }

  cancel(): void {
    if (!this.layer) return;
    this.eng.restoreBefore(this.layer, this.rect);
    this.layer = null;
  }

  private ensureSize(s: number): void {
    for (const c of [this.src, this.blurred, this.mix]) {
      if (c.width !== s || c.height !== s) {
        c.width = s;
        c.height = s;
      }
    }
  }

  private dab(cx: number, cy: number): DirtyRect {
    const layer = this.layer!;
    const r = this.radius;
    const pad = Math.ceil(this.blurPx * 2) + 2;
    const s = Math.ceil((r + pad) * 2);
    const ox = Math.round(cx - s / 2);
    const oy = Math.round(cy - s / 2);
    this.ensureSize(s);

    this.srcCtx.save();
    this.srcCtx.clearRect(0, 0, s, s);
    const projected = readProjectedRaster(layer.runtime.surface, this.nativeToPage, {x: ox, y: oy, w: s, h: s});
    this.srcCtx.drawImage(projected, 0, 0); projected.width = projected.height = 0;
    this.srcCtx.restore();

    this.blurredCtx.save();
    this.blurredCtx.clearRect(0, 0, s, s);
    this.blurredCtx.filter = `blur(${this.blurPx}px)`;
    this.blurredCtx.drawImage(this.src, 0, 0);
    this.blurredCtx.restore();

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

    const gMask = this.srcCtx.createRadialGradient(mx, mx, inner, mx, mx, r);
    gMask.addColorStop(0, 'rgba(0,0,0,1)');
    gMask.addColorStop(1, 'rgba(0,0,0,0)');
    this.srcCtx.save();
    this.srcCtx.globalCompositeOperation = 'destination-out';
    this.srcCtx.fillStyle = gMask;
    this.srcCtx.fillRect(0, 0, s, s);
    this.srcCtx.restore();

    this.mixCtx.save();
    this.mixCtx.clearRect(0, 0, s, s);
    this.mixCtx.drawImage(this.src, 0, 0);
    this.mixCtx.globalCompositeOperation = 'lighter';
    this.mixCtx.drawImage(this.blurred, 0, 0);
    this.mixCtx.restore();

    const matrix = multiply(this.pageToNative, translation(ox, oy));
    const clear = document.createElement('canvas'); clear.width = clear.height = s;
    clear.getContext('2d')!.fillRect(0, 0, s, s);
    paintProjectedCanvas(layer.runtime.surface, clear, matrix, 'destination-out');
    paintProjectedCanvas(layer.runtime.surface, this.mix, matrix);
    clear.width = clear.height = 0;

    expandRect(this.rect, cx, cy, r + pad);
    return { minX: ox, minY: oy, maxX: ox + s, maxY: oy + s };
  }
}
