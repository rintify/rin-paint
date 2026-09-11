import { Box, Button, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useEngine } from '../EngineContext';
import { NumericField } from '../NumericField';
import { TRANSPARENT, type LayerMeta, type ShapeParams } from '../../model';

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
  const engine = useEngine();
  return (
    <NumericField
      size="small"
      label={label}
      value={Math.round(value * 10) / 10}
      onCommit={(number) => {
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
  if (shape.kind !== 'line') {
    field('回転', ((shape.rotation ?? 0) * 180) / Math.PI, (v, s) => ({ ...s, rotation: (v * Math.PI) / 180 } as ShapeParams));
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
        disabled={!meta.canTransferShape}
      >
        親へ転写
      </Button>
    </Stack>
  );
}

export function MultiShapeControls({ shapes }: { shapes: ShapeParams[] }) {
  const engine = useEngine();
  const common = (read: (shape: ShapeParams) => number): number | null => {
    const value = read(shapes[0]);
    return shapes.every(shape => read(shape) === value) ? value : null;
  };
  const field = (
    label: string,
    read: (shape: ShapeParams) => number,
    update: (shape: ShapeParams, value: number) => ShapeParams,
    min?: number,
  ) => (
    <NumericField
      key={label}
      size="small"
      label={label}
      value={common(read)}
      min={min}
      onCommit={value => engine.updateSelectedShapes(shape => update(shape, value))}
    />
  );
  const kind = shapes.every(shape => shape.kind === shapes[0].kind) ? shapes[0].kind : null;
  const color = shapes.every(shape => shape.color === shapes[0].color) ? shapes[0].color : null;
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">図形の共通設定</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        {field('線の太さ', s => (s.kind === 'line' ? s.width : s.strokeWidth), (s, v) => (s.kind === 'line' ? { ...s, width: v } : { ...s, strokeWidth: v }), 1)}
        {field(
          '回転 (度)',
          s => ((s.kind === 'line' ? Math.atan2(s.y2 - s.y1, s.x2 - s.x1) : s.rotation ?? 0) * 180) / Math.PI,
          (s, v) => {
            if (s.kind !== 'line') return { ...s, rotation: (v * Math.PI) / 180 };
            const x = (s.x1 + s.x2) / 2;
            const y = (s.y1 + s.y2) / 2;
            const half = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 2;
            const dx = half * Math.cos((v * Math.PI) / 180);
            const dy = half * Math.sin((v * Math.PI) / 180);
            return { ...s, x1: x - dx, y1: y - dy, x2: x + dx, y2: y + dy };
          },
        )}
        {kind === 'rect' && (
          <>
            {field('X', s => (s.kind === 'rect' ? s.x : 0), (s, v) => (s.kind === 'rect' ? { ...s, x: v } : s))}
            {field('Y', s => (s.kind === 'rect' ? s.y : 0), (s, v) => (s.kind === 'rect' ? { ...s, y: v } : s))}
            {field('幅', s => (s.kind === 'rect' ? s.width : 0), (s, v) => (s.kind === 'rect' ? { ...s, width: v } : s), 0.1)}
            {field('高さ', s => (s.kind === 'rect' ? s.height : 0), (s, v) => (s.kind === 'rect' ? { ...s, height: v } : s), 0.1)}
          </>
        )}
        {kind === 'ellipse' && (
          <>
            {field('中心 X', s => (s.kind === 'ellipse' ? s.cx : 0), (s, v) => (s.kind === 'ellipse' ? { ...s, cx: v } : s))}
            {field('中心 Y', s => (s.kind === 'ellipse' ? s.cy : 0), (s, v) => (s.kind === 'ellipse' ? { ...s, cy: v } : s))}
            {field('横半径', s => (s.kind === 'ellipse' ? s.rx : 0), (s, v) => (s.kind === 'ellipse' ? { ...s, rx: v } : s), 0.1)}
            {field('縦半径', s => (s.kind === 'ellipse' ? s.ry : 0), (s, v) => (s.kind === 'ellipse' ? { ...s, ry: v } : s), 0.1)}
          </>
        )}
      </Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption">線の色{color === null ? ' —' : ''}</Typography>
        <input
          aria-label="共通の線の色"
          type="color"
          value={color && color !== TRANSPARENT ? color : '#ffffff'}
          onChange={event => engine.updateSelectedShapes(s => ({ ...s, color: event.target.value }))}
        />
        <Button
          size="small"
          variant={color === TRANSPARENT ? 'contained' : 'outlined'}
          onClick={() => engine.updateSelectedShapes(s => ({ ...s, color: TRANSPARENT }))}
        >
          透明
        </Button>
      </Stack>
    </Stack>
  );
}
