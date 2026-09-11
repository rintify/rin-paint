import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Box,
  Button,
  FormControl,
  IconButton,
  Menu,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { useEngine } from '../EngineContext';
import { NumericField } from '../NumericField';
import {
  TRANSPARENT,
  type LayerMeta,
  type ShapePaintMode,
  type ShapeParams,
} from '../../model';

const PAINT_MODES: { value: ShapePaintMode; label: string }[] = [
  { value: 'stroke', label: '輪郭' },
  { value: 'fill-inside', label: '内側塗りつぶし' },
  { value: 'fill-outside', label: '外側塗りつぶし' },
];

function ShapeNumber({
  label,
  value,
  make,
  meta,
  min,
}: {
  label: string;
  value: number;
  make: (value: number, shape: ShapeParams) => ShapeParams;
  meta: LayerMeta;
  min?: number;
}) {
  const engine = useEngine();
  return (
    <NumericField
      size="small"
      label={label}
      value={Math.round(value * 10) / 10}
      min={min}
      onCommit={number => {
        const shape = engine.getShape(meta.id);
        if (shape) engine.updateShapeParams(meta.id, shape, make(number, shape));
      }}
      sx={{ minWidth: 0 }}
    />
  );
}

export function ShapeControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const shape = meta.shape!;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const fields: ReactNode[] = [];
  const field = (
    label: string,
    value: number,
    make: (value: number, shape: ShapeParams) => ShapeParams,
    min?: number,
  ) => fields.push(
    <ShapeNumber key={label} label={label} value={value} make={make} meta={meta} min={min} />,
  );

  if (shape.kind === 'line') {
    field('開始 X', shape.x1, (v, s) => s.kind === 'line' ? { ...s, x1: v } : s);
    field('開始 Y', shape.y1, (v, s) => s.kind === 'line' ? { ...s, y1: v } : s);
    field('終了 X', shape.x2, (v, s) => s.kind === 'line' ? { ...s, x2: v } : s);
    field('終了 Y', shape.y2, (v, s) => s.kind === 'line' ? { ...s, y2: v } : s);
    const length = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
    const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
    field('長さ', length, (v, s) => s.kind === 'line' ? {
      ...s,
      x2: s.x1 + Math.max(0, v) * Math.cos(angle),
      y2: s.y1 + Math.max(0, v) * Math.sin(angle),
    } : s, 0);
    field('角度', angle * 180 / Math.PI, (v, s) => s.kind === 'line' ? {
      ...s,
      x2: s.x1 + length * Math.cos(v * Math.PI / 180),
      y2: s.y1 + length * Math.sin(v * Math.PI / 180),
    } : s);
  } else if (shape.kind === 'rect') {
    field('X', shape.x, (v, s) => s.kind === 'rect' ? { ...s, x: v } : s);
    field('Y', shape.y, (v, s) => s.kind === 'rect' ? { ...s, y: v } : s);
    field('幅', shape.width, (v, s) => s.kind === 'rect' ? { ...s, width: Math.max(.1, v) } : s, .1);
    field('高さ', shape.height, (v, s) => s.kind === 'rect' ? { ...s, height: Math.max(.1, v) } : s, .1);
  } else if (shape.kind === 'ellipse') {
    field('中心 X', shape.cx, (v, s) => s.kind === 'ellipse' ? { ...s, cx: v } : s);
    field('中心 Y', shape.cy, (v, s) => s.kind === 'ellipse' ? { ...s, cy: v } : s);
    field('横半径', shape.rx, (v, s) => s.kind === 'ellipse' ? { ...s, rx: Math.max(.1, v) } : s, .1);
    field('縦半径', shape.ry, (v, s) => s.kind === 'ellipse' ? { ...s, ry: Math.max(.1, v) } : s, .1);
  } else {
    field('中心 X', shape.cx, (v, s) => s.kind === 'polygon' ? { ...s, cx: v } : s);
    field('中心 Y', shape.cy, (v, s) => s.kind === 'polygon' ? { ...s, cy: v } : s);
  }
  if (shape.kind !== 'line') {
    field('回転', (shape.rotation ?? 0) * 180 / Math.PI, (v, s) => s.kind === 'line' ? s : { ...s, rotation: v * Math.PI / 180 });
  }

  const update = (make: (current: ShapeParams) => ShapeParams) => {
    const current = engine.getShape(meta.id);
    if (current) engine.updateShapeParams(meta.id, current, make(current));
  };
  return (
    <Stack spacing={1} sx={{ pt: 0.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>{fields}</Box>
      {shape.kind === 'polygon' && (
        <Typography variant="caption" color="text.secondary">頂点数: {shape.points.length}</Typography>
      )}
      {shape.kind !== 'line' && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>描画方式</Typography>
          <FormControl size="small" fullWidth>
            <Select
              value={shape.paintMode ?? 'stroke'}
              onChange={event => update(current => current.kind === 'line' ? current : { ...current, paintMode: event.target.value as ShapePaintMode })}
            >
              {PAINT_MODES.map(mode => <MenuItem key={mode.value} value={mode.value}>{mode.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
          {shape.kind === 'line' || (shape.paintMode ?? 'stroke') === 'stroke' ? '線の太さ' : '線幅'}
        </Typography>
        <ShapeNumber label="px" value={shape.strokeWidth} make={(value, current) => ({ ...current, strokeWidth: Math.max(1, value) })} meta={meta} min={1} />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>色</Typography>
        <Box
          component="input"
          type="color"
          value={shape.color === TRANSPARENT ? '#ffffff' : shape.color}
          onChange={event => update(current => ({ ...current, color: event.target.value }))}
          sx={{ minWidth: 0, flex: 1, height: 34, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover', p: 0.5 }}
        />
        <Button size="small" variant={shape.color === TRANSPARENT ? 'contained' : 'outlined'} onClick={() => update(current => ({ ...current, color: TRANSPARENT }))}>
          透明
        </Button>
      </Stack>
      <Stack direction="row" spacing={1}>
        <Button fullWidth onClick={() => engine.transferShapeLayer()} disabled={!meta.canTransferShape}>親へ転写</Button>
        {shape.kind === 'rect' && (
          <IconButton aria-label="図形のその他の操作" onClick={event => setMenuAnchor(event.currentTarget)}>
            <MoreVertIcon />
          </IconButton>
        )}
      </Stack>
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => { setMenuAnchor(null); engine.convertRectToPolygon(meta.id); }}>
          多角形に変換
        </MenuItem>
      </Menu>
    </Stack>
  );
}
