import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { engine } from '../engine/PaintEngine';
import { drawShape } from '../engine/shapes';
import { useStore } from '../state/store';
import { ART_H, ART_W, BLEND_OPTIONS, TRANSPARENT, type AdjustParams, type BlendMode, type LayerMeta, type ShapeParams } from '../types';

function Thumb({ meta }: { meta: LayerMeta }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    const src = engine.getLayerCanvas(meta.id);
    if (src) ctx.drawImage(src, 0, 0, c.width, c.height);
    else if (meta.shape) {
      ctx.save();
      ctx.scale(c.width / ART_W, c.height / ART_H);
      drawShape(ctx, meta.shape, false);
      ctx.restore();
    }
  }, [meta.id, meta.version, meta.shape]);
  return <canvas ref={ref} width={40} height={30} className="thumb" />;
}

function CommitSlider({ value, min, max, onPreview, onCommit }: { value: number; min: number; max: number; onPreview: (v: number) => void; onCommit: (before: number, after: number) => void }) {
  const before = useRef<number | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const finish = () => {
    if (before.current !== null && before.current !== latest.current) onCommit(before.current, latest.current);
    before.current = null;
  };
  return <input type="range" min={min} max={max} value={value} onChange={(e) => { if (before.current === null) before.current = latest.current; onPreview(Number(e.target.value)); }} onPointerUp={finish} onBlur={finish} />;
}

const ADJUST_SLIDERS: { key: keyof AdjustParams; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: '明度', min: 0, max: 200 },
  { key: 'contrast', label: 'コントラスト', min: 0, max: 200 },
  { key: 'hue', label: '色相', min: -180, max: 180 },
  { key: 'saturation', label: '彩度', min: 0, max: 200 },
];

function ShapeNumber({ label, value, make, meta }: { label: string; value: number; make: (value: number, shape: ShapeParams) => ShapeParams; meta: LayerMeta }) {
  const before = useRef<ShapeParams | null>(null);
  return <label className="shape-number"><span>{label}</span><input type="number" step="0.1" value={Math.round(value * 10) / 10} onFocus={() => { before.current = engine.getShape(meta.id); }} onChange={(e) => {
    const shape = engine.getShape(meta.id);
    if (!shape) return;
    if (!before.current) before.current = shape;
    engine.updateShapeParams(meta.id, before.current, make(Number(e.target.value), shape), true);
  }} onBlur={() => {
    const shape = engine.getShape(meta.id);
    if (before.current && shape && JSON.stringify(before.current) !== JSON.stringify(shape)) engine.updateShapeParams(meta.id, before.current, shape);
    before.current = null;
  }} /></label>;
}

