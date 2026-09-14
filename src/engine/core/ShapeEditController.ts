import { useStore } from '../../state/store';
import type { ShapeParams, ShapePoint, StrokePoint } from '../../model';
import {
  cloneShape,
  drawShapeGizmo,
  rotateShape,
  shapeBounds,
  shapeCenter,
  shapeKindHandler,
  shapePoints,
  shapeRotateHandle,
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

const HANDLE_RADIUS = 11;
const SNAP_SCREEN_PX = 8;

function vertexCanSnap(shape: ShapeParams, index: number): boolean {
  return shape.kind !== 'bubble-tail' || index === 2;
}

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
  return layer.type === 'shape'
    ? shapeDirty(layer.state.shape)
    : frameDirty(imageFrameShape(layer.state.placement));
}

export class ShapeEditController {
  private shapeEdit: ShapeEdit | null = null;
  private selectedHandle: {
    layerId: string;
    mode: ShapeEditMode;
    index?: number;
  } | null = null;

  constructor(private engine: PaintEngine) {}

  hasEdit(): boolean {
    return !!this.shapeEdit;
  }

  snapGuides(): { x: number | null; y: number | null } {
    return {
      x: this.shapeEdit?.xGuide ?? null,
      y: this.shapeEdit?.yGuide ?? null,
    };
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

  private historyProps(
    layer: FrameEditableLayer,
    shape: ShapeParams,
  ): LayerProps {
    if (layer.type === 'shape') return { state: { shape: cloneShape(shape) } };
    if (shape.kind !== 'rect')
      return { state: { placement: cloneImageParams(layer.state.placement) } };
    return {
      state: { placement: imageFromFrameShape(layer.state.placement, shape) },
    };
  }

  private syncVertexState(): void {
    const selected = this.selectedHandle;
    const layer = selected
      ? this.engine.layerService.shapeById(selected.layerId)
      : null;
    const vertices = layer
      ? shapeKindHandler(layer.state.shape).edit.vertexCount(layer.state.shape)
      : 0;
    const valid =
      !!layer &&
      selected!.layerId === this.engine.layerService.activeLayerId &&
      (selected!.mode === 'vertex'
        ? selected!.index !== undefined && selected!.index < vertices
        : layer.state.shape.kind === 'rect' ||
          layer.state.shape.kind === 'ellipse');
    if (!valid) this.selectedHandle = null;
    const showPolygonActions =
      valid && layer?.state.shape.kind !== 'bubble-tail';
    useStore.getState().set({
      shapeHandleSelected: showPolygonActions,
      shapeHandleCanDelete:
        showPolygonActions && selected?.mode === 'vertex' && vertices > 3,
      shapeHandleIsVertex: showPolygonActions && selected?.mode === 'vertex',
      shapeHandleEdgeConstrained: showPolygonActions
        ? useStore.getState().shapeHandleEdgeConstrained
        : false,
    });
  }

  /** 外接矩形の上に浮かぶ回転ハンドルの位置。種類によらず共通 */
  private rotateHandle(shape: ShapeParams): { x: number; y: number } {
    return shapeRotateHandle(shape, this.engine.uiScale());
  }

  private collectMoveSnapLines(editingId: string): SnapLines {
    const others = this.engine.layerService.layers.flatMap((layer) => {
      if (layer.id === editingId || !layer.visible) return [];
      if (layer.type === 'shape') return [shapeBounds(layer.state.shape)];
      if (layer.type === 'image')
        return [shapeBounds(imageFrameShape(layer.state.placement))];
      return [];
    });
    return collectSnapLines(this.engine.artboard, others);
  }

  private collectVertexSnapPoints(
    editingId: string,
    selectedIndex: number,
  ): ShapePoint[] {
    return this.engine.layerService.layers.flatMap((layer) => {
      if (
        layer.type !== 'shape' ||
        !layer.visible ||
        layer.state.shape.kind !== 'polygon'
      )
        return [];
      return shapePoints(layer.state.shape).filter(
        (_, index) => layer.id !== editingId || index !== selectedIndex,
      );
    });
  }

  private collectVertexSnapLines(
    editingId: string,
    selectedIndex: number,
  ): SnapLines {
    const lines = this.collectMoveSnapLines(editingId);
    const vertices = this.collectVertexSnapPoints(editingId, selectedIndex);
    const rank = Math.max(lines.x.length, lines.y.length) + 1;
    lines.x.push(...vertices.map((point) => ({ value: point.x, rank })));
    lines.y.push(...vertices.map((point) => ({ value: point.y, rank })));
    return lines;
  }

  private clearGuides(edit: ShapeEdit): void {
    edit.xGuide = null;
    edit.yGuide = null;
  }

  beginShapeEdit(point: StrokePoint, _event?: PointerEvent): boolean {
    const layer = this.editableById(this.engine.layerService.activeLayerId);
    if (!layer) {
      this.selectedHandle = null;
      this.syncVertexState();
      return false;
    }
    const shape = frameShapeOf(layer);
    const edit = shapeKindHandler(shape).edit;
    const radius = HANDLE_RADIUS * this.engine.uiScale();
    const near = (x: number, y: number) =>
      Math.hypot(point.x - x, point.y - y) <= radius;

    const rotate = this.rotateHandle(shape);
    const hit = shape.kind !== 'bubble-tail' && near(rotate.x, rotate.y)
      ? {
          mode: 'rotate' as ShapeEditMode,
          vertexIndex: undefined,
          shape: undefined,
        }
      : edit.hitHandle(shape, { point, near });
    const mode =
      hit?.mode ?? (edit.containsPoint(shape, point, radius) ? 'move' : null);
    if (!mode) return false;

    const before = cloneShape(shape);
    /** 辺の中点を掴んだときのように、ヒットと同時に図形が変わる場合 */
    if (hit?.shape) writeFrameShape(layer, hit.shape);

    const cornerIndex = (
      { nw: 0, ne: 1, se: 2, sw: 3 } as Partial<Record<ShapeEditMode, number>>
    )[mode];
    const vertexIndex = hit?.vertexIndex;
    if (mode === 'vertex')
      this.selectedHandle = {
        layerId: layer.id,
        mode,
        index: hit!.vertexIndex!,
      };
    else if (
      cornerIndex !== undefined &&
      (shape.kind === 'rect' || shape.kind === 'ellipse')
    )
      this.selectedHandle = { layerId: layer.id, mode, index: cornerIndex };
    else if (mode !== 'rotate') this.selectedHandle = null;

    let vertexWorld: VertexWorld | undefined;
    const handleIndex = mode === 'vertex' ? hit?.vertexIndex : cornerIndex;
    const snapVertexIndex =
      mode === 'vertex' &&
      vertexIndex !== undefined &&
      vertexCanSnap(shape, vertexIndex)
        ? vertexIndex
        : undefined;
    if (
      handleIndex !== undefined &&
      (mode === 'vertex' || shape.kind === 'rect' || shape.kind === 'ellipse')
    ) {
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
      snapLines:
        layer.state.snapEnabled && mode === 'move'
          ? this.collectMoveSnapLines(layer.id)
          : undefined,
      xGuide: null,
      yGuide: null,
      vertexWorld,
      vertexSnapPoints:
        layer.state.snapEnabled &&
        snapVertexIndex !== undefined
          ? this.collectVertexSnapPoints(layer.id, snapVertexIndex)
          : undefined,
      vertexSnapLines:
        layer.state.snapEnabled &&
        snapVertexIndex !== undefined
          ? this.collectVertexSnapLines(layer.id, snapVertexIndex)
          : undefined,
      snappedPoint: null,
    };
    this.syncVertexState();
    if (hit?.shape) {
      this.engine.invalidateLayer(
        layer.id,
        unionRect(shapeDirty(before), editableDirty(layer)),
      );
      this.engine.requestOverlayRender();
      this.engine.syncStore();
    }
    return true;
  }

  updateShapeEdit(point: StrokePoint, event?: PointerEvent): boolean {
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
        const snapped = snapTranslation(
          shapeBounds(edit.before),
          dx,
          dy,
          edit.snapLines ?? collectSnapLines(this.engine.artboard, []),
          SNAP_SCREEN_PX * this.engine.uiScale(),
        );
        next = translateShape(edit.before, snapped.dx, snapped.dy);
        edit.xGuide = snapped.xGuide;
        edit.yGuide = snapped.yGuide;
      }
    } else if (edit.mode === 'rotate') {
      const center = shapeCenter(edit.before);
      const initial = Math.atan2(
        edit.start.y - center.y,
        edit.start.x - center.x,
      );
      const rawDelta =
        Math.atan2(point.y - center.y, point.x - center.x) - initial;
      if (!layer.state.snapEnabled) {
        next = rotateShape(edit.before, rawDelta);
      } else {
        const startAbs = shapeRotation(edit.before);
        const snapped = snapAngleToRightAngles(startAbs + rawDelta);
        next = rotateShape(edit.before, snapped.angle - startAbs);
      }
    } else {
      let target = point;
      if (
        edit.vertexWorld &&
        ((event?.shiftKey ?? false) ||
          useStore.getState().shapeHandleEdgeConstrained)
      ) {
        const constrained = constrainVertexToEdges(
          point,
          edit.vertexWorld.prev,
          edit.vertexWorld.selected,
          edit.vertexWorld.next,
        );
        target = { ...point, x: constrained.x, y: constrained.y };
      }
      if (
        edit.mode === 'vertex' &&
        layer.state.snapEnabled &&
        edit.vertexSnapPoints
      ) {
        const snapped = snapPointToPoints(
          target,
          edit.vertexSnapPoints,
          SNAP_SCREEN_PX * this.engine.uiScale(),
        );
        target = { ...target, x: snapped.point.x, y: snapped.point.y };
        edit.snappedPoint = snapped.snappedTo;
        if (snapped.snappedTo) {
          edit.xGuide = snapped.snappedTo.x;
          edit.yGuide = snapped.snappedTo.y;
        }
        if (snapped.snappedTo && edit.vertexWorld) {
          const same = (a: ShapePoint, b: ShapePoint) =>
            Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
          edit.mergeVertexOnFinish =
            same(snapped.snappedTo, edit.vertexWorld.prev) ||
            same(snapped.snappedTo, edit.vertexWorld.next);
        }
        if (!snapped.snappedTo && edit.vertexSnapLines) {
          const lineSnapped = snapPointToLines(
            target,
            edit.vertexSnapLines,
            SNAP_SCREEN_PX * this.engine.uiScale(),
          );
          target = {
            ...target,
            x: lineSnapped.point.x,
            y: lineSnapped.point.y,
          };
          edit.xGuide = lineSnapped.xGuide;
          edit.yGuide = lineSnapped.yGuide;
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
        layer.type === 'image' &&
        layer.state.constrainAspect !== false &&
        edit.before.kind === 'rect' &&
        (edit.mode === 'nw' ||
          edit.mode === 'ne' ||
          edit.mode === 'se' ||
          edit.mode === 'sw')
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
    this.engine.invalidateLayer(
      layer.id,
      unionRect(previous, editableDirty(layer)),
    );
    this.engine.requestOverlayRender();
    this.engine.links.propagateFrom(
      { pageId: this.engine.pages.activePageId, layerId: layer.id },
      true,
    );
    return true;
  }

  finishShapeEdit(_point: StrokePoint): boolean {
    const edit = this.shapeEdit;
    if (!edit) return false;
    this.shapeEdit = null;
    const layer = this.editableById(edit.layerId);
    if (layer && edit.invalid && !edit.mergeVertexOnFinish) {
      writeFrameShape(layer, cloneShape(edit.lastValid ?? edit.before));
      this.engine.notify(
        shapeKindHandler(frameShapeOf(layer)).edit.invalidMessage ??
          '直前の有効な状態へ戻しました',
      );
      this.engine.invalidateLayer(
        layer.id,
        unionRect(shapeDirty(edit.before), editableDirty(layer)),
      );
      this.engine.requestOverlayRender();
      this.engine.syncStore();
    }
    if (
      layer?.type === 'shape' &&
      edit.mergeVertexOnFinish &&
      edit.vertexIndex !== undefined &&
      layer.state.shape.kind === 'polygon'
    ) {
      const merged = shapeKindHandler(layer.state.shape).edit.deleteVertex(
        layer.state.shape,
        edit.vertexIndex,
      );
      if (merged?.shape) {
        layer.state.shape = merged.shape;
        this.selectedHandle = null;
        this.engine.invalidateLayer(
          layer.id,
          unionRect(shapeDirty(edit.before), shapeDirty(layer.state.shape)),
        );
        this.engine.requestOverlayRender();
        this.engine.syncStore();
      } else if (layer.state.shape.points.length <= 3) {
        const rejected = cloneShape(layer.state.shape);
        layer.state.shape = cloneShape(edit.before);
        this.engine.notify(
          '多角形は3頂点未満にできないため、頂点を統合できません',
        );
        this.engine.invalidateLayer(
          layer.id,
          unionRect(shapeDirty(rejected), shapeDirty(layer.state.shape)),
        );
        this.engine.requestOverlayRender();
        this.engine.syncStore();
      }
    }
    if (
      layer &&
      JSON.stringify(frameShapeOf(layer)) !== JSON.stringify(edit.before)
    ) {
      const propsOp = {
        kind: 'layerProps' as const,
        layerId: layer.id,
        before: this.historyProps(layer, edit.before),
        after: this.historyProps(layer, frameShapeOf(layer)),
      };
      const linkOp = this.engine.layerService.linkOpForUserChange(
        layer,
        propsOp.before,
        propsOp.after,
      );
      this.engine.history.push(
        linkOp ? { kind: 'batch', ops: [propsOp, linkOp] } : propsOp,
        edit.vertexIndex !== undefined
          ? layer.type === 'shape' && layer.state.shape.kind === 'bubble-tail'
            ? 'しっぽを編集'
            : '多角形の頂点を編集'
          : layer.type === 'image'
            ? '画像を編集'
            : '図形を編集',
      );
      this.engine.links.propagateFrom({
        pageId: this.engine.pages.activePageId,
        layerId: layer.id,
      });
      this.engine.committed(false);
    } else {
      this.engine.requestOverlayRender();
      this.engine.syncStore();
    }
    this.syncVertexState();
    return true;
  }

  deleteSelectedVertex(): void {
    const selected = this.selectedHandle;
    const layer = selected
      ? this.engine.layerService.shapeById(selected.layerId)
      : null;
    if (
      !selected ||
      selected.mode !== 'vertex' ||
      selected.index === undefined ||
      !layer
    )
      return;
    const before = cloneShape(layer.state.shape);
    const result = shapeKindHandler(before).edit.deleteVertex(
      before,
      selected.index,
    );
    if (!result) return;
    if (!result.shape) {
      if (result.error) this.engine.notify(result.error);
      return;
    }
    this.engine.layerService.assignProps(layer, {
      state: { shape: result.shape },
    });
    this.selectedHandle = null;
    this.syncVertexState();
    const propsOp = {
      kind: 'layerProps' as const,
      layerId: layer.id,
      before: { state: { shape: before } },
      after: { state: { shape: cloneShape(layer.state.shape) } },
    };
    const linkOp = this.engine.layerService.linkOpForUserChange(
      layer,
      propsOp.before,
      propsOp.after,
    );
    this.engine.history.push(
      linkOp ? { kind: 'batch', ops: [propsOp, linkOp] } : propsOp,
      '多角形の頂点を削除',
    );
    this.engine.links.propagateFrom({
      pageId: this.engine.pages.activePageId,
      layerId: layer.id,
    });
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
    if (layer && previous)
      this.engine.invalidateLayer(
        layer.id,
        unionRect(previous, editableDirty(layer)),
      );
    this.engine.requestOverlayRender();
    this.engine.syncStore();
  }

  drawActiveShapeHandles(
    ctx: CanvasRenderingContext2D,
    handles = true,
  ): void {
    const layer = this.editableById(this.engine.layerService.activeLayerId);
    if (!layer) {
      if (this.selectedHandle) {
        this.selectedHandle = null;
        this.syncVertexState();
      }
      return;
    }
    if (this.selectedHandle && this.selectedHandle.layerId !== layer.id) {
      this.selectedHandle = null;
      this.syncVertexState();
    }
    const shape = frameShapeOf(layer);
    const scale = this.engine.uiScale();
    const invalid = handles && !!this.shapeEdit?.invalid;
    ctx.save();
    const xGuide = handles ? this.shapeEdit?.xGuide : null;
    const yGuide = handles ? this.shapeEdit?.yGuide : null;
    if (
      (xGuide !== null && xGuide !== undefined) ||
      (yGuide !== null && yGuide !== undefined)
    ) {
      ctx.strokeStyle = '#4f8cff';
      ctx.lineWidth = scale;
      ctx.setLineDash([6 * scale, 4 * scale]);
      if (xGuide !== null && xGuide !== undefined) {
        ctx.beginPath();
        ctx.moveTo(xGuide, 0);
        ctx.lineTo(xGuide, this.engine.artboard.h);
        ctx.stroke();
      }
      if (yGuide !== null && yGuide !== undefined) {
        ctx.beginPath();
        ctx.moveTo(0, yGuide);
        ctx.lineTo(this.engine.artboard.w, yGuide);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const snappedPoint = handles ? this.shapeEdit?.snappedPoint : null;
    if (snappedPoint) {
      ctx.strokeStyle = '#4f8cff';
      ctx.fillStyle = '#4f8cff33';
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.arc(snappedPoint.x, snappedPoint.y, 8 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    drawShapeGizmo(ctx, shape, {
      scale,
      invalid,
      handles,
      insertions: handles,
      selectedIndex:
        handles && this.selectedHandle?.layerId === layer.id
          ? this.selectedHandle.index
          : undefined,
    });
    ctx.restore();
  }
}
