import { ScopeTransforms } from './ScopeTransforms';
import { inverse, project, multiply, scaling, transformBounds } from '../geometry/homography';
import { drawProjectedProcedure } from '../geometry/drawProjectedProcedure';
import { useStore } from '../../state/store';
import type { ShapeParams, ShapePoint, StrokePoint } from '../../model';
import {
  cloneShape,
  rotateShape,
  shapeBounds,
  shapeCenter,
  shapeKindHandler,
  shapePoints,
  shapeRotation,
  shapeVisualPadding,
  translateShape,
  type ShapeEditMode,
} from '../shapes';
import { resizeByCorner } from '../shapes/kinds/common';
import {
  collectSnapLines,
  constrainVertexToEdges,
  snapAngleToRightAngles,
  snapPointToPoints,
  snapPointToLines,
  snapTranslation,
  type SnapLines,
} from '../shapes/snap';
import type { PaintEngine } from '../PaintEngine';
import { unionRect, type DirtyRect } from '../brush';
import {
  frameDirty,
  frameShapeOf,
  imageFrameShape,
  imageFromFrameShape,
  writeFrameShape,
  type FrameEditableLayer,
} from '../image/frame';
import { cloneImageParams } from '../../model';
import type { LayerProps } from '../history/historyTree';

interface VertexWorld {
  prev: ShapePoint;
  selected: ShapePoint;
  next: ShapePoint;
}

interface ShapeEdit {
  layerId: string;
  mode: ShapeEditMode;
  start: StrokePoint;
  before: ShapeParams;
  vertexIndex?: number;
  invalid?: boolean;
  lastValid?: ShapeParams;
  snapLines?: SnapLines;
  xGuide: number | null;
  yGuide: number | null;
  vertexWorld?: VertexWorld;
  vertexSnapPoints?: ShapePoint[];
  vertexSnapLines?: SnapLines;
  snappedPoint?: ShapePoint | null;
  mergeVertexOnFinish?: boolean;
}

/** 回転ハンドルは外接矩形の上辺からこれだけ離す (画面 px) */
const ROTATE_HANDLE_GAP = 28;
const HANDLE_RADIUS = 11;
const SNAP_SCREEN_PX = 8;

function shapeDirty(shape: ShapeParams): DirtyRect {
  const bounds = shapeBounds(shape);
  const pad = Math.max(3, shapeVisualPadding(shape));
  return {
    minX: bounds.x - pad,
    minY: bounds.y - pad,
    maxX: bounds.x + bounds.w + pad,
    maxY: bounds.y + bounds.h + pad,
  };
}

function editableDirty(layer: FrameEditableLayer): DirtyRect {
  return layer.type === 'shape' ? shapeDirty(layer.state.shape) : frameDirty(imageFrameShape(layer.state.placement));
}

export class ShapeEditController {
  private shapeEdit: ShapeEdit | null = null;
  private selectedHandle: { layerId: string; mode: ShapeEditMode; index?: number } | null = null;

  constructor(private engine: PaintEngine) {}

  private uiScale(): number { return this.engine.uiScale() * 25.4 / this.engine.getPageSpec().ppi; }
  private transforms(): ScopeTransforms {
    return new ScopeTransforms(this.engine.getRootLayerIds(), this.engine.allLayers(), this.engine.getPageSpec().ppi);
  }
  private modelPoint(point: StrokePoint): StrokePoint | null {
    const inv = inverse(this.transforms().geometryToPage(this.engine.getActiveLayerId()));
    const local = inv && project(inv, point); if (!local) return null;
    const factor = 25.4 / this.engine.getPageSpec().ppi;
    return {...point, x: local.x * factor, y: local.y * factor};
  }
  private invalidate(id: string, rect: DirtyRect): void {
    const matrix = multiply(this.transforms().geometryToPage(id), scaling(this.engine.getPageSpec().ppi / 25.4));
    const area = transformBounds(matrix, {x: rect.minX, y: rect.minY, w: rect.maxX - rect.minX, h: rect.maxY - rect.minY});
    if (area) this.engine.invalidateLayer(id, {minX: area.x, minY: area.y, maxX: area.x + area.w, maxY: area.y + area.h});
    else this.engine.requestRender();
  }

  hasEdit(): boolean { return !!this.shapeEdit; }

