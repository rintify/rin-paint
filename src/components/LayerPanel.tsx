import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CloseIcon from '@mui/icons-material/Close';
import TuneIcon from '@mui/icons-material/Tune';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  MenuItem,
  Menu,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { engine } from '../engine/PaintEngine';
import { drawShape } from '../engine/shapes';
import { useStore } from '../state/store';
import { selectedLayerRows } from '../engine/layerTree';
import { TextControls } from './TextControls';
import { appAlert } from './AppDialogs';
import { NumericField } from './NumericField';
import {
  ART_H,
  ART_W,
  BLEND_OPTIONS,
  TRANSPARENT,
  type AdjustParams,
  type BlendMode,
  type LayerMeta,
  type ShapeParams,
} from '../types';

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

function CommitSlider({
  value,
  min,
  max,
  onPreview,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onPreview: (v: number) => void;
  onCommit: (before: number, after: number) => void;
}) {
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
    <Slider
      min={min}
      max={max}
      value={value}
      onChange={(_, v) => {
        if (before.current === null) before.current = latest.current;
        onPreview(v as number);
      }}
      onChangeCommitted={finish}
      sx={{ flex: 1 }}
    />
  );
}

const ADJUST_SLIDERS: { key: keyof AdjustParams; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: '明度', min: 0, max: 200 },
  { key: 'contrast', label: 'コントラスト', min: 0, max: 200 },
  { key: 'hue', label: '色相', min: -180, max: 180 },
  { key: 'saturation', label: '彩度', min: 0, max: 200 },
];

function ShapeNumber({
  label,
  value,
  make,
  meta,
}: {
  label: string;
  value: number;
  make: (value: number, shape: ShapeParams) => ShapeParams;
  meta: LayerMeta;
}) {
  return (
    <NumericField
      size="small"
      label={label}
      value={Math.round(value * 10) / 10}
      onCommit={(number) => { const shape = engine.getShape(meta.id); if (shape) engine.updateShapeParams(meta.id, shape, make(number, shape)); }}
      sx={{ minWidth: 0 }}
    />
  );
}

