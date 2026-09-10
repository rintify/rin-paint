import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import TuneIcon from '@mui/icons-material/Tune';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import {
  Box,
  Button,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { engine } from '../engine/PaintEngine';
import { drawShape } from '../engine/shapes';
import { useStore } from '../state/store';
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
  const before = useRef<ShapeParams | null>(null);
  return (
    <TextField
      size="small"
      label={label}
      type="number"
      value={Math.round(value * 10) / 10}
      slotProps={{ htmlInput: { step: 0.1 } }}
      onFocus={() => {
        before.current = engine.getShape(meta.id);
      }}
      onChange={(e) => {
        const shape = engine.getShape(meta.id);
        if (!shape) return;
        if (!before.current) before.current = shape;
        engine.updateShapeParams(meta.id, before.current, make(Number(e.target.value), shape), true);
      }}
      onBlur={() => {
        const shape = engine.getShape(meta.id);
        if (before.current && shape && JSON.stringify(before.current) !== JSON.stringify(shape)) {
          engine.updateShapeParams(meta.id, before.current, shape);
        }
        before.current = null;
      }}
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
  const pct = Math.round(meta.opacity * 100);
  return (
    <Stack spacing={1} sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
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
      {meta.type === 'shape' && <ShapeControls meta={meta} />}
    </Stack>
  );
}

interface TreeProps {
  id: string;
  byId: Map<string, LayerMeta>;
  activeId: string;
  expanded: Set<string>;
  setExpandedPath: (id: string) => void;
  dragId: string | null;
  setDragId: (id: string | null) => void;
}

function DropGap({
  parentId,
  index,
  dragId,
}: {
  parentId: string | null;
  index: number;
  dragId: string | null;
}) {
  return (
    <Box
      className={`layer-drop-gap${dragId ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (dragId) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (dragId && engine.canMoveLayer(dragId, parentId)) {
          engine.moveLayer(dragId, { parentId, index });
        }
      }}
    />
  );
}

function LayerNode(props: TreeProps) {
  const meta = props.byId.get(props.id)!;
  const children = meta.childIds.map((id) => props.byId.get(id)).filter(Boolean) as LayerMeta[];
  const open = props.expanded.has(meta.id);
  const active = meta.id === props.activeId;

  return (
    <Box className="layer-tree-node">
      <Box
        className={`layer-row${active ? ' active' : ''}${meta.visible ? '' : ' hidden-layer'}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          props.setDragId(meta.id);
        }}
        onDragEnd={() => props.setDragId(null)}
        onDragOver={(e) => {
          if (props.dragId && props.dragId !== meta.id) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (props.dragId) {
            engine.moveLayerAsTopChild(props.dragId, meta.id);
            props.setExpandedPath(meta.id);
          }
        }}
        onClick={() => engine.setActiveLayer(meta.id)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.875,
          px: 0.75,
          py: 0.625,
          border: 1,
          borderColor: active ? 'primary.main' : 'divider',
          borderRadius: 1,
          bgcolor: active ? 'primary.dark' : 'action.hover',
          cursor: 'pointer',
          opacity: meta.visible ? 1 : 0.55,
          transition: 'transform .16s ease, opacity .16s ease, border-color .16s ease',
        }}
      >
        <IconButton
          size="small"
          className={children.length ? undefined : 'empty'}
          onClick={(e) => {
            e.stopPropagation();
            if (children.length) props.setExpandedPath(meta.id);
          }}
          sx={{
            width: 18,
            height: 18,
            p: 0,
            visibility: children.length ? 'visible' : 'hidden',
            color: 'text.secondary',
          }}
        >
          {open ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />}
        </IconButton>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            engine.commitLayerProps(
              meta.id,
              { visible: meta.visible },
              { visible: !meta.visible },
              '表示切替',
            );
          }}
          sx={{ p: 0.25, color: 'text.secondary' }}
          aria-label="表示切替"
        >
          {meta.visible ? (
            <VisibilityIcon sx={{ fontSize: 16 }} />
          ) : (
            <VisibilityOffIcon sx={{ fontSize: 16 }} />
          )}
        </IconButton>
        {meta.type === 'adjust' ? (
          <Box className="adjust-badge">補正</Box>
        ) : (
          <Thumb meta={meta} />
        )}
        <Typography variant="body2" noWrap sx={{ flex: 1 }}>
          {meta.name}
        </Typography>
        <DragIndicatorIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'grab' }} />
      </Box>
      <Box className={`layer-children${open ? ' open' : ''}`}>
        <Box>
          {[...children].reverse().map((child) => (
            <Box key={child.id}>
              <DropGap
                parentId={meta.id}
                index={meta.childIds.indexOf(child.id) + 1}
                dragId={props.dragId}
              />
              <LayerNode {...props} id={child.id} />
            </Box>
          ))}
          <DropGap parentId={meta.id} index={0} dragId={props.dragId} />
        </Box>
      </Box>
    </Box>
  );
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
    if (expandedPath.includes(id)) {
      setExpanded(expandedPath.slice(0, expandedPath.indexOf(id)));
      return;
    }
    const path: string[] = [];
    let node = byId.get(id);
    while (node) {
      path.unshift(node.id);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    setExpanded(path);
  };

  return (
    <Box className="section layers-section">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
          レイヤー
        </Typography>
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="レイヤーを追加">
            <IconButton size="small" onClick={() => engine.addRasterLayer()} aria-label="レイヤーを追加">
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="色調補正レイヤーを追加">
            <Button size="small" onClick={() => engine.addAdjustLayer()} startIcon={<TuneIcon sx={{ fontSize: 14 }} />} sx={{ fontSize: 12, py: 0.25 }}>
              補正
            </Button>
          </Tooltip>
          <Button
            size="small"
            onClick={() => active && engine.removeLayer(active.id)}
            disabled={!active}
            sx={{ fontSize: 12, py: 0.25 }}
          >
            削除
          </Button>
        </Stack>
      </Stack>
      <Box className="layer-list">
        {[...roots].reverse().map((root) => (
          <Box key={root.id}>
            <DropGap
              parentId={null}
              index={engine.layerRootIds().indexOf(root.id) + 1}
              dragId={dragId}
            />
            <LayerNode
              id={root.id}
              byId={byId}
              activeId={activeId}
              expanded={new Set(expandedPath)}
              setExpandedPath={setExpandedPath}
              dragId={dragId}
              setDragId={setDragId}
            />
          </Box>
        ))}
        <DropGap parentId={null} index={0} dragId={dragId} />
        {dragId && byId.get(dragId)?.parentId && (
          <Box
            className="layer-out-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              engine.moveLayerOut(dragId);
            }}
          >
            親の外へ
          </Box>
        )}
      </Box>
      <Box sx={{ mt: 1 }}>
        <Button fullWidth onClick={() => engine.mergeLayerDown()} disabled={!engine.canMergeLayerDown()} sx={{ fontSize: 11 }}>
          下と統合
        </Button>
      </Box>
      {active && <LayerControls meta={active} />}
    </Box>
  );
}
