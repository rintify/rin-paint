import { ART_H, ART_W, type StrokePoint } from '../../types';
import { unionRect, type DirtyRect } from '../brush';
import type { RasterLayer } from '../layers';
import type { PaintEngine, SelectedObjectTransform } from '../PaintEngine';
import type { Tool } from './types';

interface Pt {
  x: number;
  y: number;
}

/**
 * 浮動選択。corners は TL, TR, BR, BL のアートボード座標。
 * 通常モードでは移動/拡縮/回転 (クアッドは平行四辺形のまま)、
 * 自由変形モードでは角を個別に動かせる (双一次ワープで描画)。
 */
interface Float {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  corners: [Pt, Pt, Pt, Pt];
  /** 投げ縄の輪郭 (切り出し画像のローカル座標) */
  outline: Pt[];
}
interface RasterFloat { layer: RasterLayer; canvas: HTMLCanvasElement; before: HTMLCanvasElement }

type DragMode = 'move' | 'scale' | 'rotate' | 'corner';

interface Drag {
  mode: DragMode;
  corner: number;
  sx: number;
  sy: number;
  startCorners: Pt[];
  startDist: number;
  startAngle: number;
}

const ROTATE_HANDLE_OFFSET = 34;

function centroid(pts: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

/** 射線法による多角形内判定 (自由変形で凹になっても動く) */
function pointInPolygon(pts: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** 3点の対応から src → dst のアフィン変換を ctx.transform に適用して描く */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s0: Pt,
  s1: Pt,
  s2: Pt,
  d0: Pt,
  d1: Pt,
  d2: Pt,
): void {
  const den =
    s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(den) < 1e-8) return;
  const a =
    (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / den;
  const b =
    (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / den;
  const c =
    (s0.x * (d1.x - d2.x) + s1.x * (d2.x - d0.x) + s2.x * (d0.x - d1.x)) / den;
  const d =
    (s0.x * (d1.y - d2.y) + s1.x * (d2.y - d0.y) + s2.x * (d0.y - d1.y)) / den;
  const e =
    (s0.x * (s1.y * d2.x - s2.y * d1.x) +
      s0.y * (s2.x * d1.x - s1.x * d2.x) +
      d0.x * (s1.x * s2.y - s2.x * s1.y)) /
    den;
  const f =
    (s0.x * (s1.y * d2.y - s2.y * d1.y) +
      s0.y * (s2.x * d1.y - s1.x * d2.y) +
      d0.y * (s1.x * s2.y - s2.x * s1.y)) /
    den;

  // 継ぎ目が見えないよう、クリップ領域を重心方向へ僅かに膨らませる
  const gx = (d0.x + d1.x + d2.x) / 3;
  const gy = (d0.y + d1.y + d2.y) / 3;
  const grow = (p: Pt): Pt => ({
    x: gx + (p.x - gx) * 1.03,
    y: gy + (p.y - gy) * 1.03,
  });
  const g0 = grow(d0);
  const g1 = grow(d1);
  const g2 = grow(d2);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g0.x, g0.y);
  ctx.lineTo(g1.x, g1.y);
  ctx.lineTo(g2.x, g2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

export class LassoTool implements Tool {
  phase: 'idle' | 'draw' | 'float' = 'idle';
  /** 自由変形モード (角を個別に動かす) */
  free = false;
  private pts: Pt[] = [];
  private layer: RasterLayer | null = null;
  private float: Float | null = null;
  private rasterFloats: RasterFloat[] = [];
  private objectTransforms: SelectedObjectTransform[] = [];
  private sourceCorners: Pt[] = [];
  private origRect: DirtyRect | null = null;
  private drag: Drag | null = null;

  constructor(private engine: PaintEngine) {}

  setFreeTransform(on: boolean): void {
    if (on && this.objectTransforms.length) return;
    if (this.free === on) return;
    this.free = on;
    this.drag = null;
    this.engine.syncStore();
  }

  onDown(p: StrokePoint): void {
    if (this.phase === 'float' && this.float) {
      const hit = this.hitTest(p.x, p.y);
      if (hit === null) {
        this.commit();
        this.beginDraw(p);
        return;
      }
      const f = this.float;
      const c = centroid(f.corners);
      this.drag = {
        mode: hit.mode,
        corner: hit.corner,
        sx: p.x,
        sy: p.y,
        startCorners: f.corners.map((q) => ({ ...q })),
        startDist: Math.max(4, Math.hypot(p.x - c.x, p.y - c.y)),
        startAngle: Math.atan2(p.y - c.y, p.x - c.x),
      };
      return;
    }
    this.beginDraw(p);
  }

  private beginDraw(p: StrokePoint): void {
    const layers = this.engine.selectedRasters();
    const layer = layers.find(item => item.id === this.engine.activeRaster()?.id) ?? layers[0];
    if (!layer && !this.engine.hasSelectedObjects()) {
      this.phase = 'idle';
      return;
    }
    this.layer = layer ?? null;
    this.phase = 'draw';
    this.pts = [{ x: p.x, y: p.y }];
  }

  onMove(p: StrokePoint): void {
    if (this.phase === 'draw') {
      const last = this.pts[this.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 2) {
        this.pts.push({ x: p.x, y: p.y });
      }
    } else if (this.phase === 'float' && this.drag && this.float) {
      const f = this.float;
      const d = this.drag;
      const c = centroid(d.startCorners);
      if (d.mode === 'move') {
        const dx = p.x - d.sx;
        const dy = p.y - d.sy;
        f.corners = d.startCorners.map((q) => ({ x: q.x + dx, y: q.y + dy })) as Float['corners'];
      } else if (d.mode === 'corner') {
        const q = d.startCorners[d.corner];
        f.corners[d.corner] = { x: q.x + (p.x - d.sx), y: q.y + (p.y - d.sy) };
      } else if (d.mode === 'scale') {
        const dist = Math.hypot(p.x - c.x, p.y - c.y);
        const k = Math.min(20, Math.max(0.05, dist / d.startDist));
        f.corners = d.startCorners.map((q) => ({
          x: c.x + (q.x - c.x) * k,
          y: c.y + (q.y - c.y) * k,
        })) as Float['corners'];
      } else {
        const angle = Math.atan2(p.y - c.y, p.x - c.x);
        const dr = angle - d.startAngle;
        const cos = Math.cos(dr);
        const sin = Math.sin(dr);
        f.corners = d.startCorners.map((q) => ({
          x: c.x + (q.x - c.x) * cos - (q.y - c.y) * sin,
          y: c.y + (q.x - c.x) * sin + (q.y - c.y) * cos,
        })) as Float['corners'];
      }
      if (this.objectTransforms.length) this.engine.previewObjectGroup(this.objectTransforms, this.sourceCorners, f.corners);
      this.engine.requestRender();
    }
  }

  onUp(): void {
    if (this.phase === 'draw') {
      if (this.pts.length >= 3) {
        this.extract();
      } else {
        this.phase = 'idle';
        this.layer = null;
      }
      this.engine.syncStore();
    } else {
      this.drag = null;
    }
  }

  cancel(): void {
    if (this.phase === 'draw') {
      this.phase = 'idle';
      this.pts = [];
      this.layer = null;
    }
    this.drag = null;
  }

  private lassoPath(): Path2D {
    const path = new Path2D();
    path.moveTo(this.pts[0].x, this.pts[0].y);
    for (let i = 1; i < this.pts.length; i++) path.lineTo(this.pts[i].x, this.pts[i].y);
    path.closePath();
    return path;
  }

  /** 囲んだ範囲をレイヤーから切り出して浮動状態にする */
  private extract(): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of this.pts) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
    minX = Math.max(0, Math.floor(minX));
    minY = Math.max(0, Math.floor(minY));
    maxX = Math.min(ART_W, Math.ceil(maxX));
    maxY = Math.min(ART_H, Math.ceil(maxY));
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 3 || h < 3) {
      this.phase = 'idle';
      this.layer = null;
      return;
    }

    const path = this.lassoPath();
    const selected = this.engine.selectedRasters();
    this.rasterFloats = selected.map(item => {
      const before = document.createElement('canvas'); before.width = ART_W; before.height = ART_H; before.getContext('2d')!.drawImage(item.canvas, 0, 0);
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const cc = canvas.getContext('2d')!; cc.translate(-minX, -minY); cc.clip(path); cc.drawImage(item.canvas, 0, 0);
      item.ctx.save(); item.ctx.globalCompositeOperation = 'destination-out'; item.ctx.fill(path); item.ctx.restore();
      return { layer: item, canvas, before };
    });
    const canvas = (this.layer ? this.rasterFloats.find(item => item.layer.id === this.layer!.id)?.canvas : undefined) ?? this.rasterFloats[0]?.canvas ?? document.createElement('canvas');
    if (!canvas.width) { canvas.width = w; canvas.height = h; }

    this.float = {
      canvas,
      w,
      h,
      corners: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
      outline: this.pts.map((pt) => ({ x: pt.x - minX, y: pt.y - minY })),
    };
    this.origRect = { minX: minX - 2, minY: minY - 2, maxX: maxX + 2, maxY: maxY + 2 };
    this.objectTransforms = this.engine.selectedObjectsInRect(this.origRect, this.pts);
    this.sourceCorners = this.float.corners.map(point => ({ ...point }));
    this.phase = 'float';
    this.pts = [];
    for (const item of this.rasterFloats) this.engine.bumpLayer(item.layer.id);
    this.engine.requestRender();
  }

  /** 現在の変形位置でレイヤーへスタンプ (浮動状態は継続) */
  duplicate(): void {
    if (this.phase !== 'float' || !this.float) return;
    this.stamp();
    // 複製した場所も確定時の履歴パッチ対象に含める
    this.origRect = unionRect(this.origRect!, this.transformedRect(4));
    for (const item of this.rasterFloats) this.engine.bumpLayer(item.layer.id);
    this.engine.requestRender();
  }

  commit(): void {
    if (this.phase !== 'float' || !this.float) return;
    this.stamp();
    const rect = unionRect(this.origRect!, this.transformedRect(4));
    const entries = this.rasterFloats.map(item => ({ layer: item.layer, before: item.before, rect }));
    const objects = this.objectTransforms;
    this.reset();
    this.engine.commitRasterBatch(entries, '複数レイヤーの選択範囲', objects);
  }

  cancelSelection(): void {
    if (this.phase === 'float') {
      for (const item of this.rasterFloats) {
        item.layer.ctx.clearRect(0, 0, ART_W, ART_H); item.layer.ctx.drawImage(item.before, 0, 0);
        this.engine.bumpLayer(item.layer.id);
      }
      this.engine.restoreObjectGroup(this.objectTransforms);
    }
    this.reset();
    this.engine.requestRender();
    this.engine.syncStore();
  }

  private reset(): void {
    this.phase = 'idle';
    this.free = false;
    this.float = null;
    this.rasterFloats = [];
    this.objectTransforms = [];
    this.sourceCorners = [];
    this.layer = null;
    this.origRect = null;
    this.drag = null;
    this.pts = [];
  }

  // ------------------------------------------------------------- transform

  /** 画像ローカル座標 (px) → アートボード座標 (双一次補間) */
  private toWorld(lx: number, ly: number): Pt {
    const f = this.float!;
    const u = lx / f.w;
    const v = ly / f.h;
    const [c0, c1, c2, c3] = f.corners;
    const topX = c0.x + (c1.x - c0.x) * u;
    const topY = c0.y + (c1.y - c0.y) * u;
    const botX = c3.x + (c2.x - c3.x) * u;
    const botY = c3.y + (c2.y - c3.y) * u;
    return { x: topX + (botX - topX) * v, y: topY + (botY - topY) * v };
  }

  private isParallelogram(): boolean {
    const [c0, c1, c2, c3] = this.float!.corners;
    return (
      Math.abs(c0.x + c2.x - c1.x - c3.x) < 0.01 &&
      Math.abs(c0.y + c2.y - c1.y - c3.y) < 0.01
    );
  }

  /** 現在のクアッドへ切り出し画像を描く (平行四辺形なら1回の transform で) */
  private drawFloatImage(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement = this.float!.canvas): void {
    const f = this.float!;
    const [c0, c1, , c3] = f.corners;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (this.isParallelogram()) {
      ctx.transform(
        (c1.x - c0.x) / f.w,
        (c1.y - c0.y) / f.w,
        (c3.x - c0.x) / f.h,
        (c3.y - c0.y) / f.h,
        c0.x,
        c0.y,
      );
      ctx.drawImage(image, 0, 0);
    } else {
      // 双一次ワープ: グリッドに分割し三角形ごとにアフィン描画
      let maxEdge = 0;
      for (let i = 0; i < 4; i++) {
        const a = f.corners[i];
        const b = f.corners[(i + 1) % 4];
        maxEdge = Math.max(maxEdge, Math.hypot(b.x - a.x, b.y - a.y));
      }
      const n = Math.max(4, Math.min(32, Math.ceil(maxEdge / 48)));
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const sx0 = (f.w * i) / n;
          const sx1 = (f.w * (i + 1)) / n;
          const sy0 = (f.h * j) / n;
          const sy1 = (f.h * (j + 1)) / n;
          const s00 = { x: sx0, y: sy0 };
          const s10 = { x: sx1, y: sy0 };
          const s11 = { x: sx1, y: sy1 };
          const s01 = { x: sx0, y: sy1 };
          const d00 = this.toWorld(sx0, sy0);
          const d10 = this.toWorld(sx1, sy0);
          const d11 = this.toWorld(sx1, sy1);
          const d01 = this.toWorld(sx0, sy1);
          drawTriangle(ctx, image, s00, s10, s11, d00, d10, d11);
          drawTriangle(ctx, image, s00, s11, s01, d00, d11, d01);
        }
      }
    }
    ctx.restore();
  }

  private stamp(): void {
    for (const item of this.rasterFloats) this.drawFloatImage(item.layer.ctx, item.canvas);
  }

  private rotateHandlePos(): Pt {
    const f = this.float!;
    const s = this.engine.uiScale();
    const [c0, c1] = f.corners;
    const mid = { x: (c0.x + c1.x) / 2, y: (c0.y + c1.y) / 2 };
    const c = centroid(f.corners);
    const len = Math.max(1, Math.hypot(mid.x - c.x, mid.y - c.y));
    return {
      x: mid.x + ((mid.x - c.x) / len) * ROTATE_HANDLE_OFFSET * s,
      y: mid.y + ((mid.y - c.y) / len) * ROTATE_HANDLE_OFFSET * s,
    };
  }

  private transformedRect(pad: number): DirtyRect {
    const cs = this.float!.corners;
    return {
      minX: Math.min(...cs.map((c) => c.x)) - pad,
      minY: Math.min(...cs.map((c) => c.y)) - pad,
      maxX: Math.max(...cs.map((c) => c.x)) + pad,
      maxY: Math.max(...cs.map((c) => c.y)) + pad,
    };
  }

  private hitTest(px: number, py: number): { mode: DragMode; corner: number } | null {
    const f = this.float!;
    const tol = 14 * this.engine.uiScale();
    if (!this.free) {
      const rh = this.rotateHandlePos();
      if (Math.hypot(px - rh.x, py - rh.y) < tol) return { mode: 'rotate', corner: -1 };
    }
    for (let i = 0; i < 4; i++) {
      const c = f.corners[i];
      if (Math.hypot(px - c.x, py - c.y) < tol) {
        return this.free ? { mode: 'corner', corner: i } : { mode: 'scale', corner: i };
      }
    }
    if (pointInPolygon(f.corners, px, py)) return { mode: 'move', corner: -1 };
    return null;
  }

  drawAboveLayer(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'float' || !this.float) return;
    this.drawFloatImage(ctx);
  }

  drawAboveLayerFor(ctx: CanvasRenderingContext2D, layerId: string): void {
    if (this.phase !== 'float') return;
    const item = this.rasterFloats.find(value => value.layer.id === layerId);
    if (item) this.drawFloatImage(ctx, item.canvas);
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const s = this.engine.uiScale();
    ctx.save();
    ctx.lineWidth = 1.5 * s;
    if (this.phase === 'draw' && this.pts.length > 1) {
      ctx.setLineDash([6 * s, 4 * s]);
      ctx.strokeStyle = '#4f8cff';
      ctx.beginPath();
      ctx.moveTo(this.pts[0].x, this.pts[0].y);
      for (let i = 1; i < this.pts.length; i++) ctx.lineTo(this.pts[i].x, this.pts[i].y);
      ctx.stroke();
    } else if (this.phase === 'float' && this.float) {
      const f = this.float;
      const cs = f.corners;
      const dashOffset = (performance.now() / 60) % (10 * s);

      // 投げ縄の輪郭 (マーチングアンツ)
      if (f.outline.length > 2) {
        ctx.beginPath();
        const p0 = this.toWorld(f.outline[0].x, f.outline[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < f.outline.length; i++) {
          const p = this.toWorld(f.outline[i].x, f.outline[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.setLineDash([5 * s, 5 * s]);
        ctx.lineDashOffset = -dashOffset;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.lineDashOffset = -dashOffset + 5 * s;
        ctx.strokeStyle = '#33373f';
        ctx.stroke();
        ctx.lineDashOffset = 0;
      }

      // 変形枠
      ctx.setLineDash([6 * s, 4 * s]);
      ctx.strokeStyle = '#4f8cff';
      ctx.beginPath();
      ctx.moveTo(cs[0].x, cs[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(cs[i].x, cs[i].y);
      ctx.closePath();
      ctx.stroke();

      ctx.setLineDash([]);
      const r = 5 * s;
      for (const c of cs) {
        ctx.fillStyle = this.free ? '#4f8cff' : '#ffffff';
        ctx.strokeStyle = this.free ? '#ffffff' : '#4f8cff';
        ctx.beginPath();
        ctx.rect(c.x - r, c.y - r, r * 2, r * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (!this.free) {
        const mid = { x: (cs[0].x + cs[1].x) / 2, y: (cs[0].y + cs[1].y) / 2 };
        const rh = this.rotateHandlePos();
        ctx.strokeStyle = '#4f8cff';
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.lineTo(rh.x, rh.y);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(rh.x, rh.y, 6 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
