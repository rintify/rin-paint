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
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
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
      {meta.type === 'shape' && <ShapeControls meta={meta} />}
    </Stack>
  );
}

function LayerControlsPalette({ meta }: { meta: LayerMeta }) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const paper = useRef<HTMLDivElement | null>(null);
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
        <Typography variant="subtitle2" noWrap>{meta.name}</Typography>
        <Typography variant="caption" color="text.secondary">パラメータ</Typography>
      </Box>
      <Box className="layer-controls-palette-content">
        <LayerControls meta={meta} />
      </Box>
    </Paper>
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
  dropTarget: LayerDropTarget | null;
  setDropTarget: (target: LayerDropTarget | null) => void;
  registerRow: (id: string, element: HTMLElement | null) => void;
  moveLayer: (id: string, parentId: string | null, index: number) => void;
}

interface LayerDropTarget {
  parentId: string | null;
  index: number;
  kind: 'between' | 'inside' | 'outdent';
  anchorId: string;
}

function sameDropTarget(a: LayerDropTarget | null, b: LayerDropTarget): boolean {
  return (
    !!a &&
    a.parentId === b.parentId &&
    a.index === b.index &&
    a.kind === b.kind &&
    a.anchorId === b.anchorId
  );
}

function DropGap({
  parentId,
  index,
  dragId,
  anchorId,
  dropTarget,
  setDropTarget,
  moveLayer,
}: {
  parentId: string | null;
  index: number;
  dragId: string | null;
  anchorId: string;
  dropTarget: LayerDropTarget | null;
  setDropTarget: (target: LayerDropTarget | null) => void;
  moveLayer: (id: string, parentId: string | null, index: number) => void;
}) {
  const target: LayerDropTarget = { parentId, index, kind: 'between', anchorId };
  const valid = !!dragId && engine.canMoveLayer(dragId, parentId);
  return (
    <Box
      className={`layer-drop-gap${dragId ? ' dragging' : ''}${sameDropTarget(dropTarget, target) ? ' active' : ''}`}
      onDragOver={(e) => {
        if (!valid) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTarget(target);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (valid && dragId) {
          moveLayer(dragId, parentId, index);
        }
        setDropTarget(null);
      }}
    />
  );
}

