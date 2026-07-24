import {
  type AdjustmentLayer,
  type AdjustmentParams,
  type BlendMode,
  type Layer,
  type LayerMeta,
  type RasterLayer,
  createId,
} from './types'

export function createRasterLayer(
  width: number,
  height: number,
  name: string,
  fillWhite = false,
): RasterLayer {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (fillWhite) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  return {
    id: createId('layer'),
    type: 'raster',
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    canvas,
    ctx,
  }
}

export function createAdjustmentLayer(name: string, params?: Partial<AdjustmentParams>): AdjustmentLayer {
  return {
    id: createId('adj'),
    type: 'adjustment',
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    brightness: params?.brightness ?? 0,
    contrast: params?.contrast ?? 0,
    saturation: params?.saturation ?? 0,
    hue: params?.hue ?? 0,
  }
}

export function layerToMeta(layer: Layer): LayerMeta {
  if (layer.type === 'raster') {
    return {
      id: layer.id,
      type: 'raster',
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
    }
  }
  return {
    id: layer.id,
    type: 'adjustment',
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    brightness: layer.brightness,
    contrast: layer.contrast,
    saturation: layer.saturation,
    hue: layer.hue,
  }
}

export function cloneRasterContent(
  source: RasterLayer,
  width: number,
  height: number,
  name: string,
): RasterLayer {
  const layer = createRasterLayer(width, height, name)
  layer.opacity = source.opacity
  layer.blendMode = source.blendMode
  layer.visible = source.visible
  layer.ctx.drawImage(source.canvas, 0, 0)
  return layer
}

export function setBlendMode(layer: Layer, mode: BlendMode): void {
  layer.blendMode = mode
}

export function adjustmentFilterCss(layer: AdjustmentLayer): string {
  const brightness = 1 + layer.brightness / 100
  const contrast = 1 + layer.contrast / 100
  const satur = 1 + layer.saturation / 100
  const hue = layer.hue
  return `brightness(${brightness}) contrast(${contrast}) saturate(${satur}) hue-rotate(${hue}deg)`
}
