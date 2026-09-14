import { RasterTransformPreview } from '../../engine/raster/RasterTransformPreview';
import {
  RasterEditSession,
  RasterSurface,
} from '../../engine/raster/RasterSurface';
import { RasterSelectionContent } from '../../engine/raster/RasterSelectionContent';
import { RasterResampler } from '../../engine/raster/RasterResampler';
import type { StrokePoint } from '../../model';
import { unionRect, type DirtyRect } from '../../engine/brush';
import type { RasterLayer } from '../../engine/layers';
import type {
  PaintEngine,
  SelectedObjectTransform,
} from '../../engine/PaintEngine';
import type { Tool } from '../types';

export interface Pt {
  x: number;
  y: number;
}

/**
 * 浮動選択。corners は TL, TR, BR, BL のアートボード座標。
 * 通常モードでは移動/拡縮/回転 (クアッドは平行四辺形のまま)、
 * 自由変形モードでは角を個別に動かせる (双一次ワープで描画)。
 */
interface Float {
  w: number;
  h: number;
  corners: [Pt, Pt, Pt, Pt];
  /** 切り出し輪郭 (切り出し画像のローカル座標) */
  outline: Pt[];
}

interface RasterFloat {
  preview?: RasterTransformPreview;
  layer: RasterLayer;
  content: RasterSelectionContent;
  edit: RasterEditSession;
}

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

