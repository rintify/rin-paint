import { adjustmentFilterCss } from './layer'
import type { Layer } from './types'

export class Compositor {
  width: number
  height: number
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  private bufA: HTMLCanvasElement
  private bufB: HTMLCanvasElement
  private dirty = true

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D context unavailable')
    this.ctx = ctx

    this.bufA = document.createElement('canvas')
    this.bufB = document.createElement('canvas')
    this.bufA.width = width
    this.bufB.width = width
    this.bufA.height = height
    this.bufB.height = height
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    for (const c of [this.canvas, this.bufA, this.bufB]) {
      c.width = width
      c.height = height
    }
    this.markDirty()
  }

  markDirty(): void {
    this.dirty = true
  }

  composite(layers: Layer[], force = false): HTMLCanvasElement {
    if (!this.dirty && !force) return this.canvas
    this.dirty = false

    const { ctx, width, height } = this
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.filter = 'none'
    ctx.clearRect(0, 0, width, height)
    this.drawCheckerboard(ctx, width, height)

    let src = this.bufA
    let dst = this.bufB
    const sctx = src.getContext('2d')!
    sctx.setTransform(1, 0, 0, 1, 0, 0)
    sctx.globalAlpha = 1
    sctx.globalCompositeOperation = 'source-over'
    sctx.filter = 'none'
    sctx.clearRect(0, 0, width, height)

    for (const layer of layers) {
      if (!layer.visible) continue
      const dctx = dst.getContext('2d')!
      dctx.setTransform(1, 0, 0, 1, 0, 0)
      dctx.globalAlpha = 1
      dctx.globalCompositeOperation = 'source-over'
      dctx.filter = 'none'
      dctx.clearRect(0, 0, width, height)

      if (layer.type === 'adjustment') {
        dctx.filter = adjustmentFilterCss(layer)
        dctx.globalAlpha = layer.opacity
        dctx.drawImage(src, 0, 0)
        dctx.filter = 'none'
        dctx.globalAlpha = 1
      } else {
        dctx.drawImage(src, 0, 0)
        dctx.globalAlpha = layer.opacity
        dctx.globalCompositeOperation = layer.blendMode
        dctx.drawImage(layer.canvas, 0, 0)
        dctx.globalAlpha = 1
        dctx.globalCompositeOperation = 'source-over'
      }

      const tmp = src
      src = dst
      dst = tmp
    }

    ctx.drawImage(src, 0, 0)
    ctx.restore()
    return this.canvas
  }

  /** Flat opaque RGB snapshot for export / timelapse (white background). */
  renderOpaque(layers: Layer[]): HTMLCanvasElement {
    const out = document.createElement('canvas')
    out.width = this.width
    out.height = this.height
    const octx = out.getContext('2d')!
    octx.fillStyle = '#ffffff'
    octx.fillRect(0, 0, this.width, this.height)

    let src = this.bufA
    let dst = this.bufB
    const sctx = src.getContext('2d')!
    sctx.setTransform(1, 0, 0, 1, 0, 0)
    sctx.globalAlpha = 1
    sctx.globalCompositeOperation = 'source-over'
    sctx.filter = 'none'
    sctx.fillStyle = '#ffffff'
    sctx.fillRect(0, 0, this.width, this.height)

    for (const layer of layers) {
      if (!layer.visible) continue
      const dctx = dst.getContext('2d')!
      dctx.setTransform(1, 0, 0, 1, 0, 0)
      dctx.globalAlpha = 1
      dctx.globalCompositeOperation = 'source-over'
      dctx.filter = 'none'
      dctx.clearRect(0, 0, this.width, this.height)

      if (layer.type === 'adjustment') {
        dctx.filter = adjustmentFilterCss(layer)
        dctx.globalAlpha = layer.opacity
        dctx.drawImage(src, 0, 0)
        dctx.filter = 'none'
        dctx.globalAlpha = 1
      } else {
        dctx.drawImage(src, 0, 0)
        dctx.globalAlpha = layer.opacity
        dctx.globalCompositeOperation = layer.blendMode
        dctx.drawImage(layer.canvas, 0, 0)
        dctx.globalAlpha = 1
        dctx.globalCompositeOperation = 'source-over'
      }
      const tmp = src
      src = dst
      dst = tmp
    }

    octx.drawImage(src, 0, 0)
    return out
  }

  getPixelOpaque(x: number, y: number, layers: Layer[]): { r: number; g: number; b: number; a: number } {
    const flat = this.renderOpaque(layers)
    const ctx = flat.getContext('2d')!
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) {
      return { r: 255, g: 255, b: 255, a: 255 }
    }
    const data = ctx.getImageData(ix, iy, 1, 1).data
    return { r: data[0], g: data[1], b: data[2], a: data[3] }
  }

  private drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const size = 12
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        const even = ((x / size) | 0) % 2 === ((y / size) | 0) % 2
        ctx.fillStyle = even ? '#2a2a2e' : '#1e1e22'
        ctx.fillRect(x, y, size, size)
      }
    }
  }
}