function ShapeControls({ meta }: { meta: LayerMeta }) {
  const shape = meta.shape!;
  const commonWidth = shape.kind === 'line' ? shape.width : shape.strokeWidth;
  const setWidth = (value: number, current: ShapeParams): ShapeParams =>
    current.kind === 'line'
      ? { ...current, width: Math.max(1, value) }
      : { ...current, strokeWidth: Math.max(1, value) };
  const fields: ReactNode[] = [];
  const field = (
    label: string,
    value: number,
    make: (value: number, shape: ShapeParams) => ShapeParams,
  ) =>
    fields.push(
      <ShapeNumber key={label} label={label} value={value} make={make} meta={meta} />,
    );
  if (shape.kind === 'line') {
    field('開始 X', shape.x1, (v, s) => ({ ...(s as typeof shape), x1: v }));
    field('開始 Y', shape.y1, (v, s) => ({ ...(s as typeof shape), y1: v }));
    field('終了 X', shape.x2, (v, s) => ({ ...(s as typeof shape), x2: v }));
    field('終了 Y', shape.y2, (v, s) => ({ ...(s as typeof shape), y2: v }));
    const length = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
    const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
    field('長さ', length, (v, s) =>
      s.kind === 'line'
        ? {
            ...s,
            x2: s.x1 + Math.max(0, v) * Math.cos(angle),
            y2: s.y1 + Math.max(0, v) * Math.sin(angle),
          }
        : s,
    );
    field('角度', (angle * 180) / Math.PI, (v, s) =>
      s.kind === 'line'
        ? {
            ...s,
            x2: s.x1 + length * Math.cos((v * Math.PI) / 180),
            y2: s.y1 + length * Math.sin((v * Math.PI) / 180),
          }
        : s,
    );
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
  if (shape.kind !== 'line') field('回転', (shape.rotation ?? 0) * 180 / Math.PI, (v, s) => ({ ...s, rotation: v * Math.PI / 180 } as ShapeParams));
  return (
    <Stack spacing={1} sx={{ pt: 0.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>{fields}</Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
          線の太さ
        </Typography>
        <ShapeNumber label="px" value={commonWidth} make={setWidth} meta={meta} />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
          線の色
        </Typography>
        <Box
          component="input"
          type="color"
          value={shape.color === TRANSPARENT ? '#ffffff' : shape.color}
          onChange={(e) =>
            engine.updateShapeParams(meta.id, shape, { ...shape, color: e.target.value })
          }
          sx={{
            minWidth: 0,
            flex: 1,
            height: 34,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'action.hover',
            p: 0.5,
          }}
        />
        <Button
          size="small"
          variant={shape.color === TRANSPARENT ? 'contained' : 'outlined'}
          onClick={() =>
            engine.updateShapeParams(meta.id, shape, { ...shape, color: TRANSPARENT })
          }
        >
          透明
        </Button>
      </Stack>
      <Button
        onClick={() => engine.transferShapeLayer()}
        disabled={!engine.canTransferShape(meta.id)}
      >
        親へ転写
      </Button>
    </Stack>
  );
}

function LayerControls({ meta }: { meta: LayerMeta }) {
  const multi = useStore(s => s.multiSelectMode);
  if (multi) return <MultiLayerControls />;
  const pct = Math.round(meta.opacity * 100);
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
          不透明度
        </Typography>
        <CommitSlider
          value={pct}
          min={0}
          max={100}
          onPreview={(v) => engine.previewLayerProps(meta.id, { opacity: v / 100 })}
          onCommit={(b, a) =>
            engine.commitLayerProps(meta.id, { opacity: b / 100 }, { opacity: a / 100 }, '不透明度')
          }
        />
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ width: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flex: 'none' }}
        >
          {pct}
        </Typography>
      </Stack>
      {meta.type !== 'adjust' && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
            合成
          </Typography>
          <FormControl size="small" fullWidth>
            <Select
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
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      )}
      {meta.type === 'adjust' &&
        ADJUST_SLIDERS.map((p) => (
          <Stack direction="row" spacing={1} key={p.key} sx={{ alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
              {p.label}
            </Typography>
            <CommitSlider
              value={meta.params![p.key]}
              min={p.min}
              max={p.max}
              onPreview={(v) =>
                engine.previewLayerProps(meta.id, { params: { ...meta.params!, [p.key]: v } })
              }
              onCommit={(b, a) =>
                engine.commitLayerProps(
                  meta.id,
                  { params: { ...meta.params!, [p.key]: b } },
                  { params: { ...meta.params!, [p.key]: a } },
                  '色調補正',
                )
              }
            />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flex: 'none' }}
            >
              {meta.params![p.key]}
            </Typography>
          </Stack>
        ))}
      {meta.type === 'adjust' && <MaskControls meta={meta} />}
      {meta.type === 'shape' && <ShapeControls meta={meta} />}
      {meta.type === 'text' && <TextControls meta={meta} />}
    </Stack>
  );
}

