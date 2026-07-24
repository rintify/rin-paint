import { PaintDocument } from './document'
import { createAutosave, loadProject, type PersistUiState } from './persistence/db'
import { TimelapseRecorder } from './timelapse/recorder'
import { lassoTool, tools, type SelectionState, type ToolHost, type ToolPointerEvent } from './tools'
import type { Rect, ToolId } from './types'
import { rgbaToHex } from './types'

export type SyncCallback = () => void

export class PaintApp {
  doc: PaintDocument
  timelapse: TimelapseRecorder
  private autosave: ReturnType<typeof createAutosave> | null = null
  private overlay: HTMLCanvasElement | null = null
  private display: HTMLCanvasElement | null = null
  private getUi: (() => PersistUiState & { tool: ToolId }) | null = null
  private onSync: SyncCallback | null = null
  private onSelection: ((s: SelectionState | null) => void) | null = null
  private onEyedropper:
    | ((s: {
        active: boolean
        x: number
        y: number
        color: string
        screenX: number
        screenY: number
      } | null) => void)
    | null = null

  private drawing = false
  private lastTapUp = 0
  private lastTapPos: { x: number; y: number } | null = null
  private eyedropping = false
  private pendingStart: { event: ToolPointerEvent; clientX: number; clientY: number } | null =
    null
  private scale = 1
  private offsetX = 0
  private offsetY = 0
  private commitColor: ((c: string) => void) | null = null
  private static readonly TAP_SLOP = 6

  constructor(width = 1280, height = 720) {
    this.doc = new PaintDocument(width, height)
    this.timelapse = new TimelapseRecorder(this.doc, width, height)
  }

  async init(
    getUi: () => PersistUiState & { tool: ToolId },
    onSync: SyncCallback,
    handlers: {
      onSelection: (s: SelectionState | null) => void
      onEyedropper: (
        s: {
          active: boolean
          x: number
          y: number
          color: string
          screenX: number
          screenY: number
        } | null,
      ) => void
      commitColor: (c: string) => void
    },
  ): Promise<PersistUiState | null> {
    this.getUi = getUi
    this.onSync = onSync
    this.onSelection = handlers.onSelection
    this.onEyedropper = handlers.onEyedropper
    this.commitColor = handlers.commitColor

    const loaded = await loadProject(this.doc)
    this.autosave = createAutosave(this.doc, () => {
      const ui = getUi()
      return { color: ui.color, brushSize: ui.brushSize, colorHistory: ui.colorHistory }
    })

    this.doc.subscribe(() => this.sync())
    this.doc.compositeNow()
    this.sync()

    if (this.timelapse.isSupported) {
      await this.timelapse.start()
    }
    return loaded
  }

  attachCanvases(display: HTMLCanvasElement, overlay: HTMLCanvasElement): void {
    this.display = display
    this.overlay = overlay
    display.width = this.doc.width
    display.height = this.doc.height
    overlay.width = this.doc.width
    overlay.height = this.doc.height
    this.blit()
  }

  setViewTransform(scale: number, offsetX: number, offsetY: number): void {
    this.scale = scale
    this.offsetX = offsetX
    this.offsetY = offsetY
  }

  clientToDoc(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
    const x = (clientX - rect.left - this.offsetX) / this.scale
    const y = (clientY - rect.top - this.offsetY) / this.scale
    return { x, y }
  }

  private sync(): void {
    this.blit()
    this.onSync?.()
  }

