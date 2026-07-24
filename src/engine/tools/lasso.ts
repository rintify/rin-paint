import type { Point } from '../types'
import type { SelectionState, Tool, ToolHost, ToolPointerEvent } from './types'

type Phase = 'idle' | 'drawing' | 'transform'

interface TransformHandle {
  kind: 'move' | 'scale' | 'rotate'
  corner?: 'nw' | 'ne' | 'sw' | 'se'
}

export class LassoTool implements Tool {
  id = 'lasso' as const
  cursor = 'crosshair'

  private phase: Phase = 'idle'
  private path: Point[] = []
  private selection: SelectionState | null = null
  private drag: {
    handle: TransformHandle
    startX: number
    startY: number
    orig: SelectionState
  } | null = null

  onPointerDown(e: ToolPointerEvent, host: ToolHost): void {
    if (this.phase === 'transform' && this.selection) {
      const handle = this.hitTest(e.x, e.y, this.selection)
      if (handle) {
        this.drag = {
          handle,
          startX: e.x,
          startY: e.y,
          orig: cloneSelection(this.selection),
        }
        return
      }
      // Click outside → commit
      void this.commit(host)
      return
    }

    const layer = host.document.getActiveRaster()
    if (!layer) return
    this.phase = 'drawing'
    this.path = [{ x: e.x, y: e.y }]
    this.paintPath(host)
  }

  onPointerMove(e: ToolPointerEvent, host: ToolHost): void {
    if (this.phase === 'drawing') {
      this.path.push({ x: e.x, y: e.y })
      this.paintPath(host)
      return
    }
    if (this.phase === 'transform' && this.drag && this.selection) {
      const dx = e.x - this.drag.startX
      const dy = e.y - this.drag.startY
      const o = this.drag.orig
      if (this.drag.handle.kind === 'move') {
        this.selection.x = o.x + dx
        this.selection.y = o.y + dy
      } else if (this.drag.handle.kind === 'scale') {
        const cx = o.x + o.width / 2
        const cy = o.y + o.height / 2
        const sx = Math.max(0.05, (o.width / 2 + (e.x - cx) * (this.drag.handle.corner?.includes('e') ? 1 : -1)) / (o.width / 2))
        const sy = Math.max(0.05, (o.height / 2 + (e.y - cy) * (this.drag.handle.corner?.includes('s') ? 1 : -1)) / (o.height / 2))
        // Simplified uniform-ish scale from corner
        const factor = Math.max(0.05, Math.hypot(e.x - cx, e.y - cy) / Math.hypot(o.width / 2, o.height / 2))
        this.selection.scaleX = o.scaleX * factor
        this.selection.scaleY = o.scaleY * factor
        this.selection.x = cx - (o.width * this.selection.scaleX) / 2
        this.selection.y = cy - (o.height * this.selection.scaleY) / 2
        void sx
        void sy
      } else if (this.drag.handle.kind === 'rotate') {
        const cx = o.x + (o.width * o.scaleX) / 2
        const cy = o.y + (o.height * o.scaleY) / 2
        const a0 = Math.atan2(this.drag.startY - cy, this.drag.startX - cx)
        const a1 = Math.atan2(e.y - cy, e.x - cx)
        this.selection.rotation = o.rotation + (a1 - a0)
      }
      host.onSelectionChange?.(this.selection)
      this.paintSelection(host)
    }
  }

  onPointerUp(e: ToolPointerEvent, host: ToolHost): void {
    if (this.phase === 'drawing') {
      this.path.push({ x: e.x, y: e.y })
      if (this.path.length < 3) {
        this.phase = 'idle'
        this.path = []
        host.clearOverlay()
        return
      }
      void this.createSelection(host)
      return
    }
    if (this.drag) {
      this.drag = null
    }
  }

  onCancel(host: ToolHost): void {
    if (this.phase === 'transform' && this.selection) {
      void this.commit(host)
    } else {
      this.phase = 'idle'
      this.path = []
      this.selection = null
      this.drag = null
      host.clearOverlay()
      host.onSelectionChange?.(null)
    }
  }

