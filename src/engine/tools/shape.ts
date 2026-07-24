import type { Point, Rect, ToolId } from '../types'
import type { Tool, ToolHost, ToolPointerEvent } from './types'

function shapeBounds(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  kind: 'line' | 'rect' | 'ellipse',
  start: Point,
  end: Point,
  color: string,
  lineWidth: number,
  shiftKey: boolean,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()

  if (kind === 'line') {
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
  } else if (kind === 'rect') {
    let { x, y, w, h } = shapeBounds(start, end)
    if (shiftKey) {
      const s = Math.max(w, h)
      w = s
      h = s
      if (end.x < start.x) x = start.x - s
      if (end.y < start.y) y = start.y - s
    }
    ctx.strokeRect(x, y, w, h)
  } else {
    let { x, y, w, h } = shapeBounds(start, end)
    if (shiftKey) {
      const s = Math.max(w, h)
      w = s
      h = s
      if (end.x < start.x) x = start.x - s
      if (end.y < start.y) y = start.y - s
    }
    const cx = x + w / 2
    const cy = y + h / 2
    ctx.ellipse(cx, cy, Math.max(w / 2, 0.5), Math.max(h / 2, 0.5), 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

function makeShapeTool(id: ToolId & ('line' | 'rect' | 'ellipse')): Tool {
  let drawing = false
  let start: Point | null = null
  let end: Point | null = null
  let shift = false

  return {
    id,
    cursor: 'crosshair',
    onPointerDown(e: ToolPointerEvent, host: ToolHost) {
      if (!host.document.getActiveRaster()) return
      drawing = true
      start = { x: e.x, y: e.y }
      end = { ...start }
      shift = !!e.shiftKey
      host.clearOverlay()
      const octx = host.getOverlayCtx()
      if (octx && start && end) {
        drawShape(octx, id, start, end, host.color, host.brushSize, shift)
      }
    },
    onPointerMove(e: ToolPointerEvent, host: ToolHost) {
      if (!drawing || !start) return
      end = { x: e.x, y: e.y }
      shift = !!e.shiftKey
      host.clearOverlay()
      const octx = host.getOverlayCtx()
      if (octx) drawShape(octx, id, start, end, host.color, host.brushSize, shift)
    },
    async onPointerUp(e: ToolPointerEvent, host: ToolHost) {
      if (!drawing || !start) return
      drawing = false
      end = { x: e.x, y: e.y }
      shift = !!e.shiftKey
      host.clearOverlay()

      const layer = host.document.getActiveRaster()
      if (!layer || !end) {
        start = null
        end = null
        return
      }

      const pad = host.brushSize + 4
      let bounds: Rect
      if (id === 'line') {
        bounds = {
          x: Math.min(start.x, end.x) - pad,
          y: Math.min(start.y, end.y) - pad,
          w: Math.abs(end.x - start.x) + pad * 2,
          h: Math.abs(end.y - start.y) + pad * 2,
        }
      } else {
        const b = shapeBounds(start, end)
        if (shift) {
          const s = Math.max(b.w, b.h)
          b.w = s
          b.h = s
        }
        bounds = {
          x: b.x - pad,
          y: b.y - pad,
          w: b.w + pad * 2,
          h: b.h + pad * 2,
        }
      }
      bounds.x = Math.max(0, Math.floor(bounds.x))
      bounds.y = Math.max(0, Math.floor(bounds.y))
      bounds.w = Math.min(host.document.width - bounds.x, Math.ceil(bounds.w))
      bounds.h = Math.min(host.document.height - bounds.y, Math.ceil(bounds.h))

      const s = start
      const en = end
      const sh = shift
      start = null
      end = null

      await host.document.captureRasterPatch(
        layer.id,
        bounds,
        () => {
          drawShape(layer.ctx, id, s, en, host.color, host.brushSize, sh)
        },
        id === 'line' ? '直線' : id === 'rect' ? '矩形' : '楕円',
      )
      host.onActionCommitted(id)
    },
    onCancel(host: ToolHost) {
      drawing = false
      start = null
      end = null
      host.clearOverlay()
    },
  }
}

export const lineTool = makeShapeTool('line')
export const rectTool = makeShapeTool('rect')
export const ellipseTool = makeShapeTool('ellipse')