function ShapeControls({ meta }: { meta: LayerMeta }) {
  const shape = meta.shape!;
  const commonWidth = shape.kind === 'line' ? shape.width : shape.strokeWidth;
  const setWidth = (value: number, current: ShapeParams): ShapeParams => current.kind === 'line' ? { ...current, width: Math.max(1, value) } : { ...current, strokeWidth: Math.max(1, value) };
  const fields: ReactNode[] = [];
  const field = (label: string, value: number, make: (value: number, shape: ShapeParams) => ShapeParams) => fields.push(<ShapeNumber key={label} label={label} value={value} make={make} meta={meta} />);
  if (shape.kind === 'line') {
    field('開始 X', shape.x1, (v, s) => ({ ...(s as typeof shape), x1: v }));
    field('開始 Y', shape.y1, (v, s) => ({ ...(s as typeof shape), y1: v }));
    field('終了 X', shape.x2, (v, s) => ({ ...(s as typeof shape), x2: v }));
    field('終了 Y', shape.y2, (v, s) => ({ ...(s as typeof shape), y2: v }));
    const length = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
    const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
    field('長さ', length, (v, s) => s.kind === 'line' ? { ...s, x2: s.x1 + Math.max(0, v) * Math.cos(angle), y2: s.y1 + Math.max(0, v) * Math.sin(angle) } : s);
    field('角度', angle * 180 / Math.PI, (v, s) => s.kind === 'line' ? { ...s, x2: s.x1 + length * Math.cos(v * Math.PI / 180), y2: s.y1 + length * Math.sin(v * Math.PI / 180) } : s);
  } else if (shape.kind === 'rect') {
    field('X', shape.x, (v, s) => ({ ...(s as typeof shape), x: v }));
    field('Y', shape.y, (v, s) => ({ ...(s as typeof shape), y: v }));
    field('幅', shape.width, (v, s) => ({ ...(s as typeof shape), width: Math.max(0.1, v) }));
    field('高さ', shape.height, (v, s) => ({ ...(s as typeof shape), height: Math.max(0.1, v) }));
  } else {
    field('中心 X', shape.cx, (v, s) => ({ ...(s as typeof shape), cx: v }));
    field('中心 Y', shape.cy, (v, s) => ({ ...(s as typeof shape), cy: v }));
    field('横半径', shape.rx, (v, s) => ({ ...(s as typeof shape), rx: Math.max(0.1, v) }));
    field('縦半径', shape.ry, (v, s) => ({ ...(s as typeof shape), ry: Math.max(0.1, v) }));
  }
  return <div className="shape-controls">
    <div className="shape-number-grid">{fields}</div>
    <label className="ctl-row"><span>線の太さ</span><ShapeNumber label="px" value={commonWidth} make={setWidth} meta={meta} /></label>
    <label className="shape-color-row"><span>線の色</span><input type="color" value={shape.color === TRANSPARENT ? '#ffffff' : shape.color} onChange={(e) => engine.updateShapeParams(meta.id, shape, { ...shape, color: e.target.value })} /><button className={shape.color === TRANSPARENT ? 'toggled' : ''} onClick={() => engine.updateShapeParams(meta.id, shape, { ...shape, color: TRANSPARENT })}>透明</button></label>
    <button onClick={() => engine.transferShapeLayer()} disabled={!engine.canTransferShape(meta.id)}>親へ転写</button>
  </div>;
}

