import { Compositor } from './compositor'
import {
  HistoryTree,
  applyBlobToRegion,
  canvasRegionToBlob,
  type HistoryPatch,
  type StructureSnapshot,
} from './history/tree'
import {
  createAdjustmentLayer,
  createRasterLayer,
  layerToMeta,
} from './layer'
import type {
  AdjustmentLayer,
  BlendMode,
  Layer,
  LayerMeta,
  RasterLayer,
  Rect,
} from './types'
import { createId } from './types'

export type DocumentListener = () => void

export class PaintDocument {
  width: number
  height: number
  layers: Layer[] = []
  activeLayerId: string | null = null
  compositor: Compositor
  history: HistoryTree
  private listeners = new Set<DocumentListener>()
  private raf = 0

  constructor(width = 1280, height = 720) {
    this.width = width
    this.height = height
    this.compositor = new Compositor(width, height)
    this.history = new HistoryTree((patch, dir) => this.applyHistoryPatch(patch, dir))
    const bg = createRasterLayer(width, height, '背景', true)
    const layer = createRasterLayer(width, height, 'レイヤー 1')
    this.layers = [bg, layer]
    this.activeLayerId = layer.id
  }

  subscribe(fn: DocumentListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  notify(): void {
    for (const fn of this.listeners) fn()
  }

  requestComposite(): void {
    this.compositor.markDirty()
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.compositor.composite(this.layers)
      this.notify()
    })
  }

  compositeNow(): HTMLCanvasElement {
    return this.compositor.composite(this.layers, true)
  }

  getActiveRaster(): RasterLayer | null {
    const layer = this.layers.find((l) => l.id === this.activeLayerId)
    if (!layer || layer.type !== 'raster') return null
    return layer
  }

  getLayer(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id)
  }

  setActiveLayer(id: string): void {
    if (this.layers.some((l) => l.id === id)) {
      this.activeLayerId = id
      this.notify()
    }
  }

  layerMetas(): LayerMeta[] {
    return this.layers.map(layerToMeta)
  }

  async captureRasterPatch(
    layerId: string,
    bounds: Rect,
    mutate: () => void | Promise<void>,
    label: string,
  ): Promise<void> {
    const layer = this.getLayer(layerId)
    if (!layer || layer.type !== 'raster') {
      await mutate()
      this.requestComposite()
      return
    }
    const padded = padBounds(bounds, 2, this.width, this.height)
    const beforeBlob = await canvasRegionToBlob(layer.canvas, padded)
    await mutate()
    const afterBlob = await canvasRegionToBlob(layer.canvas, padded)
    await this.history.push(
      {
        kind: 'raster-patch',
        layerId,
        bounds: padded,
        beforeBlob,
        afterBlob,
      },
      label,
    )
    this.requestComposite()
  }

  async withStructureChange(label: string, mutate: () => void | Promise<void>): Promise<void> {
    const before = await this.snapshotStructure()
    await mutate()
    const after = await this.snapshotStructure()
    const patch: StructureSnapshot = {
      kind: 'structure',
      beforeMetaJson: before.metaJson,
      afterMetaJson: after.metaJson,
      beforePixels: before.pixels,
      afterPixels: after.pixels,
    }
    await this.history.push(patch, label)
    this.requestComposite()
  }

  private async snapshotStructure(): Promise<{
    metaJson: string
    pixels: Record<string, Blob>
  }> {
    const metas = this.layerMetas()
    const pixels: Record<string, Blob> = {}
    for (const layer of this.layers) {
      if (layer.type === 'raster') {
        const blob = await new Promise<Blob | null>((resolve) =>
          layer.canvas.toBlob((b) => resolve(b), 'image/webp', 0.9),
        )
        if (blob) pixels[layer.id] = blob
      }
    }
    return {
      metaJson: JSON.stringify({
        metas,
        activeLayerId: this.activeLayerId,
        width: this.width,
        height: this.height,
      }),
      pixels,
    }
  }

  private async applyHistoryPatch(patch: HistoryPatch, direction: 'undo' | 'redo'): Promise<void> {
    if (patch.kind === 'raster-patch') {
      const layer = this.getLayer(patch.layerId)
      if (!layer || layer.type !== 'raster') return
      const blob = direction === 'undo' ? patch.beforeBlob : patch.afterBlob
      await applyBlobToRegion(layer.canvas, layer.ctx, patch.bounds, blob)
      this.requestComposite()
      return
    }

    const metaJson = direction === 'undo' ? patch.beforeMetaJson : patch.afterMetaJson
    const pixels = direction === 'undo' ? patch.beforePixels : patch.afterPixels
    await this.restoreStructure(metaJson, pixels)
    this.requestComposite()
  }

  async restoreStructure(metaJson: string, pixels: Record<string, Blob>): Promise<void> {
    const data = JSON.parse(metaJson) as {
      metas: LayerMeta[]
      activeLayerId: string | null
      width: number
      height: number
    }
    this.width = data.width
    this.height = data.height
    this.compositor.resize(data.width, data.height)

    const newLayers: Layer[] = []
    for (const meta of data.metas) {
      if (meta.type === 'adjustment') {
        const adj = createAdjustmentLayer(meta.name, {
          brightness: meta.brightness ?? 0,
          contrast: meta.contrast ?? 0,
          saturation: meta.saturation ?? 0,
          hue: meta.hue ?? 0,
        })
        adj.id = meta.id
        adj.visible = meta.visible
        adj.opacity = meta.opacity
        adj.blendMode = meta.blendMode
        newLayers.push(adj)
      } else {
        const raster = createRasterLayer(data.width, data.height, meta.name)
        raster.id = meta.id
        raster.visible = meta.visible
        raster.opacity = meta.opacity
        raster.blendMode = meta.blendMode
        const blob = pixels[meta.id]
        if (blob && blob.size > 0) {
          const bmp = await createImageBitmap(blob)
          raster.ctx.drawImage(bmp, 0, 0)
          bmp.close()
        }
        newLayers.push(raster)
      }
    }
    this.layers = newLayers
    this.activeLayerId = data.activeLayerId
  }

  addRasterLayer(name?: string): void {
    void this.withStructureChange('レイヤー追加', () => {
      const n = this.layers.filter((l) => l.type === 'raster').length
      const layer = createRasterLayer(this.width, this.height, name ?? `レイヤー ${n}`)
      this.layers.push(layer)
      this.activeLayerId = layer.id
    })
  }

  addAdjustmentLayer(): void {
    void this.withStructureChange('色補正レイヤー追加', () => {
      const layer = createAdjustmentLayer('色補正')
      this.layers.push(layer)
      this.activeLayerId = layer.id
    })
  }

  deleteLayer(id: string): void {
    if (this.layers.length <= 1) return
    void this.withStructureChange('レイヤー削除', () => {
      const idx = this.layers.findIndex((l) => l.id === id)
      if (idx < 0) return
      this.layers.splice(idx, 1)
      if (this.activeLayerId === id) {
        this.activeLayerId = this.layers[Math.max(0, idx - 1)]?.id ?? null
      }
    })
  }

  reorderLayer(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= this.layers.length || toIndex >= this.layers.length)
      return
    void this.withStructureChange('レイヤー並べ替え', () => {
      const [item] = this.layers.splice(fromIndex, 1)
      this.layers.splice(toIndex, 0, item)
    })
  }

  setLayerOpacity(id: string, opacity: number): void {
    const layer = this.getLayer(id)
    if (!layer) return
    layer.opacity = Math.max(0, Math.min(1, opacity))
    this.requestComposite()
  }

  setLayerBlendMode(id: string, mode: BlendMode): void {
    const layer = this.getLayer(id)
    if (!layer) return
    layer.blendMode = mode
    this.requestComposite()
  }

  setLayerVisibility(id: string, visible: boolean): void {
    const layer = this.getLayer(id)
    if (!layer) return
    layer.visible = visible
    this.requestComposite()
  }

  updateAdjustment(
    id: string,
    params: Partial<Pick<AdjustmentLayer, 'brightness' | 'contrast' | 'saturation' | 'hue'>>,
  ): void {
    const layer = this.getLayer(id)
    if (!layer || layer.type !== 'adjustment') return
    Object.assign(layer, params)
    this.requestComposite()
  }

  async undo(): Promise<boolean> {
    const ok = await this.history.undo()
    this.notify()
    return ok
  }

  async redo(): Promise<boolean> {
    const ok = await this.history.redo()
    this.notify()
    return ok
  }

  async exportPng(): Promise<Blob> {
    const canvas = this.compositor.renderOpaque(this.layers)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    )
    if (!blob) throw new Error('PNG export failed')
    return blob
  }

  duplicateId(): string {
    return createId('layer')
  }
}

function padBounds(bounds: Rect, pad: number, width: number, height: number): Rect {
  const x = Math.max(0, Math.floor(bounds.x - pad))
  const y = Math.max(0, Math.floor(bounds.y - pad))
  const r = Math.min(width, Math.ceil(bounds.x + bounds.w + pad))
  const b = Math.min(height, Math.ceil(bounds.y + bounds.h + pad))
  return { x, y, w: Math.max(0, r - x), h: Math.max(0, b - y) }
}