  duplicate(host: ToolHost): void {
    if (!this.selection) return
    const sel = this.selection
    const layer = host.document.getLayer(sel.layerId)
    if (layer && layer.type === 'raster') {
      // Bake a copy at the current transform, then keep floating selection offset
      const w = sel.width * sel.scaleX
      const h = sel.height * sel.scaleY
      const cx = sel.x + w / 2
      const cy = sel.y + h / 2
      const pad = 4
      const extent = Math.hypot(w, h) / 2 + pad
      const bounds = {
        x: Math.max(0, Math.floor(cx - extent)),
        y: Math.max(0, Math.floor(cy - extent)),
        w: 0,
        h: 0,
      }
      bounds.w = Math.min(host.document.width, Math.ceil(cx + extent)) - bounds.x
      bounds.h = Math.min(host.document.height, Math.ceil(cy + extent)) - bounds.y
      void host.document
        .captureRasterPatch(
          layer.id,
          bounds,
          () => {
            const ctx = layer.ctx
            ctx.save()
            ctx.translate(cx, cy)
            ctx.rotate(sel.rotation)
            ctx.scale(sel.scaleX, sel.scaleY)
            ctx.drawImage(sel.canvas, -sel.width / 2, -sel.height / 2)
            ctx.restore()
          },
          '選択複製',
        )
        .then(() => host.onActionCommitted('lasso-duplicate'))
    }
    this.selection = {
      ...sel,
      x: sel.x + 16,
      y: sel.y + 16,
      cut: false,
      path: [...sel.path],
    }
    host.onSelectionChange?.(this.selection)
    this.paintSelection(host)
  }

  async commit(host: ToolHost): Promise<void> {
    if (!this.selection) {
      this.phase = 'idle'
      host.clearOverlay()
      host.onSelectionChange?.(null)
      return
    }
    const sel = this.selection
    const layer = host.document.getLayer(sel.layerId)
    if (!layer || layer.type !== 'raster') {
      this.selection = null
      this.phase = 'idle'
      host.clearOverlay()
      host.onSelectionChange?.(null)
      return
    }

    const pad = 4
    const w = sel.width * sel.scaleX
    const h = sel.height * sel.scaleY
    const cx = sel.x + w / 2
    const cy = sel.y + h / 2
    const extent = Math.hypot(w, h) / 2 + pad
    const bounds = {
      x: Math.max(0, Math.floor(cx - extent)),
      y: Math.max(0, Math.floor(cy - extent)),
      w: Math.min(host.document.width, Math.ceil(cx + extent)) - Math.max(0, Math.floor(cx - extent)),
      h: Math.min(host.document.height, Math.ceil(cy + extent)) - Math.max(0, Math.floor(cy - extent)),
    }

    // Also include original cut region
    const ox = Math.min(...sel.path.map((p) => p.x))
    const oy = Math.min(...sel.path.map((p) => p.y))
    const orx = Math.max(...sel.path.map((p) => p.x))
    const ory = Math.max(...sel.path.map((p) => p.y))
    const union = {
      x: Math.max(0, Math.floor(Math.min(bounds.x, ox) - pad)),
      y: Math.max(0, Math.floor(Math.min(bounds.y, oy) - pad)),
      w: 0,
      h: 0,
    }
    const r = Math.min(host.document.width, Math.ceil(Math.max(bounds.x + bounds.w, orx) + pad))
    const b = Math.min(host.document.height, Math.ceil(Math.max(bounds.y + bounds.h, ory) + pad))
    union.w = r - union.x
    union.h = b - union.y

    await host.document.captureRasterPatch(
      layer.id,
      union,
      () => {
        // If cut already applied during createSelection, just stamp floating pixels
        // If not cut (duplicate), just stamp
        const ctx = layer.ctx
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(sel.rotation)
        ctx.scale(sel.scaleX, sel.scaleY)
        ctx.drawImage(sel.canvas, -sel.width / 2, -sel.height / 2)
        ctx.restore()
      },
      '選択移動',
    )

    this.selection = null
    this.phase = 'idle'
    this.path = []
    host.clearOverlay()
    host.onSelectionChange?.(null)
    host.onActionCommitted('lasso')
  }

  paintOverlay(host: ToolHost): void {
    if (this.phase === 'drawing') this.paintPath(host)
    else if (this.phase === 'transform' && this.selection) this.paintSelection(host)
  }