function LayerControls({ meta }: { meta: LayerMeta }) {
  const pct = Math.round(meta.opacity * 100);
  return <div className="layer-controls">
    <label className="ctl-row"><span>不透明度</span><CommitSlider value={pct} min={0} max={100} onPreview={(v) => engine.previewLayerProps(meta.id, { opacity: v / 100 })} onCommit={(b, a) => engine.commitLayerProps(meta.id, { opacity: b / 100 }, { opacity: a / 100 }, '不透明度')} /><span className="num">{pct}</span></label>
    {meta.type !== 'adjust' && <label className="ctl-row"><span>合成</span><select value={meta.blend} onChange={(e) => engine.commitLayerProps(meta.id, { blend: meta.blend }, { blend: e.target.value as BlendMode }, '合成モード')}>{BLEND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
    {meta.type === 'adjust' && ADJUST_SLIDERS.map((p) => <label className="ctl-row" key={p.key}><span>{p.label}</span><CommitSlider value={meta.params![p.key]} min={p.min} max={p.max} onPreview={(v) => engine.previewLayerProps(meta.id, { params: { ...meta.params!, [p.key]: v } })} onCommit={(b, a) => engine.commitLayerProps(meta.id, { params: { ...meta.params!, [p.key]: b } }, { params: { ...meta.params!, [p.key]: a } }, '色調補正')} /><span className="num">{meta.params![p.key]}</span></label>)}
    {meta.type === 'shape' && <ShapeControls meta={meta} />}
  </div>;
}

interface TreeProps { id: string; byId: Map<string, LayerMeta>; activeId: string; expanded: Set<string>; setExpandedPath: (id: string) => void; dragId: string | null; setDragId: (id: string | null) => void; }

function DropGap({ parentId, index, dragId }: { parentId: string | null; index: number; dragId: string | null }) {
  return <div className={`layer-drop-gap${dragId ? ' dragging' : ''}`} onDragOver={(e) => { if (dragId) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (dragId && engine.canMoveLayer(dragId, parentId)) engine.moveLayer(dragId, { parentId, index }); }} />;
}

function LayerNode(props: TreeProps) {
  const meta = props.byId.get(props.id)!;
  const children = meta.childIds.map((id) => props.byId.get(id)).filter(Boolean) as LayerMeta[];
  const open = props.expanded.has(meta.id);
  return <div className="layer-tree-node">
    <div className={`layer-row${meta.id === props.activeId ? ' active' : ''}${meta.visible ? '' : ' hidden-layer'}`} draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; props.setDragId(meta.id); }} onDragEnd={() => props.setDragId(null)} onDragOver={(e) => { if (props.dragId && props.dragId !== meta.id) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (props.dragId) { engine.moveLayerAsTopChild(props.dragId, meta.id); props.setExpandedPath(meta.id); } }} onClick={() => engine.setActiveLayer(meta.id)}>
      <button className={`layer-expander${children.length ? '' : ' empty'}`} onClick={(e) => { e.stopPropagation(); if (children.length) props.setExpandedPath(meta.id); }}>{open ? '▾' : '▸'}</button>
      <button className="eye" onClick={(e) => { e.stopPropagation(); engine.commitLayerProps(meta.id, { visible: meta.visible }, { visible: !meta.visible }, '表示切替'); }}>{meta.visible ? '◉' : '○'}</button>
      {meta.type === 'adjust' ? <div className="adjust-badge">補正</div> : <Thumb meta={meta} />}
      <span className="layer-name">{meta.name}</span><span className="drag-grip">⠿</span>
    </div>
    <div className={`layer-children${open ? ' open' : ''}`}><div>
      {[...children].reverse().map((child) => <div key={child.id}><DropGap parentId={meta.id} index={meta.childIds.indexOf(child.id) + 1} dragId={props.dragId} /><LayerNode {...props} id={child.id} /></div>)}
      <DropGap parentId={meta.id} index={0} dragId={props.dragId} />
    </div></div>
  </div>;
}

export function LayerPanel() {
  const layers = useStore((s) => s.layers);
  const activeId = useStore((s) => s.activeLayerId);
  const [expandedPath, setExpanded] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers]);
  const roots = engine.layerRootIds().map((id) => byId.get(id)).filter(Boolean) as LayerMeta[];
  const active = byId.get(activeId);
  const setExpandedPath = (id: string) => {
    if (expandedPath.includes(id)) { setExpanded(expandedPath.slice(0, expandedPath.indexOf(id))); return; }
    const path: string[] = [];
    let node = byId.get(id);
    while (node) { path.unshift(node.id); node = node.parentId ? byId.get(node.parentId) : undefined; }
    setExpanded(path);
  };
  return <div className="section layers-section">
    <div className="section-title-row"><div className="section-title">レイヤー</div><div className="layer-add-buttons"><button onClick={() => engine.addRasterLayer()} title="レイヤーを追加">＋</button><button onClick={() => engine.addAdjustLayer()} title="色調補正レイヤーを追加">補正</button><button onClick={() => active && engine.removeLayer(active.id)} disabled={!active}>削除</button></div></div>
    <div className="layer-list">
      {[...roots].reverse().map((root) => <div key={root.id}><DropGap parentId={null} index={engine.layerRootIds().indexOf(root.id) + 1} dragId={dragId} /><LayerNode id={root.id} byId={byId} activeId={activeId} expanded={new Set(expandedPath)} setExpandedPath={setExpandedPath} dragId={dragId} setDragId={setDragId} /></div>)}
      <DropGap parentId={null} index={0} dragId={dragId} />
      {dragId && byId.get(dragId)?.parentId && <div className="layer-out-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); engine.moveLayerOut(dragId); }}>親の外へ</div>}
    </div>
    <div className="layer-merge-buttons"><button onClick={() => engine.mergeLayerDown()} disabled={!engine.canMergeLayerDown()}>下と統合</button></div>
    {active && <LayerControls meta={active} />}
  </div>;
}