function LayerNode(props: TreeProps) {
  const meta = props.byId.get(props.id)!;
  const children = meta.childIds.map((id) => props.byId.get(id)).filter(Boolean) as LayerMeta[];
  const open = props.expanded.has(meta.id);
  const active = meta.id === props.activeId;
  const rowTarget = props.dropTarget?.anchorId === meta.id ? props.dropTarget : null;
  const parent = meta.parentId ? props.byId.get(meta.parentId) : undefined;
  const outdentTarget: LayerDropTarget | null = parent
    ? {
        parentId: parent.parentId,
        index: (parent.parentId ? props.byId.get(parent.parentId)?.childIds ?? [] : engine.layerRootIds()).indexOf(parent.id) + 1,
        kind: 'outdent',
        anchorId: meta.id,
      }
    : null;

  const performDrop = (target: LayerDropTarget) => {
    if (props.dragId && engine.canMoveLayer(props.dragId, target.parentId)) {
      props.moveLayer(props.dragId, target.parentId, target.index);
      if (target.kind === 'inside' && !props.expanded.has(meta.id)) props.setExpandedPath(meta.id);
    }
    props.setDropTarget(null);
  };

  return (
    <Box className={`layer-tree-node${props.dragId === meta.id ? ' is-dragging' : ''}`}>
      {outdentTarget && props.dragId && engine.canMoveLayer(props.dragId, outdentTarget.parentId) && (
        <Box
          className={`layer-outdent-zone${sameDropTarget(props.dropTarget, outdentTarget) ? ' active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            props.setDropTarget(outdentTarget);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            performDrop(outdentTarget);
          }}
          aria-hidden
        />
      )}
      <Box
        ref={(element: HTMLElement | null) => props.registerRow(meta.id, element)}
        className={`layer-row${active ? ' active' : ''}${meta.visible ? '' : ' hidden-layer'}${rowTarget?.kind === 'inside' ? ' drop-inside' : ''}${rowTarget?.kind === 'between' && rowTarget.index > (meta.parentId ? props.byId.get(meta.parentId)?.childIds.indexOf(meta.id) ?? -1 : engine.layerRootIds().indexOf(meta.id)) ? ' drop-before' : ''}${rowTarget?.kind === 'between' && rowTarget.index === (meta.parentId ? props.byId.get(meta.parentId)?.childIds.indexOf(meta.id) ?? -1 : engine.layerRootIds().indexOf(meta.id)) ? ' drop-after' : ''}${rowTarget?.kind === 'outdent' ? ' drop-outdent' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', meta.id);
          props.setDragId(meta.id);
        }}
        onDragEnd={() => {
          props.setDragId(null);
          props.setDropTarget(null);
        }}
        onDragOver={(e) => {
          if (!props.dragId || props.dragId === meta.id) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientY - rect.top) / rect.height;
          const siblings = meta.parentId ? props.byId.get(meta.parentId)?.childIds ?? [] : engine.layerRootIds();
          const ownIndex = siblings.indexOf(meta.id);
          const target: LayerDropTarget = ratio < 0.28
            ? { parentId: meta.parentId, index: ownIndex + 1, kind: 'between', anchorId: meta.id }
            : ratio > 0.72
              ? { parentId: meta.parentId, index: ownIndex, kind: 'between', anchorId: meta.id }
              : { parentId: meta.id, index: meta.childIds.length, kind: 'inside', anchorId: meta.id };
          if (!engine.canMoveLayer(props.dragId, target.parentId)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          props.setDropTarget(target);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (props.dropTarget) performDrop(props.dropTarget);
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
                anchorId={`before-${child.id}`}
                dropTarget={props.dropTarget}
                setDropTarget={props.setDropTarget}
                moveLayer={props.moveLayer}
              />
              <LayerNode {...props} id={child.id} />
            </Box>
          ))}
          <DropGap
            parentId={meta.id}
            index={0}
            dragId={props.dragId}
            anchorId={`end-${meta.id}`}
            dropTarget={props.dropTarget}
            setDropTarget={props.setDropTarget}
            moveLayer={props.moveLayer}
          />
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
  const [dropTarget, setDropTarget] = useState<LayerDropTarget | null>(null);
  const rowElements = useRef(new Map<string, HTMLElement>());
  const beforeMove = useRef<Map<string, DOMRect> | null>(null);
  const movedId = useRef<string | null>(null);
  const byId = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers]);
  const roots = engine.layerRootIds().map((id) => byId.get(id)).filter(Boolean) as LayerMeta[];
  const active = byId.get(activeId);
  const registerRow = (id: string, element: HTMLElement | null) => {
    if (element) rowElements.current.set(id, element);
    else rowElements.current.delete(id);
  };
  const moveLayer = (id: string, parentId: string | null, index: number) => {
    const previous = new Map(
      [...rowElements.current].map(([rowId, element]) => [rowId, element.getBoundingClientRect()]),
    );
    if (engine.moveLayer(id, { parentId, index })) {
      beforeMove.current = previous;
      movedId.current = id;
    } else {
      beforeMove.current = null;
      movedId.current = null;
    }
  };
  useLayoutEffect(() => {
    const previous = beforeMove.current;
    if (!previous) return;
    beforeMove.current = null;
    for (const [id, element] of rowElements.current) {
      const oldRect = previous.get(id);
      if (!oldRect) continue;
      const nextRect = element.getBoundingClientRect();
      const dx = oldRect.left - nextRect.left;
      const dy = oldRect.top - nextRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      element.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
    const moved = movedId.current ? rowElements.current.get(movedId.current) : null;
    movedId.current = null;
    moved?.animate(
      [{ filter: 'brightness(1.35)' }, { filter: 'brightness(1)' }],
      { duration: 520, easing: 'ease-out' },
    );
  }, [layers]);
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
              anchorId={`before-${root.id}`}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              moveLayer={moveLayer}
            />
            <LayerNode
              id={root.id}
              byId={byId}
              activeId={activeId}
              expanded={new Set(expandedPath)}
              setExpandedPath={setExpandedPath}
              dragId={dragId}
              setDragId={setDragId}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              registerRow={registerRow}
              moveLayer={moveLayer}
            />
          </Box>
        ))}
        <DropGap
          parentId={null}
          index={0}
          dragId={dragId}
          anchorId="root-end"
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
          moveLayer={moveLayer}
        />
      </Box>
      <Box sx={{ mt: 1 }}>
        <Button fullWidth onClick={() => engine.mergeLayerDown()} disabled={!engine.canMergeLayerDown()} sx={{ fontSize: 11 }}>
          下と統合
        </Button>
      </Box>
      {active && <LayerControlsPalette meta={active} />}
    </Box>
  );
}