  snapGuides(): { x: number | null; y: number | null } {
    return {x: this.shapeEdit?.xGuide ?? null, y: this.shapeEdit?.yGuide ?? null};
  }

  refreshVertexState(): void {
    this.syncVertexState();
  }

  setShapeHandleEdgeConstrained(value: boolean): void {
    if (value && !this.selectedHandle) value = false;
    useStore.getState().set({ shapeHandleEdgeConstrained: value });
  }

  private editableById(id: string): FrameEditableLayer | null {
    const layer = this.engine.layerService.byId(id);
    return layer?.type === 'shape' || layer?.type === 'image' ? layer : null;
  }

  private historyProps(layer: FrameEditableLayer, shape: ShapeParams): LayerProps {
    if (layer.type === 'shape') return { state: { shape: cloneShape(shape) } };
    if (shape.kind !== 'rect') return { state: { placement: cloneImageParams(layer.state.placement) } };
    return { state: { placement: imageFromFrameShape(layer.state.placement, shape) } };
  }

  private syncVertexState(): void {
    const selected = this.selectedHandle;
    const layer = selected ? this.engine.layerService.shapeById(selected.layerId) : null;
    const vertices = layer ? shapeKindHandler(layer.state.shape).edit.vertexCount(layer.state.shape) : 0;
    const valid = !!layer
      && selected!.layerId === this.engine.layerService.activeLayerId
      && (selected!.mode === 'vertex'
        ? selected!.index !== undefined && selected!.index < vertices
        : layer.state.shape.kind === 'rect' || layer.state.shape.kind === 'ellipse');
    if (!valid) this.selectedHandle = null;
    const showPolygonActions = valid && layer?.state.shape.kind !== 'bubble-tail';
    useStore.getState().set({
      shapeHandleSelected: showPolygonActions,
      shapeHandleCanDelete: showPolygonActions && selected?.mode === 'vertex' && vertices > 3,
      shapeHandleIsVertex: showPolygonActions && selected?.mode === 'vertex',
      shapeHandleEdgeConstrained: showPolygonActions ? useStore.getState().shapeHandleEdgeConstrained : false,
    });
  }

  /** 外接矩形の上に浮かぶ回転ハンドルの位置。種類によらず共通 */
  private rotateHandle(shape: ShapeParams): { x: number; y: number } {
    return { x: shapeCenter(shape).x, y: shapeBounds(shape).y - ROTATE_HANDLE_GAP * this.uiScale() };
  }

  private collectMoveSnapLines(editingId: string): SnapLines {
    return collectSnapLines(this.engine.artboard, this.engine.visibleObjectBounds(editingId), this.engine.layerService.scopeOf(editingId) === null);
  }

  private geometryMmToPage(id: string) {
    return multiply(this.transforms().geometryToPage(id), scaling(this.engine.getPageSpec().ppi / 25.4));
  }

  private collectVertexSnapPoints(editingId: string, selectedIndex: number): ShapePoint[] {
    return this.engine.layerService.layers.flatMap(layer => {
      if (this.engine.layerService.scopeOf(layer.id) !== this.engine.layerService.scopeOf(editingId) || layer.type !== 'shape' || !layer.visible || layer.state.shape.kind !== 'polygon') return [];
      const matrix = this.geometryMmToPage(layer.id);
      return shapePoints(layer.state.shape).flatMap((point, index) => {
        if (layer.id === editingId && index === selectedIndex) return [];
        const displayed = project(matrix, point); return displayed ? [displayed] : [];
      });
    });
  }

  private collectVertexSnapLines(editingId: string, selectedIndex: number): SnapLines {
    const lines = this.collectMoveSnapLines(editingId);
    const vertices = this.collectVertexSnapPoints(editingId, selectedIndex);
    const rank = Math.max(lines.x.length, lines.y.length) + 1;
    lines.x.push(...vertices.map(point => ({ value: point.x, rank })));
    lines.y.push(...vertices.map(point => ({ value: point.y, rank })));
    return lines;
  }

  private clearGuides(edit: ShapeEdit): void {
    edit.xGuide = null;
    edit.yGuide = null;
  }

