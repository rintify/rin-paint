import type { BubbleTailShapeParams, ShapeParams, StrokePoint } from '../../model';
import { drawShape, shapeFromDrag, drawShapeGizmo } from '../../engine/shapes';
import { constrainAxisAlignedAspect } from '../../engine/shapes/snap';
import type { PaintEngine } from '../../engine/PaintEngine';
import { mmToPx } from '../../engine/units';
import type { Tool, ToolSession } from '../types';
import { normalizeSpeechBubbleToolSettings } from './settings';

type Body = Extract<ShapeParams, { kind: 'rect' | 'ellipse' }>;

function center(body: Body) {
  return body.kind === 'rect'
    ? { x: body.x + body.width / 2, y: body.y + body.height / 2 }
    : { x: body.cx, y: body.cy };
}

function rootOnBoundary(body: Body, tip: StrokePoint): { x: number; y: number } | null {
  const c = center(body);
  const dx = tip.x - c.x;
  const dy = tip.y - c.y;
  if (Math.hypot(dx, dy) < .001) return null;
  if (body.kind === 'rect') {
    const halfWidth = body.width / 2;
    const halfHeight = body.height / 2;
    if (Math.abs(dx) <= halfWidth && Math.abs(dy) <= halfHeight) return null;
    const scale = Math.min(Math.abs(dx) > .001 ? halfWidth / Math.abs(dx) : Infinity, Math.abs(dy) > .001 ? halfHeight / Math.abs(dy) : Infinity);
    return { x: c.x + dx * scale, y: c.y + dy * scale };
  }
  const normalized = dx * dx / (body.rx * body.rx) + dy * dy / (body.ry * body.ry);
  if (normalized <= 1) return null;
  const scale = 1 / Math.sqrt(normalized);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

function textFrame(body: Body, padding: number) {
  const raw = body.kind === 'rect'
    ? { x: body.x, y: body.y, w: body.width, h: body.height }
    : { x: body.cx - body.rx / Math.SQRT2, y: body.cy - body.ry / Math.SQRT2, w: body.rx * Math.SQRT2, h: body.ry * Math.SQRT2 };
  const px = Math.min(padding, Math.max(0, (raw.w - 1) / 2), Math.max(0, (raw.h - 1) / 2));
  return { x: raw.x + px, y: raw.y + px, w: Math.max(1, raw.w - px * 2), h: Math.max(1, raw.h - px * 2) };
}

function drawInvalidTailTarget(
  context: CanvasRenderingContext2D,
  body: Body,
  point: StrokePoint,
  scale: number,
): void {
  const bodyCenter = center(body);
  context.save();
  context.strokeStyle = '#e53935';
  context.fillStyle = '#e53935';
  context.lineWidth = 2 * scale;
  context.setLineDash([4 * scale, 3 * scale]);
  context.beginPath();
  context.moveTo(bodyCenter.x, bodyCenter.y);
  context.lineTo(point.x, point.y);
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.arc(point.x, point.y, 7 * scale, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(point.x - 3 * scale, point.y);
  context.lineTo(point.x + 3 * scale, point.y);
  context.moveTo(point.x, point.y - 3 * scale);
  context.lineTo(point.x, point.y + 3 * scale);
  context.stroke();
  const label = '外側に配置';
  context.font = `${Math.max(10, 11 * scale)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'bottom';
  const labelY = point.y - 11 * scale;
  const width = context.measureText(label).width + 10 * scale;
  context.fillStyle = 'rgba(255, 255, 255, .94)';
  context.fillRect(point.x - width / 2, labelY - 15 * scale, width, 15 * scale);
  context.fillStyle = '#e53935';
  context.fillText(label, point.x, labelY - 2 * scale);
  context.restore();
}

export class SpeechBubbleTool implements Tool {
  private start: StrokePoint | null = null;
  private current: StrokePoint | null = null;
  private body: Body | null = null;
  private event: PointerEvent | undefined;

  get startsImmediately() { return true; }
  readonly session: ToolSession = {
    active: () => this.body !== null,
    commit: () => {},
    cancel: () => this.cancel(),
  };

  constructor(private engine: PaintEngine) {}

  private settings() {
    return normalizeSpeechBubbleToolSettings(this.engine.activeToolSettings()?.settings);
  }

  private draggedBody(end: StrokePoint, event?: PointerEvent): Body | null {
    if (!this.start) return null;
    const active = this.engine.activeToolSettings();
    const settings = this.settings();
    const point = event?.shiftKey || settings.constrainAspect
      ? constrainAxisAlignedAspect(this.start, end) : end;
    const shape = shapeFromDrag(settings.bodyKind, this.start, point, active?.color ?? '#ffffff', 0, 'fill-inside');
    return shape?.kind === 'rect' || shape?.kind === 'ellipse' ? shape : null;
  }

  private tail(body: Body, tip: StrokePoint, notify = false): BubbleTailShapeParams | null {
    const boundary = rootOnBoundary(body, tip);
    const minimum = Math.max(3 * this.engine.uiScale(), 1);
    if (!boundary || Math.hypot(tip.x - boundary.x, tip.y - boundary.y) < minimum) {
      if (notify) this.engine.notify('しっぽの先端は吹き出しの外側へ指定してください');
      return null;
    }
    const settings = this.settings();
    const width = mmToPx(settings.tailWidthMm, this.engine.getPageSpec().ppi);
    const outlineWidth = mmToPx(this.engine.activeToolSettings()?.sizeMm ?? 1, this.engine.getPageSpec().ppi);
    const bodyCenter = center(body);
    const inwardX = bodyCenter.x - boundary.x;
    const inwardY = bodyCenter.y - boundary.y;
    const inwardLength = Math.max(.001, Math.hypot(inwardX, inwardY));
    const bodyLimit = body.kind === 'rect'
      ? Math.min(body.width, body.height) * .3
      : Math.min(body.rx, body.ry) * .6;
    // The outline is generated from the body/tail union. Moving the tail root
    // inside the body prevents an internal outline seam at their junction.
    const overlap = Math.min(bodyLimit, Math.max(width * .65, outlineWidth * 1.25 + 2 * this.engine.uiScale()));
    const root = {
      x: boundary.x + inwardX / inwardLength * overlap,
      y: boundary.y + inwardY / inwardLength * overlap,
    };
    return {
      kind: 'bubble-tail',
      style: settings.tailStyle === 'rounds' ? 'rounds' : 'pointed',
      start: root,
      control: { x: (root.x + tip.x) / 2, y: (root.y + tip.y) / 2 },
      tip: { x: tip.x, y: tip.y },
      width,
      circleCount: settings.circleCount,
      spacingDecay: settings.tailSpacingDecay,
      color: this.engine.activeToolSettings()?.color ?? '#ffffff',
      strokeWidth: 0,
      strokeJoin: 'round',
    };
  }

  private finish(body: Body, tail: BubbleTailShapeParams | null): void {
    const settings = this.settings();
    this.body = null;
    this.current = null;
    this.engine.setBubbleDraftActive(false);
    this.engine.addSpeechBubble(body, tail, {
      outlineColor: settings.outlineColor,
      outlineWidthMm: this.engine.activeToolSettings()?.sizeMm ?? 1,
      textColor: settings.textColor,
      fontId: settings.fontId,
      fontSizePt: settings.fontSizePt,
      textFrame: textFrame(body, mmToPx(settings.textPaddingMm, this.engine.getPageSpec().ppi)),
    });
    this.engine.notifyPaletteToolUsed();
  }

  onDown(point: StrokePoint, event: PointerEvent): void {
    if (this.body) {
      this.current = point;
      return;
    }
    this.start = point;
    this.current = point;
    this.event = event;
  }

  onMove(point: StrokePoint, event: PointerEvent): void {
    this.current = point;
    this.event = event;
    this.engine.requestOverlayRender();
  }

  onUp(point: StrokePoint, event: PointerEvent): void {
    if (this.body) {
      const tail = this.tail(this.body, point, true);
      if (tail) this.finish(this.body, tail);
      else this.engine.requestOverlayRender();
      return;
    }
    const body = this.draggedBody(point, event);
    this.start = null;
    this.event = undefined;
    if (!body) return this.cancel();
    if (this.settings().tailStyle === 'none') {
      this.finish(body, null);
      return;
    }
    this.body = body;
    this.current = point;
    this.engine.setBubbleDraftActive(true);
    this.engine.requestOverlayRender();
  }

  cancel(): void {
    this.start = null;
    this.current = null;
    this.body = null;
    this.event = undefined;
    this.engine.setBubbleDraftActive(false);
    this.engine.requestOverlayRender();
  }

  drawOverlay(context: CanvasRenderingContext2D): void {
    const body = this.body ?? (this.current ? this.draggedBody(this.current, this.event) : null);
    if (!body) return;
    const settings = this.settings();
    const tail = this.body && this.current ? this.tail(body, this.current) : null;
    context.save();
    context.globalAlpha = .82;
    drawShape(context, body, false, this.engine.artboard);
    if (tail) drawShape(context, tail, false, this.engine.artboard);
    const width = mmToPx(this.engine.activeToolSettings()?.sizeMm ?? 1, this.engine.getPageSpec().ppi);
    drawShape(context, { ...body, color: settings.outlineColor, paintMode: 'stroke', strokeWidth: width * 2 }, false, this.engine.artboard);
    const scale = this.engine.uiScale();
    drawShapeGizmo(context, body, {
      scale,
      // しっぽ配置中は本体を掴めないので、操作可能に見えるハンドルを出さない。
      handles: !this.body,
    });
    if (tail) drawShapeGizmo(context, tail, { scale, tailPlacement: true });
    else if (this.body && this.current)
      drawInvalidTailTarget(context, body, this.current, scale);
    context.restore();
  }
}
