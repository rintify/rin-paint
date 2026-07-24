import { useRef } from 'react'
import type { PaintApp } from '../engine/paintApp'
import { BLEND_MODE_LABELS, type BlendMode } from '../engine/types'
import { useAppStore } from '../state/store'

interface Props {
  app: PaintApp
}

export function LayerPanel({ app }: Props) {
  const layers = useAppStore((s) => s.layers)
  const activeLayerId = useAppStore((s) => s.activeLayerId)
  const dragIndex = useRef<number | null>(null)

  // Display top-to-bottom (reverse of document order)
  const display = [...layers].map((l, i) => ({ layer: l, index: i })).reverse()

  return (
    <div className="layer-panel">
      <div className="panel-header">
        <span>レイヤー</span>
        <div className="panel-actions">
          <button type="button" title="新規レイヤー" onClick={() => app.doc.addRasterLayer()}>
            ＋
          </button>
          <button type="button" title="色補正レイヤー" onClick={() => app.doc.addAdjustmentLayer()}>
            ◎
          </button>
          <button
            type="button"
            title="削除"
            disabled={layers.length <= 1}
            onClick={() => {
              if (activeLayerId) app.doc.deleteLayer(activeLayerId)
            }}
          >
            −
          </button>
        </div>
      </div>

      <ul className="layer-list">
        {display.map(({ layer, index }) => (
          <li
            key={layer.id}
            className={`layer-item ${layer.id === activeLayerId ? 'active' : ''}`}
            draggable
            onDragStart={() => {
              dragIndex.current = index
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex.current === null) return
              app.doc.reorderLayer(dragIndex.current, index)
              dragIndex.current = null
            }}
            onClick={() => app.doc.setActiveLayer(layer.id)}
          >
            <button
              type="button"
              className={`vis ${layer.visible ? 'on' : ''}`}
              title="表示"
              onClick={(e) => {
                e.stopPropagation()
                app.doc.setLayerVisibility(layer.id, !layer.visible)
              }}
            >
              {layer.visible ? '👁' : '–'}
            </button>
            <div className="layer-meta">
              <div className="layer-name">
                {layer.type === 'adjustment' ? '◐ ' : ''}
                {layer.name}
              </div>
              <select
                value={layer.blendMode}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  app.doc.setLayerBlendMode(layer.id, e.target.value as BlendMode)
                }
              >
                {Object.entries(BLEND_MODE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="opacity-row">
                <span>不透明度</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(layer.opacity * 100)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    app.doc.setLayerOpacity(layer.id, Number(e.target.value) / 100)
                  }
                />
              </label>
              {layer.type === 'adjustment' && layer.id === activeLayerId && (
                <AdjustmentControls
                  brightness={layer.brightness ?? 0}
                  contrast={layer.contrast ?? 0}
                  saturation={layer.saturation ?? 0}
                  hue={layer.hue ?? 0}
                  onChange={(params) => app.doc.updateAdjustment(layer.id, params)}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AdjustmentControls({
  brightness,
  contrast,
  saturation,
  hue,
  onChange,
}: {
  brightness: number
  contrast: number
  saturation: number
  hue: number
  onChange: (p: {
    brightness?: number
    contrast?: number
    saturation?: number
    hue?: number
  }) => void
}) {
  return (
    <div className="adj-controls" onClick={(e) => e.stopPropagation()}>
      <label>
        明るさ
        <input
          type="range"
          min={-100}
          max={100}
          value={brightness}
          onChange={(e) => onChange({ brightness: Number(e.target.value) })}
        />
      </label>
      <label>
        コントラスト
        <input
          type="range"
          min={-100}
          max={100}
          value={contrast}
          onChange={(e) => onChange({ contrast: Number(e.target.value) })}
        />
      </label>
      <label>
        彩度
        <input
          type="range"
          min={-100}
          max={100}
          value={saturation}
          onChange={(e) => onChange({ saturation: Number(e.target.value) })}
        />
      </label>
      <label>
        色相
        <input
          type="range"
          min={-180}
          max={180}
          value={hue}
          onChange={(e) => onChange({ hue: Number(e.target.value) })}
        />
      </label>
    </div>
  )
}
