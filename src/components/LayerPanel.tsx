import { useEffect, useRef } from 'react';
import { engine } from '../engine/PaintEngine';
import { useStore } from '../state/store';
import {
  BLEND_OPTIONS,
  type AdjustParams,
  type BlendMode,
  type LayerMeta,
} from '../types';

function Thumb({ id, version }: { id: string; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    const src = engine.getLayerCanvas(id);
    if (src) ctx.drawImage(src, 0, 0, c.width, c.height);
  }, [id, version]);
  return <canvas ref={ref} width={40} height={30} className="thumb" />;
}

interface CommitSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onPreview: (v: number) => void;
  onCommit: (before: number, after: number) => void;
}

/** ドラッグ中はプレビュー、離したときに1つの履歴として確定するスライダー */
function CommitSlider({ value, min, max, step = 1, onPreview, onCommit }: CommitSliderProps) {
  const before = useRef<number | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const finish = () => {
    if (before.current !== null && before.current !== latest.current) {
      onCommit(before.current, latest.current);
    }
    before.current = null;
  };
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => {
        if (before.current === null) before.current = latest.current;
        onPreview(Number(e.target.value));
      }}
      onPointerUp={finish}
      onBlur={finish}
    />
  );
}

const ADJUST_SLIDERS: {
  key: keyof AdjustParams;
  label: string;
  min: number;
  max: number;
}[] = [
  { key: 'brightness', label: '明度', min: 0, max: 200 },
  { key: 'contrast', label: 'コントラスト', min: 0, max: 200 },
  { key: 'hue', label: '色相', min: -180, max: 180 },
  { key: 'saturation', label: '彩度', min: 0, max: 200 },
];

function AdjustControls({ meta }: { meta: LayerMeta }) {
  const params = meta.params!;
  return (
    <>
      {ADJUST_SLIDERS.map((p) => (
        <label className="ctl-row" key={p.key}>
          <span>{p.label}</span>
          <CommitSlider
            value={params[p.key]}
            min={p.min}
            max={p.max}
            onPreview={(v) =>
              engine.previewLayerProps(meta.id, { params: { ...params, [p.key]: v } })
            }
            onCommit={(b, a) =>
              engine.commitLayerProps(
                meta.id,
                { params: { ...params, [p.key]: b } },
                { params: { ...params, [p.key]: a } },
                '色調補正',
              )
            }
          />
          <span className="num">{params[p.key]}</span>
        </label>
      ))}
    </>
  );
}

function LayerControls({ meta }: { meta: LayerMeta }) {
  const pct = Math.round(meta.opacity * 100);
  return (
    <div className="layer-controls">
      <label className="ctl-row">
        <span>不透明度</span>
        <CommitSlider
          value={pct}
          min={0}
          max={100}
          onPreview={(v) => engine.previewLayerProps(meta.id, { opacity: v / 100 })}
          onCommit={(b, a) =>
            engine.commitLayerProps(
              meta.id,
              { opacity: b / 100 },
              { opacity: a / 100 },
              '不透明度',
            )
          }
        />
        <span className="num">{pct}</span>
      </label>
      {meta.type === 'raster' ? (
        <label className="ctl-row">
          <span>合成</span>
          <select
            value={meta.blend}
            onChange={(e) =>
              engine.commitLayerProps(
                meta.id,
                { blend: meta.blend },
                { blend: e.target.value as BlendMode },
                '合成モード',
              )
            }
          >
            {BLEND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <AdjustControls meta={meta} />
      )}
    </div>
  );
}

function LayerRow({ meta, active }: { meta: LayerMeta; active: boolean }) {
  return (
    <div
      className={`layer-row${active ? ' active' : ''}${meta.visible ? '' : ' hidden-layer'}`}
      onClick={() => engine.setActiveLayer(meta.id)}
    >
      <button
        className="eye"
        title={meta.visible ? '非表示にする' : '表示する'}
        onClick={(e) => {
          e.stopPropagation();
          engine.commitLayerProps(
            meta.id,
            { visible: meta.visible },
            { visible: !meta.visible },
            '表示切替',
          );
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
          <circle cx="12" cy="12" r="2.6" />
          {!meta.visible && <path d="M4 20L20 4" />}
        </svg>
      </button>
      {meta.type === 'raster' ? (
        <Thumb id={meta.id} version={meta.version} />
      ) : (
        <div className="adjust-badge">補正</div>
      )}
      <span className="layer-name">{meta.name}</span>
      <span className="layer-move">
        <button
          title="上へ"
          onClick={(e) => {
            e.stopPropagation();
            engine.moveLayer(meta.id, 1);
          }}
        >
          ▲
        </button>
        <button
          title="下へ"
          onClick={(e) => {
            e.stopPropagation();
            engine.moveLayer(meta.id, -1);
          }}
        >
          ▼
        </button>
      </span>
    </div>
  );
}

export function LayerPanel() {
  const layers = useStore((s) => s.layers);
  const activeId = useStore((s) => s.activeLayerId);
  const active = layers.find((l) => l.id === activeId);
  const activeIndex = layers.findIndex((l) => l.id === activeId);
  const canMergeDown =
    active?.type === 'raster' &&
    activeIndex > 0 &&
    layers[activeIndex - 1]?.type === 'raster';
  const canMergeVisible = layers.filter((l) => l.visible).length > 1;
  const reversed = [...layers].reverse();
  return (
    <div className="section layers-section">
      <div className="section-title-row">
        <div className="section-title">レイヤー</div>
        <div className="layer-add-buttons">
          <button onClick={() => engine.addRasterLayer()} title="レイヤーを追加">
            ＋
          </button>
          <button onClick={() => engine.addAdjustLayer()} title="色調補正レイヤーを追加">
            補正
          </button>
          <button
            onClick={() => active && engine.removeLayer(active.id)}
            disabled={!active}
            title="選択中のレイヤーを削除"
          >
            削除
          </button>
        </div>
      </div>
      <div className="layer-list">
        {reversed.map((l) => (
          <LayerRow key={l.id} meta={l} active={l.id === activeId} />
        ))}
      </div>
      <div className="layer-merge-buttons">
        <button
          onClick={() => engine.mergeLayerDown()}
          disabled={!canMergeDown}
          title="選択中のラスターレイヤーを直下のラスターレイヤーへ統合"
        >
          下と統合
        </button>
        <button
          onClick={() => engine.mergeVisibleLayers()}
          disabled={!canMergeVisible}
          title="見えているレイヤーを表示どおりに1枚へ統合"
        >
          表示を統合
        </button>
      </div>
      {active && <LayerControls meta={active} />}
    </div>
  );
}