  beginShapeEdit(point: StrokePoint, _event?: PointerEvent): boolean {
    const localPoint = this.modelPoint(point); if (!localPoint) return false;
    point = localPoint;
    const layer = this.editableById(this.engine.layerService.activeLayerId);
    if (!layer) { this.selectedHandle = null; this.syncVertexState(); return false; }
    const shape = frameShapeOf(layer);
    const edit = shapeKindHandler(shape).edit;
    const radius = HANDLE_RADIUS * this.uiScale();
    const near = (x: number, y: number) => Math.hypot(point.x - x, point.y - y) <= radius;

    const rotate = this.rotateHandle(shape);
    const hit = near(rotate.x, rotate.y)
      ? { mode: 'rotate' as ShapeEditMode, vertexIndex: undefined, shape: undefined }
      : edit.hitHandle(shape, { point, near });
    const mode = hit?.mode ?? (edit.containsPoint(shape, point, radius) ? 'move' : null);
    if (!mode) return false;

    const before = cloneShape(shape);
    /** 辺の中点を掴んだときのように、ヒットと同時に図形が変わる場合 */
    if (hit?.shape) writeFrameShape(layer, hit.shape);

    const cornerIndex = ({ nw: 0, ne: 1, se: 2, sw: 3 } as Partial<Record<ShapeEditMode, number>>)[mode];
    if (mode === 'vertex') this.selectedHandle = { layerId: layer.id, mode, index: hit!.vertexIndex! };
    else if (cornerIndex !== undefined && (shape.kind === 'rect' || shape.kind === 'ellipse')) this.selectedHandle = { layerId: layer.id, mode, index: cornerIndex };
    else if (mode !== 'rotate') this.selectedHandle = null;

    let vertexWorld: VertexWorld | undefined;
    const handleIndex = mode === 'vertex' ? hit?.vertexIndex : cornerIndex;
    if (handleIndex !== undefined && (mode === 'vertex' || shape.kind === 'rect' || shape.kind === 'ellipse')) {
      const world = shapePoints(frameShapeOf(layer));
      const count = world.length;
      const index = handleIndex;
      vertexWorld = {
        prev: world[(index - 1 + count) % count],
        selected: world[index],
        next: world[(index + 1) % count],
      };
    }

    this.shapeEdit = {
      layerId: layer.id,
      mode,
      start: point,
      before,
      vertexIndex: hit?.vertexIndex,
      lastValid: cloneShape(frameShapeOf(layer)),
      snapLines: mode === 'move' ? this.collectMoveSnapLines(layer.id) : undefined,
      xGuide: null,
      yGuide: null,
      vertexWorld,
      vertexSnapPoints: mode === 'vertex' && hit?.vertexIndex !== undefined
        ? this.collectVertexSnapPoints(layer.id, hit.vertexIndex)
        : undefined,
      vertexSnapLines: mode === 'vertex' && hit?.vertexIndex !== undefined
        ? this.collectVertexSnapLines(layer.id, hit.vertexIndex)
        : undefined,
      snappedPoint: null,
    };
    this.syncVertexState();
    if (hit?.shape) {
      this.invalidate(layer.id, unionRect(shapeDirty(before), editableDirty(layer)));
      this.engine.requestOverlayRender();
      this.engine.syncStore();
    }
    return true;
  }