function MultiLayerControls() {
  const layers = useStore(s => s.layers);
  const ids = useStore(s => s.selectedLayerIds);
  const selected = layers.filter(layer => ids.includes(layer.id));
  const common = <T,>(read: (layer: LayerMeta) => T): T | null => {
    if (!selected.length) return null;
    const first = read(selected[0]);
    return selected.every(layer => Object.is(read(layer), first)) ? first : null;
  };
  const opacity = common(layer => Math.round(layer.opacity * 100));
  const visible = common(layer => layer.visible);
  const blend = common(layer => layer.blend);
  return <Stack spacing={1.25}>
    <Typography variant="caption" color="text.secondary">{selected.length}レイヤーの共通設定。異なる値は「—」で表示します。</Typography>
    <Stack direction="row" sx={{ alignItems: 'center' }}><Typography variant="body2" sx={{ flex: 1 }}>表示 {visible === null ? '—' : ''}</Typography><Switch checked={visible ?? false} onChange={event => engine.commitSelectedLayerProps({}, { visible: event.target.checked }, '複数レイヤーの表示')} /></Stack>
    <NumericField label="不透明度 (%)" value={opacity} min={0} max={100} onCommit={value => engine.commitSelectedLayerProps({}, { opacity: value / 100 }, '複数レイヤーの不透明度')} />
    <TextField select label="合成モード" value={blend ?? ''} slotProps={{ select: { displayEmpty: true } }} onChange={event => engine.commitSelectedLayerProps({}, { blend: event.target.value as BlendMode }, '複数レイヤーの合成モード')}>
      {!blend && <MenuItem value="" disabled>—</MenuItem>}{BLEND_OPTIONS.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
    </TextField>
  </Stack>;
}

function MaskControls({ meta }: { meta: LayerMeta }) {
  const layers = useStore(s => s.layers);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string[]>(meta.maskLayerIds ?? []);
  const candidates = layers.filter(layer => layer.id !== meta.id && layer.type !== 'adjust' && layer.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const show = () => { setDraft([...(meta.maskLayerIds ?? [])]); setOpen(true); };
  return <>
    <Stack spacing={.75}>
      <Stack direction="row" sx={{ alignItems: 'center' }}><Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>マスク</Typography><Button size="small" onClick={show}>追加・編集</Button></Stack>
      {(meta.maskLayerIds ?? []).map(id => <Stack key={id} direction="row" sx={{ alignItems: 'center' }}><Typography variant="body2" noWrap sx={{ flex: 1 }}>{layers.find(layer => layer.id === id)?.name ?? '削除済み'}</Typography><Button size="small" onClick={() => engine.commitLayerProps(meta.id, { maskLayerIds: meta.maskLayerIds }, { maskLayerIds: (meta.maskLayerIds ?? []).filter(value => value !== id) }, 'マスクを解除')}>解除</Button></Stack>)}
      {!(meta.maskLayerIds?.length) && <Typography variant="caption" color="text.secondary">未設定（全面を補正）</Typography>}
    </Stack>
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>マスク元レイヤー</DialogTitle>
      <DialogContent><TextField fullWidth placeholder="レイヤーを検索" value={query} onChange={event => setQuery(event.target.value)} sx={{ mb: 1 }} />
        <Stack spacing={.5}>{candidates.map(layer => <Box key={layer.id} className="mask-layer-card" onClick={() => setDraft(current => current.includes(layer.id) ? current.filter(id => id !== layer.id) : [...current, layer.id])}><Checkbox checked={draft.includes(layer.id)} /><Thumb meta={layer} /><Typography variant="body2">{layer.name}</Typography></Box>)}</Stack>
      </DialogContent>
      <DialogActions><Button onClick={() => setOpen(false)}>キャンセル</Button><Button variant="contained" onClick={() => { engine.commitLayerProps(meta.id, { maskLayerIds: meta.maskLayerIds ?? [] }, { maskLayerIds: draft }, 'マスクを変更'); setOpen(false); }}>適用</Button></DialogActions>
    </Dialog>
  </>;
}

function LayerControlsPalette({ meta, onClose }: { meta: LayerMeta; onClose: () => void }) {
  const multi = useStore(s => s.multiSelectMode);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const paper = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const clamp = () => {
      const rect = paper.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = rect.left < 8 ? 8 - rect.left : Math.min(0, window.innerWidth - 8 - rect.right);
      const dy = rect.top < 8 ? 8 - rect.top : Math.min(0, window.innerHeight - 8 - rect.bottom);
      if (dx || dy) setPosition(p => ({ x: p.x + dx, y: p.y + dy }));
    };
    const observer = new ResizeObserver(clamp);
    if (paper.current) observer.observe(paper.current);
    window.addEventListener('resize', clamp);
    return () => { observer.disconnect(); window.removeEventListener('resize', clamp); };
  }, []);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setPosition({
      x: Math.max(current.minX, Math.min(current.maxX, current.left + event.clientX - current.x)),
      y: Math.max(current.minY, Math.min(current.maxY, current.top + event.clientY - current.y)),
    });
  };
  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <Paper
      data-text-controls
      role="region"
      aria-label={`${meta.name}の設定`}
      ref={paper}
      elevation={12}
      className="layer-controls-palette"
      sx={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <Box
        className="layer-controls-palette-title"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const rect = paper.current?.getBoundingClientRect();
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: position.x,
            top: position.y,
            minX: position.x + 8 - (rect?.left ?? 8),
            maxX: position.x + window.innerWidth - 8 - (rect?.right ?? window.innerWidth - 8),
            minY: position.y + 8 - (rect?.top ?? 8),
            maxY: position.y + window.innerHeight - 8 - (rect?.bottom ?? window.innerHeight - 8),
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>{meta.name}</Typography>
        <Typography variant="caption" color="text.secondary">パラメータ</Typography>
        <IconButton size="small" aria-label="レイヤーの設定を閉じる" onPointerDown={e => e.stopPropagation()} onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Box>
      <Box className="layer-controls-palette-content">
        {multi && <Button fullWidth size="small" variant="outlined" sx={{ mb: 1 }} onClick={() => engine.exitMultiSelect()}>複数選択を解除</Button>}
        <LayerControls meta={meta} />
      </Box>
    </Paper>
  );
}

