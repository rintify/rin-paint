import {drawProjectedProcedure} from '../../engine/geometry/drawProjectedProcedure';
import {finiteProjection} from '../../engine/geometry/finiteProjection';
import { rasterToPage } from '../../engine/core/RasterCoordinates';
import { ScopeTransforms } from '../../engine/core/ScopeTransforms';
import { projectedSelectionMask } from '../../engine/raster/projectedSelectionMask';
import { layerTypeProps } from '../../engine/layer-types/registry';
import { RasterSurface } from '../../engine/raster/RasterSurface';
import type { StrokePoint } from '../../model';
import { unionRect, type DirtyRect } from '../../engine/brush';
import type { RasterLayer } from '../../engine/layers';
import type { PaintEngine, SelectedObjectTransform } from '../../engine/PaintEngine';
import type { Tool } from '../types';
import { corners, fromQuads, project, translation, multiply, inverse, transformBounds, type Homography } from '../../engine/geometry/homography';

export interface Pt {
  x: number;
  y: number;
}

/**
 * 浮動選択。corners は TL, TR, BR, BL のアートボード座標。
 * 通常モードでは移動/拡縮/回転 (クアッドは平行四辺形のまま)、
 * 自由変形モードでは角を個別に動かせる (ホモグラフィで描画)。
 */
interface Float {
  w: number;
  h: number;
  corners: [Pt, Pt, Pt, Pt];
  matrix: Homography;
  /** 切り出し輪郭 (切り出し画像のローカル座標) */
  outline: Pt[];
}