  private blit(): void {
    if (!this.display) return
    const composed = this.doc.compositor.composite(this.doc.layers)
    const ctx = this.display.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, this.display.width, this.display.height)
    ctx.drawImage(composed, 0, 0)
  }

  private makeHost(): ToolHost {
    const ui = this.getUi!()
    return {
      document: this.doc,
      color: ui.color,
      brushSize: ui.brushSize,
      getOverlayCtx: () => this.overlay?.getContext('2d') ?? null,
      clearOverlay: () => {
        const ctx = this.overlay?.getContext('2d')
        if (!ctx || !this.overlay) return
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
      },
      requestRedraw: () => this.blit(),
      onCommitRaster: async (layerId, bounds, label, mutate) => {
        await this.doc.captureRasterPatch(layerId, bounds, mutate, label)
      },
      onActionCommitted: (label) => {
        this.timelapse.onActionCommitted(label)
        this.sync()
      },
      setCursor: () => {},
      onSelectionChange: (sel) => this.onSelection?.(sel),
    }
  }

  private toToolEvent(e: PointerEvent, rect: DOMRect): ToolPointerEvent {
    const { x, y } = this.clientToDoc(e.clientX, e.clientY, rect)
    const coalesced = e.getCoalescedEvents?.().map((ce) => {
      const p = this.clientToDoc(ce.clientX, ce.clientY, rect)
      return { x: p.x, y: p.y, pressure: ce.pressure || 0.5 }
    })
    return {
      x,
      y,
      pressure: e.pressure > 0 ? e.pressure : 0.5,
      buttons: e.buttons,
      pointerType: e.pointerType,
      coalesced,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    }
  }

  handlePointerDown(e: PointerEvent, rect: DOMRect): void {
    const now = Date.now()
    const te = this.toToolEvent(e, rect)
    const isDoubleTap =
      now - this.lastTapUp < 320 &&
      !!this.lastTapPos &&
      Math.hypot(te.x - this.lastTapPos.x, te.y - this.lastTapPos.y) < 24

    if (isDoubleTap) {
      this.pendingStart = null
      this.drawing = false
      this.eyedropping = true
      this.lastTapUp = 0
      this.lastTapPos = null
      this.sampleEyedropper(e, rect)
      e.preventDefault()
      return
    }

    if (this.eyedropping) return

    // Stylus: start immediately. Touch/mouse: defer so double-tap can become eyedropper.
    if (e.pointerType === 'pen') {
      const ui = this.getUi!()
      this.drawing = true
      this.pendingStart = null
      tools[ui.tool].onPointerDown(te, this.makeHost())
      return
    }

    this.pendingStart = { event: te, clientX: e.clientX, clientY: e.clientY }
    this.drawing = false
  }

  handlePointerMove(e: PointerEvent, rect: DOMRect): void {
    if (this.eyedropping) {
      this.sampleEyedropper(e, rect)
      return
    }

    const te = this.toToolEvent(e, rect)

    if (this.pendingStart && !this.drawing) {
      const dist = Math.hypot(te.x - this.pendingStart.event.x, te.y - this.pendingStart.event.y)
      if (dist >= PaintApp.TAP_SLOP) {
        const ui = this.getUi!()
        const tool = tools[ui.tool]
        this.drawing = true
        tool.onPointerDown(this.pendingStart.event, this.makeHost())
        this.pendingStart = null
        tool.onPointerMove(te, this.makeHost())
      }
      return
    }

    if (!this.drawing) return
    const ui = this.getUi!()
    tools[ui.tool].onPointerMove(te, this.makeHost())
  }

  handlePointerUp(e: PointerEvent, rect: DOMRect): void {
    if (this.eyedropping) {
      this.sampleEyedropper(e, rect, true)
      this.eyedropping = false
      this.onEyedropper?.(null)
      return
    }

    const te = this.toToolEvent(e, rect)

    if (this.pendingStart && !this.drawing) {
      // Pure tap — record for double-tap eyedropper, do not paint
      this.lastTapUp = Date.now()
      this.lastTapPos = { x: this.pendingStart.event.x, y: this.pendingStart.event.y }
      this.pendingStart = null
      return
    }

    if (!this.drawing) return
    this.drawing = false
    this.pendingStart = null
    const ui = this.getUi!()
    tools[ui.tool].onPointerUp(te, this.makeHost())
    this.lastTapUp = 0
    this.lastTapPos = null
  }

  private sampleEyedropper(e: PointerEvent, rect: DOMRect, commit = false): void {
    const { x, y } = this.clientToDoc(e.clientX, e.clientY, rect)
    const px = this.doc.compositor.getPixelOpaque(x, y, this.doc.layers)
    const color = rgbaToHex(px.r, px.g, px.b)
    this.onEyedropper?.({
      active: true,
      x,
      y,
      color,
      screenX: e.clientX,
      screenY: e.clientY,
    })
    if (commit) {
      this.commitColor?.(color)
    }
  }

  async undo(): Promise<void> {
    await this.doc.undo()
    // do NOT capture timelapse frame
    this.sync()
  }

  async redo(): Promise<void> {
    await this.doc.redo()
    this.sync()
  }

  duplicateSelection(): void {
    lassoTool.duplicate(this.makeHost())
  }

  async commitSelection(): Promise<void> {
    await lassoTool.commit(this.makeHost())
  }

  async exportPng(): Promise<void> {
    const blob = await this.doc.exportPng()
    downloadBlob(blob, `rin-paint-${Date.now()}.png`)
  }

  async exportTimelapse(): Promise<void> {
    const blob = await this.timelapse.exportCurrent()
    if (!blob) {
      alert('タイムラプスを書き出せませんでした（WebCodecs未対応の可能性があります）')
      return
    }
    downloadBlob(blob, `rin-paint-timelapse-${Date.now()}.webm`)
  }

  async flushSave(): Promise<void> {
    await this.autosave?.flush()
  }

  dispose(): void {
    this.autosave?.dispose()
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export type { Rect }
