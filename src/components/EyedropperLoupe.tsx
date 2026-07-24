import type { PaintApp } from '../engine/paintApp'
import type { EyedropperState } from '../state/store'

interface Props {
  state: EyedropperState
  app: PaintApp
}

const LOUPE = 96
const ZOOM = 8

export function EyedropperLoupe({ state, app }: Props) {
  const canvasRef = (el: HTMLCanvasElement | null) => {
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    const src = app.doc.compositor.renderOpaque(app.doc.layers)
    const size = LOUPE / ZOOM
    const sx = state.x - size / 2
    const sy = state.y - size / 2
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, LOUPE, LOUPE)
    ctx.drawImage(src, sx, sy, size, size, 0, 0, LOUPE, LOUPE)

    // Crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(LOUPE / 2, 0)
    ctx.lineTo(LOUPE / 2, LOUPE)
    ctx.moveTo(0, LOUPE / 2)
    ctx.lineTo(LOUPE, LOUPE / 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.strokeRect(LOUPE / 2 - ZOOM / 2, LOUPE / 2 - ZOOM / 2, ZOOM, ZOOM)
  }

  const left = Math.min(window.innerWidth - LOUPE - 16, Math.max(8, state.screenX + 24))
  const top = Math.min(window.innerHeight - LOUPE - 48, Math.max(8, state.screenY - LOUPE - 24))

  return (
    <div className="eyedropper-loupe" style={{ left, top }}>
      <canvas ref={canvasRef} width={LOUPE} height={LOUPE} />
      <div className="eyedropper-swatch" style={{ background: state.color }} />
      <span className="eyedropper-hex">{state.color}</span>
    </div>
  )
}