  private async createSelection(host: ToolHost): Promise<void> {
    const layer = host.document.getActiveRaster()
    if (!layer) return

    const xs = this.path.map((p) => p.x)
    const ys = this.path.map((p) => p.y)
    const minX = Math.floor(Math.min(...xs))
    const minY = Math.floor(Math.min(...ys))
    const maxX = Math.ceil(Math.max(...xs))
    const maxY = Math.ceil(Math.max(...ys))
    const w = Math.max(1, maxX - minX)
    const h = Math.max(1, maxY - minY)

    const mask = document.createElement('canvas')
    mask.width = w
    mask.height = h
    const mctx = mask.getContext('2d')!
    mctx.beginPath()
    this.path.forEach((p, i) => {
      const lx = p.x - minX
      const ly = p.y - minY
      if (i === 0) mctx.moveTo(lx, ly)
      else mctx.lineTo(lx, ly)
    })
    mctx.closePath()
    mctx.fillStyle = '#fff'
    mctx.fill()

    const extracted = document.createElement('canvas')
    extracted.width = w
    extracted.height = h
    const ectx = extracted.getContext('2d')!
    ectx.drawImage(layer.canvas, minX, minY, w, h, 0, 0, w, h)
    ectx.globalCompositeOperation = 'destination-in'
    ectx.drawImage(mask, 0, 0)

    // Cut from layer (with history)
    const bounds = {
      x: Math.max(0, minX),
      y: Math.max(0, minY),
      w: Math.min(host.document.width - minX, w),
      h: Math.min(host.document.height - minY, h),
    }

    await host.document.captureRasterPatch(
      layer.id,
      bounds,
      () => {
        layer.ctx.save()
        layer.ctx.beginPath()
        this.path.forEach((p, i) => {
          if (i === 0) layer.ctx.moveTo(p.x, p.y)
          else layer.ctx.lineTo(p.x, p.y)
        })
        layer.ctx.closePath()
        layer.ctx.clip()
        layer.ctx.clearRect(minX, minY, w, h)
        layer.ctx.restore()
      },
      '選択切り出し',
    )
    host.onActionCommitted('lasso-cut')

    this.selection = {
      layerId: layer.id,
      canvas: extracted,
      path: [...this.path],
      x: minX,
      y: minY,
      width: w,
      height: h,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      cut: true,
    }
    this.phase = 'transform'
    this.path = []
    host.onSelectionChange?.(this.selection)
    this.paintSelection(host)
  }

  private paintPath(host: ToolHost): void {
    host.clearOverlay()
    const ctx = host.getOverlayCtx()
    if (!ctx || this.path.length < 1) return
    ctx.save()
    ctx.strokeStyle = '#4af'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    this.path.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.stroke()
    ctx.restore()
  }

  private paintSelection(host: ToolHost): void {
    host.clearOverlay()
    const ctx = host.getOverlayCtx()
    const sel = this.selection
    if (!ctx || !sel) return

    const w = sel.width * sel.scaleX
    const h = sel.height * sel.scaleY
    const cx = sel.x + w / 2
    const cy = sel.y + h / 2

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(sel.rotation)
    ctx.drawImage(sel.canvas, -w / 2, -h / 2, w, h)

    // Bounding box
    ctx.strokeStyle = '#4af'
    ctx.lineWidth = 1
    ctx.setLineDash([5, 4])
    ctx.strokeRect(-w / 2, -h / 2, w, h)
    ctx.setLineDash([])

    // Corner handles
    const corners = [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [-w / 2, h / 2],
      [w / 2, h / 2],
    ]
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#4af'
    for (const [hx, hy] of corners) {
      ctx.fillRect(hx - 4, hy - 4, 8, 8)
      ctx.strokeRect(hx - 4, hy - 4, 8, 8)
    }
    // Rotate handle
    ctx.beginPath()
    ctx.moveTo(0, -h / 2)
    ctx.lineTo(0, -h / 2 - 20)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, -h / 2 - 20, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  private hitTest(x: number, y: number, sel: SelectionState): TransformHandle | null {
    const w = sel.width * sel.scaleX
    const h = sel.height * sel.scaleY
    const cx = sel.x + w / 2
    const cy = sel.y + h / 2

    // Inverse transform point
    const dx = x - cx
    const dy = y - cy
    const cos = Math.cos(-sel.rotation)
    const sin = Math.sin(-sel.rotation)
    const lx = dx * cos - dy * sin
    const ly = dx * sin + dy * cos

    const rotateY = -h / 2 - 20
    if (Math.hypot(lx - 0, ly - rotateY) < 12) return { kind: 'rotate' }

    const corners: Array<{ c: 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number }> = [
      { c: 'nw', x: -w / 2, y: -h / 2 },
      { c: 'ne', x: w / 2, y: -h / 2 },
      { c: 'sw', x: -w / 2, y: h / 2 },
      { c: 'se', x: w / 2, y: h / 2 },
    ]
    for (const corner of corners) {
      if (Math.hypot(lx - corner.x, ly - corner.y) < 12) {
        return { kind: 'scale', corner: corner.c }
      }
    }

    if (lx >= -w / 2 && lx <= w / 2 && ly >= -h / 2 && ly <= h / 2) {
      return { kind: 'move' }
    }
    return null
  }
}

function cloneSelection(s: SelectionState): SelectionState {
  return { ...s, path: [...s.path] }
}

export const lassoTool = new LassoTool()
