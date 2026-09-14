import { useStore } from '../../state/store';
import { TRANSPARENT, type StrokePoint } from '../../model';
import { checkerPattern } from '../brush';
import type { ViewState } from '../view';
import type { PaintEngine } from '../PaintEngine';
import { shortcutIdForEvent } from '../../shortcuts';
import type { EyedropperSource } from '../../tools/eyedropper/settings';

interface Loupe {
  x: number;
  y: number;
  pointerId: number;
  color: string;
  source: EyedropperSource;
  restorePreviousTool: boolean;
}

interface Gesture {
  id1: number;
  id2: number;
  start: ViewState;
  c0: { x: number; y: number };
  d0: number;
  a0: number;
}

interface PanDrag {
  id: number;
  lastX: number;
  lastY: number;
}

interface PendingPress {
  pointerId: number;
  start: StrokePoint;
  latest: StrokePoint;
  startClientX: number;
  startClientY: number;
  timer: ReturnType<typeof setTimeout>;
}

const EYEDROPPER_HOLD_MS = 500;
const EYEDROPPER_MOVE_TOLERANCE_PX = 12;

/** Pointer, gesture, wheel, keyboard, and eyedropper handling. */
export class InputController {
  activePointer: number | null = null;
  pendingPress: PendingPress | null = null;
  loupe: Loupe | null = null;
  area: HTMLElement | null = null;
  touchPts = new Map<number, { x: number; y: number }>();
  gesture: Gesture | null = null;
  panDrag: PanDrag | null = null;
  spaceDown = false;
  private panShortcutCode: string | null = null;
  private layerPickPointer: number | null = null;

  private moveFrame = 0;
  private pendingMove: {
    event: PointerEvent;
    apply: (event: PointerEvent) => void;
  } | null = null;

  private queueMove(
    event: PointerEvent,
    apply: (event: PointerEvent) => void,
  ): void {
    this.pendingMove = { event, apply };
    if (!this.moveFrame)
      this.moveFrame = requestAnimationFrame(() => {
        this.moveFrame = 0;
        const pending = this.pendingMove;
        if (pending) this.guardPointer(() => this.flushMove())(pending.event);
      });
  }

  private flushMove(): void {
    const pending = this.pendingMove;
    this.clearMove();
    pending?.apply(pending.event);
  }

  private clearMove(): void {
    if (this.moveFrame) cancelAnimationFrame(this.moveFrame);
    this.moveFrame = 0;
    this.pendingMove = null;
  }

  constructor(private engine: PaintEngine) {}

  private isLayerPickClick(e: PointerEvent): boolean {
    return e.metaKey;
  }

  private beginLayerPick(point: StrokePoint, event: PointerEvent): void {
    this.layerPickPointer = event.pointerId;
    this.engine.cursor.onDown(point, event);
  }

  private beginEditableShape(point: StrokePoint, event: PointerEvent): boolean {
    return (
      this.engine.activeTool().allowsDirectShapeEdit !== false &&
      this.engine.beginShapeEdit(point, event)
    );
  }