  updateShapeEdit(point: StrokePoint, event?: PointerEvent): boolean {
    const localPoint = this.modelPoint(point); if (!localPoint) return false;
    point = localPoint;
    const edit = this.shapeEdit;
    if (!edit) return false;
    const layer = this.editableById(edit.layerId);
    if (!layer) {
      this.shapeEdit = null;
      this.engine.requestRender();
      this.engine.syncStore();
      return false;
    }
    let next: ShapeParams = cloneShape(edit.before);
    this.clearGuides(edit);
    edit.snappedPoint = null;
    edit.mergeVertexOnFinish = false;
    if (edit.mode === 'move') {
      const dx = point.x - edit.start.x;
      const dy = point.y - edit.start.y;
      if (!layer.state.snapEnabled) {
        next = translateShape(edit.before, dx, dy);
      } else {
        const matrix = this.geometryMmToPage(layer.id), inv = inverse(matrix);
        const moved = translateShape(edit.before, dx, dy);
        const bounds = transformBounds(matrix, shapeBounds(moved));
        const center = shapeCenter(moved), anchor = project(matrix, center);
        const snapped = bounds && snapTranslation(bounds, 0, 0,
          edit.snapLines ?? this.collectMoveSnapLines(layer.id), SNAP_SCREEN_PX * this.engine.uiScale());
        const corrected = snapped && anchor && inv && project(inv, {x: anchor.x + snapped.dx, y: anchor.y + snapped.dy});
        next = corrected ? translateShape(moved, corrected.x - center.x, corrected.y - center.y) : moved;
        edit.xGuide = snapped?.xGuide ?? null;
        edit.yGuide = snapped?.yGuide ?? null;
      }
    } else if (edit.mode === 'rotate') {
      const center = shapeCenter(edit.before);
      const initial = Math.atan2(edit.start.y - center.y, edit.start.x - center.x);
      const rawDelta = Math.atan2(point.y - center.y, point.x - center.x) - initial;
      if (!layer.state.snapEnabled) {
        next = rotateShape(edit.before, rawDelta);
      } else {
        const startAbs = shapeRotation(edit.before);
        const snapped = snapAngleToRightAngles(startAbs + rawDelta);
        next = rotateShape(edit.before, snapped.angle - startAbs);
      }
    } else {
      let target = point;
      if (edit.vertexWorld && ((event?.shiftKey ?? false) || useStore.getState().shapeHandleEdgeConstrained)) {
        const constrained = constrainVertexToEdges(point, edit.vertexWorld.prev, edit.vertexWorld.selected, edit.vertexWorld.next);
        target = { ...point, x: constrained.x, y: constrained.y };
      }
      if (edit.mode === 'vertex' && layer.state.snapEnabled && edit.vertexSnapPoints) {
        const matrix = this.geometryMmToPage(layer.id), inv = inverse(matrix);
        const displayed = project(matrix, target);
        if (displayed && inv) {
          const snapped = snapPointToPoints(displayed, edit.vertexSnapPoints, SNAP_SCREEN_PX * this.engine.uiScale());
          const lines = !snapped.snappedTo && edit.vertexSnapLines
            ? snapPointToLines(displayed, edit.vertexSnapLines, SNAP_SCREEN_PX * this.engine.uiScale()) : null;
          const local = project(inv, lines?.point ?? snapped.point);
          if (local) target = {...target, ...local};
          edit.snappedPoint = snapped.snappedTo && local;
          edit.xGuide = snapped.snappedTo?.x ?? lines?.xGuide ?? null;
          edit.yGuide = snapped.snappedTo?.y ?? lines?.yGuide ?? null;
          if (snapped.snappedTo && local && edit.vertexWorld) {
            const same = (a: ShapePoint, b: ShapePoint) => Math.abs(a.x-b.x) < 1e-6 && Math.abs(a.y-b.y) < 1e-6;
            edit.mergeVertexOnFinish = same(local, edit.vertexWorld.prev) || same(local, edit.vertexWorld.next);
          }
        }
      }
      const result = shapeKindHandler(edit.before).edit.dragHandle({
        mode: edit.mode,
        before: edit.before,
        current: frameShapeOf(layer),
        vertexIndex: edit.vertexIndex,
        point: target,
      });
      if (result) {
        next = result.shape;
        if (result.invalid !== undefined) {
          edit.invalid = result.invalid;
          if (!result.invalid) edit.lastValid = cloneShape(next);
        }
      }
      if (
        layer.type === 'image'
        && layer.state.constrainAspect !== false
        && edit.before.kind === 'rect'
        && (edit.mode === 'nw' || edit.mode === 'ne' || edit.mode === 'se' || edit.mode === 'sw')
      ) {
        const size = resizeByCorner(
          edit.mode,
          shapeCenter(edit.before),
          edit.before.rotation ?? 0,
          edit.before.width / 2,
          edit.before.height / 2,
          target,
          true,
        );
        if (size) {
          next = {
            ...edit.before,
            x: size.cx - size.w / 2,
            y: size.cy - size.h / 2,
            width: size.w,
            height: size.h,
          };
        }
      }
    }
    const previous = editableDirty(layer);
    writeFrameShape(layer, next);
    this.syncVertexState();
    this.invalidate(layer.id, unionRect(previous, editableDirty(layer)));
    this.engine.requestOverlayRender();
    this.engine.links.propagateFrom({ document: this.engine.documentKey, layerId: layer.id }, true);
    this.engine.syncStore();
    return true;
  }