interface VisibleRow { id: string; depth: number; index: number; exiting?: boolean }
interface DropTarget { parentId: string | null; index: number; anchorId: string; edge: 'before' | 'after' | 'inside'; depth: number }
const ROW_HEIGHT = 48;
const MOTION_MS = 220;

export function LayerPanel() {
  const layers = useStore(s => s.layers);
  const activeId = useStore(s => s.activeLayerId);
  const selectedIds = useStore(s => s.selectedLayerIds);
  const multi = useStore(s => s.multiSelectMode);
  const clipboard = useStore(s => s.clipboardAvailable);
  const generation = useStore(s => s.projectGeneration);
  const previousGeneration = useRef(generation);
  const previousMulti = useRef(multi);
  const byId = useMemo(() => new Map(layers.map(l => [l.id, l])), [layers]);
  const active = byId.get(activeId);
  const [palette, setPalette] = useState<{ id: string; open: boolean }>({ id: '', open: false });
  // Selection transitions set a default once. Closing is respected until the next selection.
  if (palette.id !== activeId) setPalette({ id: activeId, open: !!active && active.type !== 'raster' });
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const frozen = useRef<{ id: string; depth: number }[] | null>(null);
  const desired = useMemo(() => selectedLayerRows(engine.layerRootIds(), layers, multi ? selectedIds : activeId), [layers, activeId, multi, selectedIds]);
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);
  const press = useRef<{ id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const visible = dragId && frozen.current ? frozen.current : desired;
  const signature = visible.map(r => r.id + ':' + r.depth).join('|');
  const [rows, setRows] = useState<VisibleRow[]>([]);
  const [spacing, setSpacing] = useState({ top: 0, height: 0 });
  const list = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const oldRects = useRef(new Map<string, DOMRect>());
  const pending = useRef<{ rects: Map<string, DOMRect>; anchorY: number | null; id: string; preserveAnchor: boolean } | null>(null);
  const skipAnchorOnce = useRef(false);
  const animations = useRef<Animation[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadata = useRef(new Map<string, LayerMeta>());
  for (const layer of layers) metadata.current.set(layer.id, layer);
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (timer.current) clearTimeout(timer.current);
    const rects = new Map([...elements.current].map(([id, node]) => [id, node.getBoundingClientRect()]));
    const anchor = rects.get(activeId) ?? oldRects.current.get(activeId);
    const preserveAnchor = !skipAnchorOnce.current;
    skipAnchorOnce.current = false;
    pending.current = { rects, anchorY: anchor ? anchor.top - el.getBoundingClientRect().top : null, id: activeId, preserveAnchor };
    const ids = new Set(visible.map(r => r.id));
    setRows(previous => [
      ...visible.map((row, index) => ({ ...row, index })),
      ...previous.filter(row => !ids.has(row.id)).map(row => ({ ...row, exiting: true })),
    ]);
    // Tree structure, not opacity/parameter changes, drives layout.
  }, [signature, activeId]);

  useLayoutEffect(() => {
    const el = list.current;
    const change = pending.current;
    if (!el || !change) return;
    pending.current = null;
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    const selected = rows.find(r => r.id === change.id && !r.exiting);
    let top = spacing.top;
    let scroll = el.scrollTop;
    if (selected && change.preserveAnchor) {
      if (change.anchorY !== null) {
        scroll = top + selected.index * ROW_HEIGHT - change.anchorY;
        if (scroll < 0) { top -= scroll; scroll = 0; }
      } else {
        const y = top + selected.index * ROW_HEIGHT;
        if (y < scroll || y + ROW_HEIGHT > scroll + el.clientHeight) scroll = Math.max(0, y - el.clientHeight / 2 + ROW_HEIGHT / 2);
      }
    }
    const height = Math.max(top + visible.length * ROW_HEIGHT + 8, scroll + el.clientHeight);
    // Set geometry before measuring: anchor compensation must happen in this frame.
    const body = el.firstElementChild as HTMLElement;
    body.style.height = height + 'px';
    for (const row of rows) {
      const node = elements.current.get(row.id);
      if (node) node.style.top = top + row.index * ROW_HEIGHT + 'px';
    }
    el.scrollTop = scroll;
    setSpacing({ top, height });
    if (!reduceMotion()) {
      for (const row of rows) {
        const node = elements.current.get(row.id);
        if (!node) continue;
        const before = change.rects.get(row.id), after = node.getBoundingClientRect();
        const dx = before ? before.left - after.left : 0;
        const dy = before ? before.top - after.top : -6;
        animations.current.push(node.animate([
          { transform: 'translate(' + dx + 'px,' + dy + 'px)', opacity: before ? 1 : 0 },
          { transform: 'translate(0,0)', opacity: row.exiting ? 0 : 1 },
        ], { duration: MOTION_MS, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }));
      }
    }
    oldRects.current = new Map([...elements.current].map(([id, node]) => [id, node.getBoundingClientRect()]));
    timer.current = setTimeout(() => {
      for (const animation of animations.current) animation.cancel();
      animations.current = [];
      setRows(current => current.filter(r => !r.exiting));
      oldRects.current = new Map([...elements.current].map(([id, node]) => [id, node.getBoundingClientRect()]));
    }, reduceMotion() ? 0 : MOTION_MS);
  }, [rows]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    for (const animation of animations.current) animation.cancel();
  }, []);
  useEffect(() => {
    if (previousGeneration.current === generation) return;
    previousGeneration.current = generation;
    setMenu(null); setDragId(null); setDrop(null); setPalette({ id: activeId, open: false }); setSpacing({ top: 0, height: 0 });
  }, [generation]);
  useEffect(() => {
    if (multi && !previousMulti.current) setPalette({ id: activeId, open: true });
    previousMulti.current = multi;
  }, [multi, activeId]);

  const select = (id: string) => {
    oldRects.current = new Map([...elements.current].map(([key, node]) => [key, node.getBoundingClientRect()]));
    engine.setActiveLayer(id);
  };
  const finishDrag = () => { frozen.current = null; setDragId(null); setDrop(null); };
  const menuMeta = menu ? byId.get(menu.id) : undefined;
  const applyDrop = () => {
    if (dragId && drop && engine.canMoveLayer(dragId, drop.parentId)) {
      // Reordering should show the layer travelling to its new position; only branch
      // expansion/selection changes keep the selected row pinned in the viewport.
      skipAnchorOnce.current = true;
      if (!engine.moveLayer(dragId, { parentId: drop.parentId, index: drop.index })) skipAnchorOnce.current = false;
    }
    finishDrag();
  };

  return (
    <Box className="section layers-section">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>レイヤー</Typography>
        <Stack direction="row" spacing={0.5}>
          {clipboard && <Button size="small" onClick={() => void engine.pasteLayers().catch(error => appAlert(String(error)))}>ペースト</Button>}
          <Tooltip title="レイヤーを追加"><IconButton size="small" onClick={() => engine.addRasterLayer()} aria-label="レイヤーを追加"><AddIcon fontSize="small" /></IconButton></Tooltip>
          <Button size="small" onClick={() => engine.addAdjustLayer()} startIcon={<TuneIcon sx={{ fontSize: 14 }} />} sx={{ fontSize: 12 }}>補正</Button>
        </Stack>
      </Stack>
      <Box ref={list} className="layer-list layer-flat-list" onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDrop(null); }}
        onDragOver={event => {
          if (!dragId) return;
          event.preventDefault();
          const el = event.currentTarget, rect = el.getBoundingClientRect();
          const edge = 32;
          if (event.clientY < rect.top + edge) el.scrollTop -= 12;
          else if (event.clientY > rect.bottom - edge) el.scrollTop += 12;
          // The indentation gutter is a real drop surface, including multiple levels out.
          if (!(event.target as HTMLElement).closest('.layer-flat-row')) {
            const hovered = rows.find(row => {
              const box = elements.current.get(row.id)?.getBoundingClientRect();
              return !row.exiting && box && event.clientY >= box.top && event.clientY <= box.bottom && event.clientX < box.left;
            });
            if (hovered) {
              let anchor = byId.get(hovered.id)!;
              let depth = hovered.depth;
              const targetDepth = Math.max(0, Math.floor((event.clientX - rect.left) / 16));
              while (depth > targetDepth && anchor.parentId) { anchor = byId.get(anchor.parentId)!; depth--; }
              if (engine.canMoveLayer(dragId, anchor.parentId)) {
                const siblings = anchor.parentId ? byId.get(anchor.parentId)!.childIds : engine.layerRootIds();
                setDrop({ parentId: anchor.parentId, index: siblings.indexOf(anchor.id), anchorId: hovered.id, edge: 'after', depth });
              }
            }
          }
        }} onDrop={event => { event.preventDefault(); applyDrop(); }}>
        <Box sx={{ position: 'relative', height: spacing.height, minHeight: visible.length * ROW_HEIGHT + 8, flex: 'none' }}>
          {rows.map(row => {
            const meta = byId.get(row.id) ?? metadata.current.get(row.id);
            if (!meta) return null;
            const isActive = selectedIds.includes(meta.id);
            const guide = drop?.anchorId === meta.id ? drop : null;
            return (
              <Box key={meta.id} ref={(node: HTMLElement | null) => { if (node) elements.current.set(meta.id, node); else elements.current.delete(meta.id); }}
                className={'layer-row layer-flat-row' + (isActive ? ' active' : '') + (dragId === meta.id ? ' is-dragging' : '') + (guide?.edge === 'inside' ? ' drop-inside' : '')}
                style={{ top: spacing.top + row.index * ROW_HEIGHT, left: row.depth * 16, height: ROW_HEIGHT - 4, pointerEvents: row.exiting ? 'none' : undefined, opacity: row.exiting ? 0 : undefined }}
                draggable={!row.exiting} onClick={() => select(meta.id)}
                onPointerDown={event => {
                  if ((event.target as HTMLElement).closest('button')) return;
                  const timer = setTimeout(() => { engine.beginMultiSelect(meta.id); setPalette({ id: meta.id, open: true }); press.current = null; }, 450);
                  press.current = { id: meta.id, x: event.clientX, y: event.clientY, timer };
                }}
                onPointerMove={event => { const p = press.current; if (p?.id === meta.id && Math.hypot(event.clientX - p.x, event.clientY - p.y) >= 8) { clearTimeout(p.timer); press.current = null; } }}
                onPointerUp={() => { if (press.current) clearTimeout(press.current.timer); press.current = null; }}
                onPointerCancel={() => { if (press.current) clearTimeout(press.current.timer); press.current = null; }}
                onDragStart={event => {
                  if ((event.target as HTMLElement).closest('button')) { event.preventDefault(); return; }
                  event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', meta.id);
                  frozen.current = desired; setDragId(meta.id);
                }}
                onDragEnd={finishDrag}
                onDragOver={event => {
                  if (!dragId || dragId === meta.id) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const ratio = (event.clientY - rect.top) / rect.height;
                  let anchor = meta;
                  let depth = row.depth;
                  const requestedDepth = Math.max(0, Math.floor((event.clientX - list.current!.getBoundingClientRect().left) / 16));
                  while (depth > requestedDepth && anchor.parentId) { anchor = byId.get(anchor.parentId)!; depth--; }
                  const siblings = anchor.parentId ? byId.get(anchor.parentId)!.childIds : engine.layerRootIds();
                  const inside = anchor.id === meta.id && ratio >= .28 && ratio <= .72;
                  const target: DropTarget = inside
                    ? { parentId: meta.id, index: meta.childIds.length, anchorId: meta.id, edge: 'inside', depth: row.depth + 1 }
                    : { parentId: anchor.parentId, index: siblings.indexOf(anchor.id) + (ratio < .5 ? 1 : 0), anchorId: meta.id, edge: ratio < .5 ? 'before' : 'after', depth };
                  if (!engine.canMoveLayer(dragId, target.parentId)) { setDrop(null); return; }
                  event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDrop(target);
                }}
                onDrop={event => { event.preventDefault(); event.stopPropagation(); applyDrop(); }}>
                <IconButton draggable={false} size="small" aria-label="表示切替" onPointerDown={e => e.stopPropagation()} onClick={event => { event.stopPropagation(); engine.commitLayerProps(meta.id, { visible: meta.visible }, { visible: !meta.visible }, '表示切替'); }}>
                  {meta.visible ? <VisibilityIcon sx={{ fontSize: 16 }} /> : <VisibilityOffIcon sx={{ fontSize: 16 }} />}
                </IconButton>
                {meta.type === 'adjust' ? <Box className="adjust-badge">補正</Box> : <Thumb meta={meta} />}
                <Typography variant="body2" noWrap sx={{ flex: 1, opacity: meta.visible ? 1 : .5 }}>{meta.name}</Typography>
                <IconButton draggable={false} size="small" aria-label={meta.name + 'のメニュー'} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setMenu({ id: meta.id, anchor: event.currentTarget }); }}><MoreVertIcon sx={{ fontSize: 18 }} /></IconButton>
                {guide && guide.edge !== 'inside' && <Box className="layer-insertion-guide" sx={{ left: (guide.depth - row.depth) * 16, top: guide.edge === 'before' ? -3 : undefined, bottom: guide.edge === 'after' ? -3 : undefined }} />}
              </Box>
            );
          })}
          <Box sx={{ position: 'absolute', top: spacing.top + visible.length * ROW_HEIGHT, height: 32, left: 0, right: 0 }}
            onDragOver={event => { if (!dragId) return; event.preventDefault(); setDrop({ parentId: null, index: 0, anchorId: 'end', edge: 'after', depth: 0 }); }}
            onDrop={event => { event.preventDefault(); applyDrop(); }}>
            {drop?.anchorId === 'end' && <Box className="layer-insertion-guide" sx={{ left: 0, top: 0 }} />}
          </Box>
        </Box>
      </Box>
      <Menu anchorEl={menu?.anchor} open={!!menu && !!menuMeta} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { if (menu) { select(menu.id); setPalette({ id: menu.id, open: true }); } setMenu(null); }}>レイヤーの設定</MenuItem>
        <MenuItem onClick={() => { if (menu && menuMeta) setRename({ id: menu.id, value: menuMeta.name }); setMenu(null); }}>名称変更</MenuItem>
        <MenuItem onClick={() => { const id = menu?.id; setMenu(null); if (id) void engine.copyLayers(id).catch(error => appAlert(String(error))); }}>コピー</MenuItem>
        <MenuItem disabled={!menu || !engine.canMergeLayerDown(menu.id)} onClick={() => { const id = menu?.id; setMenu(null); if (id) void engine.mergeLayerDown(id).catch(error => appAlert(String(error))); }}>下と統合</MenuItem>
        <MenuItem disabled={!menu || !engine.canRemoveLayer(menu.id)} onClick={() => { if (menu) engine.removeLayer(menu.id); setMenu(null); }} sx={{ color: 'error.main' }}>削除</MenuItem>
      </Menu>
      <Dialog open={!!rename} onClose={() => setRename(null)} maxWidth="xs" fullWidth>
        <DialogTitle>レイヤー名を変更</DialogTitle>
        <DialogContent><TextField autoFocus fullWidth value={rename?.value ?? ''} error={!!rename && !rename.value.trim()} helperText={rename && !rename.value.trim() ? '空白だけの名称は使えません' : ' '} onChange={event => setRename(current => current ? { ...current, value: event.target.value } : null)} onKeyDown={event => { if (event.key === 'Enter' && rename?.value.trim()) { engine.renameLayer(rename.id, rename.value); setRename(null); } }} /></DialogContent>
        <DialogActions><Button onClick={() => setRename(null)}>キャンセル</Button><Button variant="contained" disabled={!rename?.value.trim()} onClick={() => { if (rename) engine.renameLayer(rename.id, rename.value); setRename(null); }}>変更</Button></DialogActions>
      </Dialog>
      {active && palette.id === active.id && palette.open && <LayerControlsPalette meta={active} onClose={() => setPalette({ id: active.id, open: false })} />}
    </Box>
  );
}