  attachListeners(area: HTMLElement): void {
    this.area = area;
    area.addEventListener('pointerdown', this.onPointerDown);
    area.addEventListener('pointermove', this.onPointerMove);
    area.addEventListener('pointerup', this.onPointerUp);
    area.addEventListener('pointercancel', this.onPointerCancel);
    area.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  detachListeners(): void {
    this.clearMove();
    const a = this.area;
    if (a) {
      a.removeEventListener('pointerdown', this.onPointerDown);
      a.removeEventListener('pointermove', this.onPointerMove);
      a.removeEventListener('pointerup', this.onPointerUp);
      a.removeEventListener('pointercancel', this.onPointerCancel);
      a.removeEventListener('wheel', this.onWheel);
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.touchPts.clear();
    this.gesture = null;
    this.panDrag = null;
    this.clearPendingPress();
    this.layerPickPointer = null;
    this.area = null;
  }

  toPoint(e: {
    clientX: number;
    clientY: number;
    pressure?: number;
    pointerType?: string;
  }): StrokePoint {
    const { x, y } = this.engine.view.clientToArt(e.clientX, e.clientY);
    const pressure =
      e.pointerType === 'mouse'
        ? 1
        : e.pressure && e.pressure > 0
          ? e.pressure
          : 0.5;
    return { x, y, pressure };
  }

  private isUiTarget(e: Event): boolean {
    const t = e.target as Element | null;
    return !!t && !!t.closest('button, [data-canvas-ui]');
  }

  private onPointerDownImpl = (e: PointerEvent): void => {
    const eng = this.engine;
    if (this.isUiTarget(e)) return;
    if (useStore.getState().textEditingId) eng.finishTextEditing();
    if (
      e.pointerType === 'mouse' &&
      (e.button === 1 || (e.button === 0 && this.spaceDown))
    ) {
      this.panDrag = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      this.area?.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.pointerType === 'touch') {
      this.touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.gesture) return;
      if (this.touchPts.size === 2) {
        this.beginGesture(e);
        return;
      }
      if (this.touchPts.size > 2) return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.loupe) return;
    if (eng.isBusy() || this.activePointer !== null) return;
    const p = this.toPoint(e);
    this.activePointer = e.pointerId;
    this.area?.setPointerCapture(e.pointerId);
    if (this.isLayerPickClick(e)) {
      this.beginLayerPick(p, e);
      e.preventDefault();
      return;
    }
    const activeTool = eng.activeTool();
    if (activeTool.startsImmediately) {
      activeTool.onDown(p, e);
      e.preventDefault();
      return;
    }
    const pointerId = e.pointerId;
    this.pendingPress = {
      pointerId,
      start: p,
      latest: p,
      startClientX: e.clientX,
      startClientY: e.clientY,
      timer: setTimeout(() => {
        const pending = this.pendingPress;
        if (
          !pending ||
          pending.pointerId !== pointerId ||
          this.activePointer !== pointerId
        ) {
          return;
        }
        this.pendingPress = null;
        this.activePointer = null;
        const point = pending.latest;
        this.beginEyedropper(
          point,
          pointerId,
          eng.longPressEyedropperSource(),
          false,
        );
      }, EYEDROPPER_HOLD_MS),
    };
    e.preventDefault();
  };

  private beginGesture(e: PointerEvent): void {
    this.clearMove();
    const eng = this.engine;
    if (this.activePointer !== null && this.touchPts.has(this.activePointer)) {
      if (this.pendingPress?.pointerId === this.activePointer) {
        this.clearPendingPress();
      } else if (eng.hasShapeEdit()) {
        eng.cancelShapeEdit();
      } else {
        eng.activeTool().cancel?.();
      }
      this.activePointer = null;
      eng.requestRender();
    }
    this.loupe = null;
    const [[id1, p1], [id2, p2]] = [...this.touchPts.entries()];
    this.gesture = {
      id1,
      id2,
      start: eng.view.snapshot(),
      c0: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      d0: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      a0: Math.atan2(p2.y - p1.y, p2.x - p1.x),
    };
    this.area?.setPointerCapture(id1);
    this.area?.setPointerCapture(id2);
    e.preventDefault();
  }

  private updateGesture(): void {
    const g = this.gesture;
    if (!g) return;
    const p1 = this.touchPts.get(g.id1);
    const p2 = this.touchPts.get(g.id2);
    if (!p1 || !p2) return;
    this.engine.view.applyGesture(
      g.start,
      g.c0,
      g.d0,
      g.a0,
      { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      Math.hypot(p2.x - p1.x, p2.y - p1.y),
      Math.atan2(p2.y - p1.y, p2.x - p1.x),
    );
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const view = this.engine.view;
    if (e.ctrlKey || e.metaKey) {
      view.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    } else if (e.shiftKey) {
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      view.rotateAt(e.clientX, e.clientY, d * 0.003);
    } else {
      view.panBy(-e.deltaX, -e.deltaY);
    }
  };

  private onPointerMoveImpl = (e: PointerEvent): void => {
    const eng = this.engine;
    if (e.pointerType === 'touch' && this.touchPts.has(e.pointerId)) {
      this.touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (this.panDrag && this.panDrag.id === e.pointerId) {
      eng.view.panBy(
        e.clientX - this.panDrag.lastX,
        e.clientY - this.panDrag.lastY,
      );
      this.panDrag.lastX = e.clientX;
      this.panDrag.lastY = e.clientY;
      return;
    }
    if (
      this.gesture &&
      (e.pointerId === this.gesture.id1 || e.pointerId === this.gesture.id2)
    ) {
      this.updateGesture();
      return;
    }
    if (this.loupe && e.pointerId === this.loupe.pointerId) {
      const p = this.toPoint(e);
      this.loupe.x = Math.max(0, Math.min(eng.artboard.w - 1, p.x));
      this.loupe.y = Math.max(0, Math.min(eng.artboard.h - 1, p.y));
      this.loupe.color = eng.getPixel(
        this.loupe.x,
        this.loupe.y,
        this.loupe.source,
      );
      eng.requestOverlayRender();
      return;
    }
    if (this.activePointer !== e.pointerId) return;
    if (this.layerPickPointer === e.pointerId) return;
    const pending = this.pendingPress;
    if (pending && pending.pointerId === e.pointerId) {
      pending.latest = this.toPoint(e);
      const moved = Math.hypot(
        e.clientX - pending.startClientX,
        e.clientY - pending.startClientY,
      );
      if (moved <= EYEDROPPER_MOVE_TOLERANCE_PX) return;
      clearTimeout(pending.timer);
      this.pendingPress = null;
      if (!this.beginEditableShape(pending.start, e))
        eng.activeTool().onDown(pending.start, e);
    }
    if (eng.hasShapeEdit()) {
      this.queueMove(e, (event) => {
        if (this.activePointer === event.pointerId && eng.hasShapeEdit())
          eng.updateShapeEdit(this.toPoint(event), event);
      });
      return;
    }
    const tool = eng.activeTool();
    if (tool.latestMoveOnly) {
      this.queueMove(e, (event) => {
        if (this.activePointer === event.pointerId && eng.activeTool() === tool)
          tool.onMove(this.toPoint(event), event);
      });
      return;
    }
    const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const events = coalesced.length > 0 ? coalesced : [e];
    for (const ev of events) tool.onMove(this.toPoint(ev), ev);
  };

  private onPointerUpImpl = (e: PointerEvent): void => {
    const eng = this.engine;
    this.touchPts.delete(e.pointerId);
    if (this.panDrag && this.panDrag.id === e.pointerId) {
      this.panDrag = null;
      return;
    }
    if (
      this.gesture &&
      (e.pointerId === this.gesture.id1 || e.pointerId === this.gesture.id2)
    ) {
      this.gesture = null;
      return;
    }
    if (this.loupe && e.pointerId === this.loupe.pointerId) {
      const { color, restorePreviousTool } = this.loupe;
      this.loupe = null;
      if (this.activePointer === e.pointerId) this.activePointer = null;
      eng.requestOverlayRender();
      eng.applyPickedColor(color, restorePreviousTool);
      return;
    }
    if (this.activePointer !== e.pointerId) return;
    this.flushMove();
    this.activePointer = null;
    if (this.layerPickPointer === e.pointerId) {
      this.layerPickPointer = null;
      eng.cursor.onUp(this.toPoint(e), e);
      return;
    }
    if (eng.hasShapeEdit()) {
      eng.finishShapeEdit(this.toPoint(e));
      return;
    }
    const pending = this.pendingPress;
    if (pending && pending.pointerId === e.pointerId) {
      clearTimeout(pending.timer);
      this.pendingPress = null;
      const tool = eng.activeTool();
      if (this.beginEditableShape(pending.start, e))
        eng.finishShapeEdit(this.toPoint(e));
      else {
        tool.onDown(pending.start, e);
        tool.onUp(this.toPoint(e), e);
      }
      return;
    }
    eng.activeTool().onUp(this.toPoint(e), e);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.activePointer === e.pointerId) this.clearMove();
    const eng = this.engine;
    this.touchPts.delete(e.pointerId);
    if (this.panDrag && this.panDrag.id === e.pointerId) {
      this.panDrag = null;
      return;
    }
    if (
      this.gesture &&
      (e.pointerId === this.gesture.id1 || e.pointerId === this.gesture.id2)
    ) {
      this.gesture = null;
      return;
    }
    if (this.loupe && e.pointerId === this.loupe.pointerId) {
      this.loupe = null;
      if (this.activePointer === e.pointerId) this.activePointer = null;
      eng.requestOverlayRender();
      return;
    }
    if (this.activePointer !== e.pointerId) return;
    this.activePointer = null;
    if (this.layerPickPointer === e.pointerId) {
      this.layerPickPointer = null;
      eng.cursor.cancel?.();
      return;
    }
    if (this.pendingPress?.pointerId === e.pointerId) {
      this.clearPendingPress();
      return;
    }
    if (eng.hasShapeEdit()) {
      eng.cancelShapeEdit();
      return;
    }
    eng.activeTool().cancel?.();
    eng.requestRender();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const eng = this.engine;
    if (
      e.target instanceof Element &&
      e.target.closest(
        'input, textarea, [contenteditable="true"], [data-text-controls]',
      )
    )
      return;
    const command = shortcutIdForEvent(e, useStore.getState().shortcuts);
    if (command === 'history.undo') {
      e.preventDefault();
      void eng.undo();
    } else if (
      command === 'history.redo' ||
      command === 'history.redoAlternate'
    ) {
      e.preventDefault();
      void eng.redo();
    } else if (command === 'layers.copy') {
      e.preventDefault();
      void eng.copyLayers();
    } else if (command === 'layers.paste') {
      e.preventDefault();
      void eng.pasteLayers();
    } else if (command === 'view.reset') {
      e.preventDefault();
      eng.view.reset();
    } else if (command === 'selection.rename') {
      e.preventDefault();
      eng.events.emit('shortcutCommand', { command: 'rename-selection' });
    } else if (command === 'selection.delete') {
      e.preventDefault();
      eng.events.emit('shortcutCommand', { command: 'delete-selection' });
    } else if (command === 'view.pan') {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.panShortcutCode = e.code;
        if (this.area) this.area.style.cursor = 'grab';
      }
      if (e.target === document.body) e.preventDefault();
    } else if (command === 'operation.cancel') {
      this.cancelEyedropper();
      eng.cancelFloatSelection();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.spaceDown && e.code === this.panShortcutCode) {
      this.spaceDown = false;
      this.panShortcutCode = null;
      if (this.area) this.area.style.cursor = '';
    }
  };

  clearPendingPress(): void {
    if (!this.pendingPress) return;
    clearTimeout(this.pendingPress.timer);
    this.pendingPress = null;
  }

  beginEyedropper(
    point: StrokePoint,
    pointerId: number,
    source: EyedropperSource,
    restorePreviousTool: boolean,
  ): void {
    this.loupe = {
      x: point.x,
      y: point.y,
      pointerId,
      source,
      restorePreviousTool,
      color: this.getPixel(point.x, point.y, source),
    };
    this.engine.requestOverlayRender();
  }

  cancelEyedropper(): void {
    if (!this.loupe) return;
    this.loupe = null;
    this.engine.requestOverlayRender();
  }

  getPixel(
    x: number,
    y: number,
    source: EyedropperSource = 'active-layer',
  ): string {
    const eng = this.engine;
    const layerId = source === 'active-layer' ? eng.getActiveLayerId() : null;
    if (layerId !== null && !eng.layerById(layerId)) return TRANSPARENT;
    const d = eng.compositor.samplePixel(x, y, layerId);
    if (d[3] < 128) return TRANSPARENT;
    const hex = (v: number) => v.toString(16).padStart(2, '0');
    return `#${hex(d[0])}${hex(d[1])}${hex(d[2])}`;
  }

  drawLoupeIfAny(ctx: CanvasRenderingContext2D): void {
    if (this.loupe) this.drawLoupe(ctx);
  }

  private drawLoupe(ctx: CanvasRenderingContext2D): void {
    const eng = this.engine;
    const lp = this.loupe!;
    const s = eng.uiScale();
    const R = 56 * s;
    const zoom = 7;
    let cx = lp.x;
    let cy = lp.y - 96 * s;
    if (cy - R - 14 * s < 0) cy = lp.y + 96 * s;
    cx = Math.max(R + 10 * s, Math.min(eng.artboard.w - R - 10 * s, cx));
    eng.ensureComposited();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.imageSmoothingEnabled = false;
    const srcR = R / zoom;
    ctx.drawImage(
      eng.compositor.main!,
      lp.x - srcR,
      lp.y - srcR,
      srcR * 2,
      srcR * 2,
      cx - R,
      cy - R,
      R * 2,
      R * 2,
    );
    ctx.restore();

    const ch = 7 * s;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    ctx.moveTo(cx - ch, cy);
    ctx.lineTo(cx + ch, cy);
    ctx.moveTo(cx, cy - ch);
    ctx.lineTo(cx, cy + ch);
    ctx.stroke();

    ctx.lineWidth = 9 * s;
    ctx.strokeStyle = lp.color === TRANSPARENT ? checkerPattern(ctx) : lp.color;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 5 * s, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.5 * s;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(cx, cy, R + 9.5 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R + 0.5 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(lp.x, lp.y, 3 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  private guardPointer(
    handler: (event: PointerEvent) => void,
  ): (event: PointerEvent) => void {
    return (event) => {
      try {
        handler(event);
      } catch (error) {
        this.clearMove();
        if (this.engine.hasShapeEdit()) this.engine.cancelShapeEdit();
        this.activePointer = null;
        this.clearPendingPress();
        this.engine.activeTool().cancel?.();
        useStore.getState().set({
          toolNotice:
            error instanceof Error ? error.message : '描画処理に失敗しました',
        });
        this.engine.requestRender();
      }
    };
  }
  private onPointerDown = this.guardPointer(this.onPointerDownImpl);
  private onPointerMove = this.guardPointer(this.onPointerMoveImpl);
  private onPointerUp = this.guardPointer(this.onPointerUpImpl);
}
