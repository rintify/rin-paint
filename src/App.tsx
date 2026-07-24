import { useEffect, useMemo, useState } from 'react'
import { PaintApp } from './engine/paintApp'
import { CanvasViewport } from './components/CanvasViewport'
import { Toolbar } from './components/Toolbar'
import { useAppStore } from './state/store'
import './app.css'

function App() {
  const app = useMemo(() => new PaintApp(1280, 720), [])
  const [booting, setBooting] = useState(true)
  const setLayers = useAppStore((s) => s.setLayers)
  const setHistoryFlags = useAppStore((s) => s.setHistoryFlags)
  const setEyedropper = useAppStore((s) => s.setEyedropper)
  const setSelection = useAppStore((s) => s.setSelection)
  const setTimelapse = useAppStore((s) => s.setTimelapse)
  const setReady = useAppStore((s) => s.setReady)
  const hydrateUi = useAppStore((s) => s.hydrateUi)
  const setColor = useAppStore((s) => s.setColor)
  const pushColorHistory = useAppStore((s) => s.pushColorHistory)
  const ready = useAppStore((s) => s.ready)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await app.init(
        () => {
          const s = useAppStore.getState()
          return {
            color: s.color,
            brushSize: s.brushSize,
            colorHistory: s.colorHistory,
            tool: s.tool,
          }
        },
        () => {
          setLayers(app.doc.layerMetas(), app.doc.activeLayerId)
          setHistoryFlags(app.doc.history.canUndo, app.doc.history.canRedo)
          setTimelapse(app.timelapse.isRecording, app.timelapse.frames)
        },
        {
          onSelection: setSelection,
          onEyedropper: setEyedropper,
          commitColor: (c: string) => {
            setColor(c, true)
            pushColorHistory(c)
          },
        },
      )
      if (cancelled) return
      if (loaded) hydrateUi(loaded)
      setLayers(app.doc.layerMetas(), app.doc.activeLayerId)
      setReady(true)
      setBooting(false)
    })()

    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void app.undo()
      } else if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        void app.redo()
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKey)
      app.dispose()
    }
  }, [
    app,
    hydrateUi,
    pushColorHistory,
    setColor,
    setEyedropper,
    setHistoryFlags,
    setLayers,
    setReady,
    setSelection,
    setTimelapse,
  ])

  if (booting || !ready) {
    return (
      <div className="boot">
        <p>rin-paint を読み込み中…</p>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Toolbar app={app} />
      <main className="main-stage">
        <CanvasViewport app={app} />
      </main>
    </div>
  )
}

export default App
