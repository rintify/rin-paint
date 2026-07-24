import type { PaintDocument } from '../document'
import type { Point, Rect, ToolId } from '../types'

export interface ToolPointerEvent {
  x: number
  y: number
  pressure: number
  buttons: number
  pointerType: string
  coalesced?: Point[]
  shiftKey?: boolean
  altKey?: boolean
}

export interface ToolHost {
  document: PaintDocument
  color: string
  brushSize: number
  getOverlayCtx: () => CanvasRenderingContext2D | null
  clearOverlay: () => void
  requestRedraw: () => void
  onCommitRaster: (layerId: string, bounds: Rect, label: string, before: () => void) => Promise<void>
  /** Called after a drawing action is committed (for timelapse). */
  onActionCommitted: (label: string) => void
  setCursor: (cursor: string) => void
  /** Floating selection UI callbacks */
  onSelectionChange?: (sel: SelectionState | null) => void
}

export interface SelectionState {
  layerId: string
  /** Image of selected pixels */
  canvas: HTMLCanvasElement
  /** Path in document coords (original lasso) */
  path: Point[]
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scaleX: number
  scaleY: number
  /** Whether original was cut (true) or copied */
  cut: boolean
}

export interface Tool {
  id: ToolId
  cursor?: string
  onPointerDown(e: ToolPointerEvent, host: ToolHost): void
  onPointerMove(e: ToolPointerEvent, host: ToolHost): void
  onPointerUp(e: ToolPointerEvent, host: ToolHost): void
  onCancel?(host: ToolHost): void
  /** Optional: draw persistent overlay each frame */
  paintOverlay?(host: ToolHost): void
}
