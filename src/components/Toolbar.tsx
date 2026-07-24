import type { PaintApp } from '../engine/paintApp'
import type { ToolId } from '../engine/types'
import { useAppStore } from '../state/store'
import { LayerPanel } from './LayerPanel'

interface Props {
  app: PaintApp
}

const TOOLS: { id: ToolId; label: string; icon: string }[] = [
  { id: 'brush', label: 'ペン', icon: '✎' },
  { id: 'eraser', label: '消す', icon: '⌫' },
  { id: 'line', label: '直線', icon: '/' },
  { id: 'rect', label: '矩形', icon: '▭' },
  { id: 'ellipse', label: '楕円', icon: '◯' },
  { id: 'lasso', label: '選択', icon: '⟐' },
]

export function Toolbar({ app }: Props) {
  const tool = useAppStore((s) => s.tool)
  const color = useAppStore((s) => s.color)
  const brushSize = useAppStore((s) => s.brushSize)
  const colorHistory = useAppStore((s) => s.colorHistory)
  const canUndo = useAppStore((s) => s.canUndo)
  const canRedo = useAppStore((s) => s.canRedo)
  const selection = useAppStore((s) => s.selection)
  const timelapseFrames = useAppStore((s) => s.timelapseFrames)
  const setTool = useAppStore((s) => s.setTool)
  const setColor = useAppStore((s) => s.setColor)
  const setBrushSize = useAppStore((s) => s.setBrushSize)
  const pushColorHistory = useAppStore((s) => s.pushColorHistory)

  return (
    <aside className="toolbar">
      <div className="brand">rin-paint</div>

      <section className="tool-grid">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tool-btn ${tool === t.id ? 'active' : ''}`}
            title={t.label}
            onClick={() => setTool(t.id)}
          >
            <span className="tool-icon">{t.icon}</span>
            <span className="tool-label">{t.label}</span>
          </button>
        ))}
      </section>

      <section className="section">
        <label className="section-title">ペンサイズ {brushSize}px</label>
        <input
          type="range"
          min={1}
          max={100}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
        />
        <div className="brush-preview">
          <span
            style={{
              width: Math.min(48, brushSize),
              height: Math.min(48, brushSize),
              background: color,
              borderRadius: '50%',
              display: 'inline-block',
            }}
          />
        </div>
      </section>

      <section className="section">
        <label className="section-title">色</label>
        <div className="color-row">
          <input
            type="color"
            value={color.length === 7 ? color : '#000000'}
            onChange={(e) => {
              setColor(e.target.value)
              pushColorHistory(e.target.value)
            }}
          />
          <input
            type="text"
            className="hex-input"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            onBlur={() => {
              if (/^#[0-9a-fA-F]{6}$/.test(color)) pushColorHistory(color)
            }}
          />
        </div>
        <div className="swatches">
          {colorHistory.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch ${c === color ? 'active' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </section>

      <section className="section history-btns">
        <button type="button" disabled={!canUndo} onClick={() => void app.undo()}>
          戻る
        </button>
        <button type="button" disabled={!canRedo} onClick={() => void app.redo()}>
          進む
        </button>
      </section>

      {selection && (
        <section className="section selection-btns">
          <button type="button" onClick={() => app.duplicateSelection()}>
            複製
          </button>
          <button type="button" onClick={() => void app.commitSelection()}>
            確定
          </button>
        </section>
      )}

      <LayerPanel app={app} />

      <section className="section export-btns">
        <button type="button" onClick={() => void app.exportPng()}>
          PNG書き出し
        </button>
        <button type="button" onClick={() => void app.exportTimelapse()}>
          タイムラプス ({timelapseFrames})
        </button>
        <button type="button" onClick={() => void app.flushSave()}>
          今すぐ保存
        </button>
      </section>

      <p className="hint">ダブルタップでスポイト</p>
    </aside>
  )
}
