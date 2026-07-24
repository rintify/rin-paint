import { useEffect, useRef } from 'react'
import type { PaintApp } from '../engine/paintApp'
import { useAppStore } from '../state/store'
import { EyedropperLoupe } from './EyedropperLoupe'

interface Props {
  app: PaintApp
}

export function CanvasViewport({ app }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const displayRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const eyedropper = useAppStore((s) => s.eyedropper)
  const tool = useAppStore((s) => s.tool)

  useEffect(() => {
    const display = displayRef.current
    const overlay = overlayRef.current
    const wrap = wrapRef.current
    if (!display || !overlay || !wrap) return

    app.attachCanvases(display, overlay)

    const fit = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      const scale = Math.min(w / app.doc.width, h / app.doc.height) * 0.98
      const offsetX = (w - app.doc.width * scale) / 2
      const offsetY = (h - app.doc.height * scale) / 2
      app.setViewTransform(scale, offsetX, offsetY)
      display.style.width = `${app.doc.width * scale}px`
      display.style.height = `${app.doc.height * scale}px`
      overlay.style.width = display.style.width
      overlay.style.height = display.style.height
      display.style.transform = `translate(${offsetX}px, ${offsetY}px)`
      overlay.style.transform = display.style.transform
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [app])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const getRect = () => {
      // Use wrap rect; transform is applied on canvases inside
      return wrap.getBoundingClientRect()
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      wrap.setPointerCapture(e.pointerId)
      app.handlePointerDown(e, getRect())
    }
    const onMove = (e: PointerEvent) => {
      app.handlePointerMove(e, getRect())
    }
    const onUp = (e: PointerEvent) => {
      app.handlePointerUp(e, getRect())
      try {
        wrap.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }

    wrap.addEventListener('pointerdown', onDown)
    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerup', onUp)
    wrap.addEventListener('pointercancel', onUp)
    return () => {
      wrap.removeEventListener('pointerdown', onDown)
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerup', onUp)
      wrap.removeEventListener('pointercancel', onUp)
    }
  }, [app])

  return (
    <div className="viewport" ref={wrapRef} data-tool={tool}>
      <canvas ref={displayRef} className="viewport-canvas" />
      <canvas ref={overlayRef} className="viewport-overlay" />
      {eyedropper?.active && <EyedropperLoupe state={eyedropper} app={app} />}
    </div>
  )
}