interface RasterFloat { layer: RasterLayer; surface: RasterSurface; nativeToPage: Homography; pageToNative: Homography; pageToScope: Homography; before: import("../../engine/raster/SparseRaster").SparseRasterSnapshot }

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
  wholeLayers?: boolean;
  trace(ctx: CanvasRenderingContext2D): void;
  outline: Pt[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  preferredLayerId?: string;
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

export function isFloatTool(tool: Tool): tool is Tool & { floatSelection: FloatSelection } {
  return 'floatSelection' in tool && (tool as { floatSelection?: FloatSelection }).floatSelection instanceof FloatSelection;
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

  constructor(
    private eng: PaintEngine,
    private readonly historyLabel: string,
  ) {}

  setFreeTransform(on: boolean): void {
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
    return this.extract({ trace, outline: pts, minX, minY, maxX, maxY, preferredLayerId });
  }

  extractFromRect(rect: DirtyRect, preferredLayerId?: string, wholeLayers = false): boolean {
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
    return this.extract({ trace, outline, minX, minY, maxX, maxY, preferredLayerId, wholeLayers });
  }

  extract(input: FloatExtractInput): boolean {
    const minX = Math.floor(input.minX);
    const minY = Math.floor(input.minY);
    const maxX = Math.ceil(input.maxX);
    const maxY = Math.ceil(input.maxY);
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 3 || h < 3) {
      this.reset();
      this.emitSelectionState();
      return false;
    }

    const transformTargets = this.eng.transforms.targets();
    const selected = this.eng.transforms.rasters(transformTargets);
    const scopes = new ScopeTransforms(this.eng.getRootLayerIds(), this.eng.allLayers(), this.eng.getPageSpec().ppi);
    this.rasterFloats = (input.wholeLayers ? [] : selected).flatMap((item): RasterFloat[] => {
      const nativeToPage = rasterToPage(this.eng, item), pageToNative = inverse(nativeToPage);
      const pageToScope = inverse(scopes.layerToPage(item.id));
      if (!pageToNative || !pageToScope) return [];
      const before = item.runtime.surface.snapshot();
      const surface = new RasterSurface(before.intrinsicPpi);
      for (const key of before.tiles.keys()) {
        const [tx, ty] = key.split(',').map(Number), x = tx * 256, y = ty * 256;
        const region = {x, y, w: 256, h: 256};
        const display = transformBounds(nativeToPage, region);
        if (display && (display.x >= maxX || display.y >= maxY || display.x + display.w <= minX || display.y + display.h <= minY)) continue;
        const mask = projectedSelectionMask(region, pageToNative, input.trace);
        const tile = item.runtime.surface.read(region), ctx = tile.getContext('2d')!;
        ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask, 0, 0);
        surface.paint(region, target => target.drawImage(tile, x, y));
        item.runtime.surface.paint(region, target => {target.globalCompositeOperation = 'destination-out'; target.drawImage(mask, x, y);});
        tile.width = tile.height = mask.width = mask.height = 0;
      }
      return [{layer: item, surface, before, nativeToPage, pageToNative, pageToScope}];
    });
    this.float = {
      w,
      h,
      corners: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
      matrix: translation(minX,minY),
      outline: input.outline.map((pt) => ({ x: pt.x - minX, y: pt.y - minY })),
    };
    this.origRect = { minX: minX - 2, minY: minY - 2, maxX: maxX + 2, maxY: maxY + 2 };
    this.objectTransforms = this.eng.selectedObjectsInRect(this.origRect, input.outline);
    if (input.wholeLayers) this.objectTransforms.push(...selected.map(layer => ({...transformTargets.find(target => target.id === layer.id)!, before: layerTypeProps(layer)})));
    this.sourceCorners = this.float.corners.map(point => ({ ...point }));
    this.phase = 'float';
    this.free = false;
    this.drag = null;
    for (const item of this.rasterFloats) this.eng.bumpLayer(item.layer.id, this.origRect);
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
    const previousCorners = f.corners.map(point => ({ ...point })) as Float['corners'];
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
    const matrix = fromQuads(corners({x:0,y:0,w:f.w,h:f.h}), f.corners);
    if (!matrix) {
      f.corners = previousCorners;
      return;
    }
    f.matrix = matrix;
    const damage = unionRect(beforeRect, this.transformedRect(4));
    if (this.objectTransforms.length) this.eng.previewObjectGroup(this.objectTransforms, this.sourceCorners, f.corners);
    for (const item of this.rasterFloats) this.eng.bumpLayer(item.layer.id, damage);
    this.eng.requestOverlayRender();
  }

  endDrag(): void {
    this.drag = null;
  }

  /** 現在の変形位置でレイヤーへスタンプ (浮動状態は継続) */
  duplicate(): void {
    if (this.phase !== 'float' || !this.float) return;
    this.stamp();
    this.origRect = unionRect(this.origRect!, this.transformedRect(4));
    for (const item of this.rasterFloats) this.eng.bumpLayer(item.layer.id, this.transformedRect(4));
  }

  commit(): void {
    if (this.phase !== 'float' || !this.float) return;
    this.stamp();
    const rect = unionRect(this.origRect!, this.transformedRect(4));
    const entries = this.rasterFloats.map(item => ({ layer: item.layer, before: item.before, rect }));
    const objects = this.objectTransforms;
    this.reset();
    this.eng.commitRasterBatch(entries, this.historyLabel, objects);
    this.emitSelectionState();
  }

  cancelSelection(): void {
    if (this.phase === 'float') {
      for (const item of this.rasterFloats) {
        item.layer.runtime.surface.restore(item.before);
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
    const item = this.rasterFloats.find(value => value.layer.id === layerId);
    if (item) this.drawRasterFloat(ctx, item);
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
    return project(f.matrix, {x:lx,y:ly}) ?? f.corners[0];
  }

  private floatMatrix(): Homography {
    return multiply(this.float!.matrix, translation(-this.sourceCorners[0].x, -this.sourceCorners[0].y));
  }

  private drawRasterFloat(ctx: CanvasRenderingContext2D, item: RasterFloat, native = false): void {
    const matrix = multiply(native ? item.pageToNative : item.pageToScope, multiply(this.floatMatrix(), item.nativeToPage));
    const bounds=item.surface.bounds();if(!bounds)return;
    drawProjectedProcedure(ctx,bounds,matrix,source=>item.surface.drawTo(source));
  }

  private stamp(): void {
    for (const item of this.rasterFloats) {
      const matrix = multiply(item.pageToNative, multiply(this.floatMatrix(), item.nativeToPage));
      const outputTiles = new Set<string>();
      for (const key of item.surface.snapshot().tiles.keys()) {
        const [x, y] = key.split(',').map(Number);
        for (const region of finiteProjection(matrix,{x:x*256,y:y*256,w:256,h:256})) for (let ty = Math.floor(region.y / 256); ty < Math.ceil((region.y + region.h) / 256); ty++) {
          for (let tx = Math.floor(region.x / 256); tx < Math.ceil((region.x + region.w) / 256); tx++) outputTiles.add(`${tx},${ty}`);
        }
      }
      for (const key of outputTiles) {
        const [x, y] = key.split(',').map(Number);
        item.layer.runtime.surface.paint({x: x * 256, y: y * 256, w: 256, h: 256}, ctx => this.drawRasterFloat(ctx, item, true));
      }
    }
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

  private hitTest(px: number, py: number): { mode: DragMode; corner: number } | null {
    const f = this.float!;
    const tol = 14 * this.eng.uiScale();
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
}