  finishShapeEdit(_point: StrokePoint): boolean {
    const edit = this.shapeEdit;
    if (!edit) return false;
    this.shapeEdit = null;
    const layer = this.editableById(edit.layerId);
    if (layer && edit.invalid && !edit.mergeVertexOnFinish) {
      writeFrameShape(layer, cloneShape(edit.lastValid ?? edit.before));
      this.engine.notify(shapeKindHandler(frameShapeOf(layer)).edit.invalidMessage ?? '直前の有効な状態へ戻しました');
      this.invalidate(layer.id, unionRect(shapeDirty(edit.before), editableDirty(layer)));
      this.engine.requestOverlayRender();
      this.engine.syncStore();
    }
    if (layer?.type === 'shape' && edit.mergeVertexOnFinish && edit.vertexIndex !== undefined && layer.state.shape.kind === 'polygon') {
      const merged = shapeKindHandler(layer.state.shape).edit.deleteVertex(layer.state.shape, edit.vertexIndex);
      if (merged?.shape) {
        layer.state.shape = merged.shape;
        this.selectedHandle = null;
        this.invalidate(layer.id, unionRect(shapeDirty(edit.before), shapeDirty(layer.state.shape)));
        this.engine.requestOverlayRender();
        this.engine.syncStore();
      } else if (layer.state.shape.points.length <= 3) {
        const rejected = cloneShape(layer.state.shape);
        layer.state.shape = cloneShape(edit.before);
        this.engine.notify('多角形は3頂点未満にできないため、頂点を統合できません');
        this.invalidate(layer.id, unionRect(shapeDirty(rejected), shapeDirty(layer.state.shape)));
        this.engine.requestOverlayRender();
        this.engine.syncStore();
      }
    }
    if (layer && JSON.stringify(frameShapeOf(layer)) !== JSON.stringify(edit.before)) {
      const propsOp = {
        kind: 'layerProps' as const,
        layerId: layer.id,
        before: this.historyProps(layer, edit.before),
        after: this.historyProps(layer, frameShapeOf(layer)),
      };
      const linkOp = this.engine.layerService.linkOpForUserChange(layer, propsOp.before, propsOp.after);
      this.engine.history.push(linkOp ? { kind: 'batch', ops: [propsOp, linkOp] } : propsOp, edit.vertexIndex !== undefined ? (layer.type === 'shape' && layer.state.shape.kind === 'bubble-tail' ? 'しっぽを編集' : '多角形の頂点を編集') : layer.type === 'image' ? '画像を編集' : '図形を編集');
      this.engine.links.propagateFrom({ document: this.engine.documentKey, layerId: layer.id });
      this.engine.committed(false);
    } else {
      this.engine.requestOverlayRender();
    }
    this.syncVertexState();
    return true;
  }

  deleteSelectedVertex(): void {
    const selected = this.selectedHandle;
    const layer = selected ? this.engine.layerService.shapeById(selected.layerId) : null;
    if (!selected || selected.mode !== 'vertex' || selected.index === undefined || !layer) return;
    const before = cloneShape(layer.state.shape);
    const result = shapeKindHandler(before).edit.deleteVertex(before, selected.index);
    if (!result) return;
    if (!result.shape) { if (result.error) this.engine.notify(result.error); return; }
    this.engine.layerService.assignProps(layer, { state: { shape: result.shape } });
    this.selectedHandle = null;
    this.syncVertexState();
    const propsOp = { kind: 'layerProps' as const, layerId: layer.id, before: { state: { shape: before } }, after: { state: { shape: cloneShape(layer.state.shape) } } };
    const linkOp = this.engine.layerService.linkOpForUserChange(layer, propsOp.before, propsOp.after);
    this.engine.history.push(linkOp ? { kind: 'batch', ops: [propsOp, linkOp] } : propsOp, '多角形の頂点を削除');
    this.engine.links.propagateFrom({ document: this.engine.documentKey, layerId: layer.id });
    this.engine.committed();
  }

  cancelShapeEdit(): void {
    const edit = this.shapeEdit;
    if (!edit) return;
    const layer = this.editableById(edit.layerId);
    const previous = layer ? editableDirty(layer) : null;
    if (layer) writeFrameShape(layer, edit.before);
    this.shapeEdit = null;
    this.syncVertexState();
    if (layer && previous) this.invalidate(layer.id, unionRect(previous, editableDirty(layer)));
    this.engine.requestOverlayRender();
    this.engine.syncStore();
  }