export interface FloatExtractInput {
  trace(ctx: CanvasRenderingContext2D): void;
  outline: Pt[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  preferredLayerId?: string;
  rectangular?: boolean;
  layerIds?: ReadonlySet<string>;
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
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function isFloatTool(
  tool: Tool,
): tool is Tool & { floatSelection: FloatSelection } {
  return (
    'floatSelection' in tool && tool.floatSelection instanceof FloatSelection
  );
}

export class FloatSelection {
  phase: 'idle' | 'float' = 'idle';
  /** 自由変形モード (角を個別に動かす) */
  free = false;
  private float: Float | null = null;
  private rasterFloats: RasterFloat[] = [];
  private objectTransforms: SelectedObjectTransform[] = [];
  private sourceCorners: Pt[] = [];
  private origRect: DirtyRect | null = null;
  private drag: Drag | null = null;
  private duplicated = false;
  private didTransform = false;

  constructor(
    private eng: PaintEngine,
    private readonly historyLabel: string,
  ) {}

  setFreeTransform(on: boolean): void {
    if (on && this.objectTransforms.length) return;
    if (this.free === on) return;
    this.free = on;
    this.drag = null;
    this.emitSelectionState();
    this.eng.requestOverlayRender();
    this.eng.syncStore();
  }

  emitSelectionState(): void {
    this.eng.setSelectionState({
      active: this.phase === 'float',
      freeTransform: this.phase === 'float' && this.free,
    });
  }

  extractFromPolygon(pts: Pt[], preferredLayerId?: string): boolean {
    if (pts.length < 3) return false;
    const trace = (ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of pts) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
    return this.extract({
      trace,
      outline: pts,
      minX,
      minY,
      maxX,
      maxY,
      preferredLayerId,
    });
  }

  extractFromRect(rect: DirtyRect, preferredLayerId?: string, layerIds?: ReadonlySet<string>): boolean {
    const minX = rect.minX;
    const minY = rect.minY;
    const maxX = rect.maxX;
    const maxY = rect.maxY;
    const trace = (ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.rect(minX, minY, maxX - minX, maxY - minY);
    };
    const outline = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    return this.extract({
      trace,
      outline,
      minX,
      minY,
      maxX,
      maxY,
      preferredLayerId,
      rectangular: true,
      layerIds,
    });
  }

  extract(input: FloatExtractInput): boolean {
    const minX = Math.floor(input.minX);
    const minY = Math.floor(input.minY);
    const maxX = Math.ceil(input.maxX);
    const maxY = Math.ceil(input.maxY);
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 1 || h < 1) {
      this.reset();
      this.emitSelectionState();
      return false;
    }

    const selected = input.layerIds
      ? this.eng.allLayers().filter((layer): layer is RasterLayer =>
          layer.type === 'raster' && input.layerIds!.has(layer.id))
      : this.eng.selectedRasters();
    this.rasterFloats = [];
    try {
      for (const layer of selected) {
        const edit = new RasterEditSession(layer.runtime.surface);
        const item = {
          layer,
          edit,
          content: new RasterSelectionContent(new RasterSurface(), {
            x: minX,
            y: minY,
            w,
            h,
          }),
        };
        this.rasterFloats.push(item);
        item.content = RasterSelectionContent.extract(
          layer.runtime.surface,
          { x: minX, y: minY, w, h },
          input.trace,
          edit,
          input.rectangular,
        );
      }
    } catch (error) {
      for (const item of this.rasterFloats) item.edit.cancel();
      this.reset();
      throw error;
    }
    this.float = {
      w,
      h,
      corners: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
      outline: input.outline.map((pt) => ({ x: pt.x - minX, y: pt.y - minY })),
    };
    this.origRect = {
      minX: minX - 2,
      minY: minY - 2,
      maxX: maxX + 2,
      maxY: maxY + 2,
    };
    this.objectTransforms = this.eng.selectedObjectsInRect(
      this.origRect,
      input.outline,
      input.layerIds,
    );
    this.sourceCorners = this.float.corners.map((point) => ({ ...point }));
    this.phase = 'float';
    this.free = false;
    this.drag = null;
    for (const item of this.rasterFloats)
      this.eng.bumpLayer(item.layer.id, this.origRect);
    this.emitSelectionState();
    this.eng.requestOverlayRender();
    return true;
  }

  beginDrag(p: StrokePoint): boolean {
    if (this.phase !== 'float' || !this.float) return false;
    const hit = this.hitTest(p.x, p.y);
    if (hit === null) return false;
    const c = centroid(this.float.corners);
    this.drag = {
      mode: hit.mode,
      corner: hit.corner,
      sx: p.x,
      sy: p.y,
      startCorners: this.float.corners.map((q) => ({ ...q })),
      startDist: Math.max(4, Math.hypot(p.x - c.x, p.y - c.y)),
      startAngle: Math.atan2(p.y - c.y, p.x - c.x),
    };
    return true;
  }

  dragTo(p: StrokePoint): void {
    if (this.phase !== 'float' || !this.drag || !this.float) return;
    const f = this.float;
    const beforeRect = this.transformedRect(4);
    const d = this.drag;
    const c = centroid(d.startCorners);
    if (d.mode === 'move') {
      const dx = Math.round(p.x - d.sx);
      const dy = Math.round(p.y - d.sy);
      f.corners = d.startCorners.map((q) => ({
        x: q.x + dx,
        y: q.y + dy,
      })) as Float['corners'];
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
    this.didTransform = true;
    const damage = unionRect(beforeRect, this.transformedRect(4));
    if (this.objectTransforms.length)
      this.eng.previewObjectGroup(
        this.objectTransforms,
        this.sourceCorners,
        f.corners,
      );
    for (const item of this.rasterFloats)
      this.eng.bumpLayer(item.layer.id, damage);
    this.eng.requestOverlayRender();
  }

  endDrag(): void {
    if (this.drag && this.objectTransforms.length) this.eng.syncStore();
    this.drag = null;
  }

  /** 現在の変形位置でレイヤーへスタンプ (浮動状態は継続) */
  duplicate(): void {
    if (this.phase !== 'float' || !this.float) return;
    this.stamp();
    this.duplicated = true;
    this.origRect = unionRect(this.origRect!, this.transformedRect(4));
    for (const item of this.rasterFloats)
      this.eng.bumpLayer(item.layer.id, this.transformedRect(4));
  }

  private finishUnchanged(): boolean {
    if (
      !this.float ||
      this.duplicated ||
      this.float.corners.some(
        (p, i) =>
          p.x !== this.sourceCorners[i].x || p.y !== this.sourceCorners[i].y,
      )
    )
      return false;
    for (const item of this.rasterFloats) {
      item.edit.cancel();
      this.eng.bumpLayer(item.layer.id, this.origRect!);
    }
    if (this.didTransform && this.objectTransforms.length)
      this.eng.restoreObjectGroup(this.objectTransforms);
    this.reset();
    this.emitSelectionState();
    this.eng.requestOverlayRender();
    return true;
  }

  async commitAsync(): Promise<void> {
    if (this.phase !== 'float' || !this.float || this.eng.isBusy()) return;
    if (this.finishUnchanged()) return;
    const originals = this.rasterFloats.map((item) => ({
      layer: item.layer,
      surface: item.edit.beforeSurface(),
    }));
    this.eng.setBusy(true);
    try {
      for (const item of this.rasterFloats)
        await RasterResampler.drawAsync(
          item.content.surface,
          item.content.rect,
          this.float.corners,
          item.edit,
        );
      const entries = this.rasterFloats.map((item) => ({
        layer: item.layer,
        change: item.edit.commit(),
      }));
      const objects = this.objectTransforms;
      this.reset();
      this.eng.commitRasterBatch(entries, this.historyLabel, objects);
      this.emitSelectionState();
    } catch (error) {
      this.cancelSelection();
      for (const original of originals)
        original.layer.runtime.surface = original.surface;
      this.eng.requestRender();
      throw error;
    } finally {
      this.eng.setBusy(false);
      this.eng.requestRender();
      this.eng.scheduleSave();
    }
  }

  commit(): void {
    if (this.phase !== 'float' || !this.float) return;
    if (this.finishUnchanged()) return;
    this.stamp();
    const entries = this.rasterFloats.map((item) => ({
      layer: item.layer,
      change: item.edit.commit(),
    }));
    const objects = this.objectTransforms;
    this.reset();
    this.eng.commitRasterBatch(entries, this.historyLabel, objects);
    this.emitSelectionState();
  }

  cancelSelection(): void {
    if (this.phase === 'float') {
      for (const item of this.rasterFloats) {
        item.edit.cancel();
        this.eng.bumpLayer(item.layer.id);
      }
      this.eng.restoreObjectGroup(this.objectTransforms);
    }
    this.reset();
    this.emitSelectionState();
    this.eng.requestRender();
    this.eng.syncStore();
  }

  reset(): void {
    this.duplicated = false;
    this.didTransform = false;
    this.phase = 'idle';
    this.free = false;
    this.float = null;
    this.rasterFloats = [];
    this.objectTransforms = [];
    this.sourceCorners = [];
    this.origRect = null;
    this.drag = null;
  }

  drawAboveLayer(ctx: CanvasRenderingContext2D, layerId: string): void {
    if (this.phase !== 'float') return;
    const item = this.rasterFloats.find((value) => value.layer.id === layerId);
    if (item && this.float) {
      const transform = ctx.getTransform();
      const region = {
        x: -transform.e,
        y: -transform.f,
        w: ctx.canvas.width,
        h: ctx.canvas.height,
      };
      const corners = this.float.corners,
        r = item.content.rect;
      const dx = corners[0].x - r.x,
        dy = corners[0].y - r.y;
      if (
        Number.isInteger(dx) &&
        Number.isInteger(dy) &&
        corners.every(
          (p, i) =>
            p.x === r.x + (i === 1 || i === 2 ? r.w : 0) + dx &&
            p.y === r.y + (i >= 2 ? r.h : 0) + dy,
        )
      ) {
        ctx.save();
        try {
          ctx.translate(dx, dy);
          item.content.surface.drawRegion(ctx, {
            ...region,
            x: region.x - dx,
            y: region.y - dy,
          });
        } finally {
          ctx.restore();
        }
        return;
      }
      item.preview ??= new RasterTransformPreview(
        item.content.surface,
        item.content.rect,
      );
      item.preview.draw(
        ctx,
        region,
        this.float.corners,
        1 / this.eng.uiScale(),
      );
    }
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'float' || !this.float) return;
    const s = this.eng.uiScale();
    const f = this.float;
    const cs = f.corners;
    const dashOffset = (performance.now() / 60) % (10 * s);
    ctx.save();
    ctx.lineWidth = 1.5 * s;

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
    ctx.restore();
  }

  overlayAnimated(): boolean {
    return this.phase === 'float';
  }

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

  private stamp(): void {
    try {
      for (const item of this.rasterFloats)
        RasterResampler.draw(
          item.content.surface,
          item.content.rect,
          this.float!.corners,
          item.edit,
        );
    } catch (error) {
      this.cancelSelection();
      throw error;
    }
  }

  centerOnPaper(): void {
    if (!this.float) return;
    const r = this.transformedRect(0),
      dx = Math.round(this.eng.artboard.w / 2 - (r.minX + r.maxX) / 2),
      dy = Math.round(this.eng.artboard.h / 2 - (r.minY + r.maxY) / 2);
    for (const p of this.float.corners) {
      p.x += dx;
      p.y += dy;
    }
    if (this.objectTransforms.length)
      this.eng.previewObjectGroup(
        this.objectTransforms,
        this.sourceCorners,
        this.float.corners,
      );
    this.commit();
  }

  private rotateHandlePos(): Pt {
    const f = this.float!;
    const s = this.eng.uiScale();
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

  private hitTest(
    px: number,
    py: number,
  ): { mode: DragMode; corner: number } | null {
    const f = this.float!;
    const tol = 14 * this.eng.uiScale();
    if (!this.free) {
      const rh = this.rotateHandlePos();
      if (Math.hypot(px - rh.x, py - rh.y) < tol)
        return { mode: 'rotate', corner: -1 };
    }
    for (let i = 0; i < 4; i++) {
      const c = f.corners[i];
      if (Math.hypot(px - c.x, py - c.y) < tol) {
        return this.free
          ? { mode: 'corner', corner: i }
          : { mode: 'scale', corner: i };
      }
    }
    if (pointInPolygon(f.corners, px, py)) return { mode: 'move', corner: -1 };
    return null;
  }
}
