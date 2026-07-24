export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion';

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  'source-over': '通常',
  multiply: '乗算',
  screen: 'スクリーン',
  overlay: 'オーバーレイ',
  darken: '比較(暗)',
  lighten: '比較(明)',
  'color-dodge': '覆い焼き',
  'color-burn': '焼き込み',
  'hard-light': 'ハードライト',
  'soft-light': 'ソフトライト',
  difference: '差の絶対値',
  exclusion: '除外',
}

export type ToolId =
  | 'brush'
  | 'eraser'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'lasso'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
  pressure?: number
}

export interface AdjustmentParams {
  brightness: number
  contrast: number
  saturation: number
  hue: number
}

export interface LayerBase {
  id: string
  name: string
  visible: boolean
  opacity: number
  blendMode: BlendMode
}

export interface RasterLayer extends LayerBase {
  type: 'raster'
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
}

export interface AdjustmentLayer extends LayerBase, AdjustmentParams {
  type: 'adjustment'
}

export type Layer = RasterLayer | AdjustmentLayer

export interface LayerMeta {
  id: string
  type: 'raster' | 'adjustment'
  name: string
  visible: boolean
  opacity: number
  blendMode: BlendMode
  brightness?: number
  contrast?: number
  saturation?: number
  hue?: number
}

export function createId(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function expandRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const r = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  return { x, y, w: r - x, h: bottom - y }
}

export function unionBounds(points: Point[], padding: number, width: number, height: number): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const x = Math.floor(clamp(minX - padding, 0, width))
  const y = Math.floor(clamp(minY - padding, 0, height))
  const r = Math.ceil(clamp(maxX + padding, 0, width))
  const b = Math.ceil(clamp(maxY + padding, 0, height))
  return { x, y, w: Math.max(0, r - x), h: Math.max(0, b - y) }
}

export function rgbaToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'))
      .join('')
  )
}

export function hexToRgba(hex: string, alpha = 1): string {
  const h = hex.replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const n = parseInt(full, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}