  drawActiveShapeHandles(ctx: CanvasRenderingContext2D): void {
    const layer = this.editableById(this.engine.getActiveLayerId());
    if (!layer) {this.drawLocalHandles(ctx); return;}
    const guides = this.snapGuides(), scale = this.engine.uiScale();
    ctx.save(); ctx.strokeStyle = '#4f8cff'; ctx.lineWidth = scale; ctx.setLineDash([6*scale, 4*scale]);
    if (guides.x !== null) {ctx.beginPath(); ctx.moveTo(guides.x, 0); ctx.lineTo(guides.x, this.engine.artboard.h); ctx.stroke();}
    if (guides.y !== null) {ctx.beginPath(); ctx.moveTo(0, guides.y); ctx.lineTo(this.engine.artboard.w, guides.y); ctx.stroke();}
    ctx.restore();
    const bounds = shapeBounds(frameShapeOf(layer)), px = this.engine.getPageSpec().ppi / 25.4;
    const padding = 60 * this.uiScale();
    drawProjectedProcedure(ctx, {x: (bounds.x-padding)*px, y: (bounds.y-padding)*px,
      w: (bounds.w+padding*2)*px, h: (bounds.h+padding*2)*px}, this.transforms().geometryToPage(layer.id), source => this.drawLocalHandles(source));
  }

  private drawLocalHandles(ctx: CanvasRenderingContext2D): void {
    const layer = this.editableById(this.engine.layerService.activeLayerId);
    if (!layer) { if (this.selectedHandle) { this.selectedHandle = null; this.syncVertexState(); } return; }
    if (this.selectedHandle && this.selectedHandle.layerId !== layer.id) {
      this.selectedHandle = null;
      this.syncVertexState();
    }
    const shape = frameShapeOf(layer), bounds = shapeBounds(shape), scale = this.uiScale(), center = shapeCenter(shape);
    const invalid = !!this.shapeEdit?.invalid;
    const points = shapePoints(shape);
    const insertions = shapeKindHandler(shape).edit.insertionPoints(shape);
    const rotateHandle = this.rotateHandle(shape);
    ctx.save();
    const pixelsPerMm = this.engine.getPageSpec().ppi / 25.4;
    ctx.scale(pixelsPerMm, pixelsPerMm);
    const snappedPoint = this.shapeEdit?.snappedPoint;
    if (snappedPoint) {
      ctx.strokeStyle = '#4f8cff';
      ctx.fillStyle = '#4f8cff33';
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.arc(snappedPoint.x, snappedPoint.y, 8 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.strokeStyle = invalid ? '#e53935' : '#4f8cff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5 * scale;
    if (shape.kind === 'bubble-tail') {
      ctx.setLineDash([4 * scale, 3 * scale]);
      ctx.beginPath();
      ctx.moveTo(shape.start.x, shape.start.y);
      ctx.lineTo(shape.control.x, shape.control.y);
      ctx.lineTo(shape.tip.x, shape.tip.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (invalid) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([4 * scale, 3 * scale]); ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h); ctx.setLineDash([]);
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      ctx.fillStyle = this.selectedHandle?.layerId === layer.id && this.selectedHandle.index === index ? '#4f8cff' : '#fff';
      ctx.beginPath(); ctx.rect(point.x - 4 * scale, point.y - 4 * scale, 8 * scale, 8 * scale); ctx.fill(); ctx.stroke();
      const insertion = insertions[index];
      if (!insertion) continue;
      const { x, y } = insertion;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 4 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 2 * scale, y); ctx.lineTo(x + 2 * scale, y); ctx.moveTo(x, y - 2 * scale); ctx.lineTo(x, y + 2 * scale); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(center.x, bounds.y); ctx.lineTo(rotateHandle.x, rotateHandle.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(rotateHandle.x, rotateHandle.y, 5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const arm = 8 * scale;
    const drawCenter = () => {
      ctx.beginPath();
      ctx.moveTo(center.x - arm, center.y); ctx.lineTo(center.x + arm, center.y);
      ctx.moveTo(center.x, center.y - arm); ctx.lineTo(center.x, center.y + arm);
      ctx.stroke();
    };
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * scale; drawCenter();
    ctx.strokeStyle = invalid ? '#e53935' : '#4f8cff'; ctx.lineWidth = 1.5 * scale; drawCenter();
    ctx.restore();
  }
}
