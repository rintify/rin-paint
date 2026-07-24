import { canvasRegionToBlob } from '../history/tree'
import { unionBounds, type Point } from '../types'
import type { Tool, ToolHost, ToolPointerEvent } from './types'

function stamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number,
  erase: boolean,
): void {
  ctx.save()
  if (erase) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = `rgba(0,0,0,${alpha})`
  } else {
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = color
    ctx.globalAlpha = alpha
  }
  ctx.beginPath()
  ctx.arc(x, y, size / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function interpolateStroke(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  size: number,
  color: string,
  erase: boolean,
): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy)
  const p0 = from.pressure ?? 0.5
  const p1 = to.pressure ?? 0.5
  const spacing = Math.max(size * 0.15, 1)
  const steps = Math.max(1, Math.ceil(dist / spacing))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = from.x + dx * t
    const y = from.y + dy * t
    const pressure = p0 + (p1 - p0) * t
    const s = size * (0.15 + 0.85 * pressure)
    const alpha = erase ? 0.35 + 0.65 * pressure : 0.25 + 0.75 * pressure
    stamp(ctx, x, y, s, color, alpha, erase)
  }
}

function makeBrushTool(id: 'brush' | 'eraser', erase: boolean): Tool {
  let drawing = false
  let last: Point | null = null
  let points: Point[] = []
  let layerId: string | null = null
  let beforeCanvas: HTMLCanvasElement | null = null

  return {
    id,
    cursor: erase ? 'cell' : 'crosshair',
    onPointerDown(e: ToolPointerEvent, host: ToolHost) {
      const layer = host.document.getActiveRaster()
      if (!layer) return
      drawing = true
      layerId = layer.id
      points = []
      last = { x: e.x, y: e.y, pressure: e.pressure || 0.5 }

      // Snapshot full layer region we'll need — capture before via clone of dirty area later
      beforeCanvas = document.createElement('canvas')
      beforeCanvas.width = layer.canvas.width
      beforeCanvas.height = layer.canvas.height
      beforeCanvas.getContext('2d')!.drawImage(layer.canvas, 0, 0)

      const pressure = e.pressure || 0.5
      const size = host.brushSize * (0.15 + 0.85 * pressure)
      const alpha = erase ? 0.35 + 0.65 * pressure : 0.25 + 0.75 * pressure
      stamp(layer.ctx, e.x, e.y, size, host.color, alpha, erase)
      points.push(last)
      host.document.requestComposite()
    },
    onPointerMove(e: ToolPointerEvent, host: ToolHost) {
      if (!drawing || !layerId) return
      const layer = host.document.getLayer(layerId)
      if (!layer || layer.type !== 'raster') return

      const coalesced =
        e.coalesced && e.coalesced.length > 0
          ? e.coalesced
          : [{ x: e.x, y: e.y, pressure: e.pressure || 0.5 }]

      for (const p of coalesced) {
        const pt: Point = { x: p.x, y: p.y, pressure: p.pressure ?? e.pressure ?? 0.5 }
        if (last) {
          interpolateStroke(layer.ctx, last, pt, host.brushSize, host.color, erase)
        }
        last = pt
        points.push(pt)
      }
      host.document.requestComposite()
    },
    async onPointerUp(_e: ToolPointerEvent, host: ToolHost) {
      if (!drawing || !layerId || !beforeCanvas) {
        drawing = false
        return
      }
      drawing = false
      const layer = host.document.getLayer(layerId)
      if (!layer || layer.type !== 'raster') return

      const pad = host.brushSize + 4
      const bounds = unionBounds(points, pad, host.document.width, host.document.height)
      if (bounds.w <= 0 || bounds.h <= 0) {
        last = null
        points = []
        beforeCanvas = null
        layerId = null
        return
      }

      const before = beforeCanvas
      const lid = layerId
      last = null
      points = []
      beforeCanvas = null
      layerId = null

      const beforeBlob = await canvasRegionToBlob(before, bounds)
      const afterBlob = await canvasRegionToBlob(layer.canvas, bounds)
      await host.document.history.push(
        {
          kind: 'raster-patch',
          layerId: lid,
          bounds,
          beforeBlob,
          afterBlob,
        },
        erase ? '消しゴム' : 'ブラシ',
      )
      host.document.requestComposite()
      host.onActionCommitted(erase ? 'eraser' : 'brush')
    },
    onCancel(host: ToolHost) {
      if (drawing && layerId && beforeCanvas) {
        const layer = host.document.getLayer(layerId)
        if (layer && layer.type === 'raster') {
          layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
          layer.ctx.drawImage(beforeCanvas, 0, 0)
          host.document.requestComposite()
        }
      }
      drawing = false
      last = null
      points = []
      beforeCanvas = null
      layerId = null
    },
  }
}

export const brushTool = makeBrushTool('brush', false)
export const eraserTool = makeBrushTool('eraser', true)
