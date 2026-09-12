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
  Switch,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useEngine } from '../EngineContext';
import { CanvasMmField } from '../CanvasMmField';
import { MmInlineControl } from '../MmControl';
import { NumericField } from '../NumericField';
import { useStore } from '../../state/store';
import {
  setShapePaintMode,
  shapeControlFields,
  shapeFillable,
  shapePaintMode,
  shapeStrokeJoin,
  shapePanelActions,
  shapePanelNote,
  type ShapePanelAction,
} from '../../engine/shapes';
import { clampSizeMm, mmToPx, pxToMm, roundMm, SIZE_MM_MAX, SIZE_MM_MIN } from '../../engine/units';
import {
  TRANSPARENT,
  type LayerMeta,
  type ShapePaintMode,
  type ShapeParams,
  type ShapeStrokeJoin,
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
  canvasLength,
}: {
  label: string;
  value: number;
  make: (value: number, shape: ShapeParams) => ShapeParams;
  meta: LayerMeta;
  min?: number;
  canvasLength?: boolean;
}) {
  const engine = useEngine();
  const commit = (number: number) => {
    const shape = engine.getShape(meta.id);
    if (shape) engine.updateShapeParams(meta.id, shape, make(number, shape));
  };
  if (canvasLength) {
    return (
      <CanvasMmField
        size="small"
        label={label}
        valuePx={value}
        minPx={min}
        onCommitPx={commit}
        sx={{ minWidth: 0 }}
      />
    );
  }
  return (
    <NumericField
      size="small"
      label={label}
      value={Math.round(value * 10) / 10}
      min={min}
      onCommit={commit}
      sx={{ minWidth: 0 }}
    />
  );
}

export function ShapeControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const ppi = useStore(s => s.canvasSpec.ppi);
  const shape = meta.shape!;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const fields = shapeControlFields(shape);
  const note = shapePanelNote(shape);
  const actions = shapePanelActions(shape);
  const fillable = shapeFillable(shape);
  const strokeMm = pxToMm(shape.strokeWidth, ppi);

  const update = (make: (current: ShapeParams) => ShapeParams) => {
    const current = engine.getShape(meta.id);
    if (current) engine.updateShapeParams(meta.id, current, make(current));
  };
  const runAction = (action: ShapePanelAction) => {
    setMenuAnchor(null);
    if (action.id === 'convertToPolygon') engine.convertRectToPolygon(meta.id);
  };
  return (
    <Stack spacing={1} sx={{ pt: 0.5 }}>
      <Stack spacing={0.25}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>スナップ</Typography>
          <Switch
            checked={meta.snapEnabled !== false}
            onChange={event => engine.commitLayerProps(
              meta.id,
              { snapEnabled: meta.snapEnabled !== false },
              { snapEnabled: event.target.checked },
              'スナップを変更',
            )}
            slotProps={{ input: { 'aria-label': 'スナップ' } }}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary">移動の端・中央、90°回転、多角形の頂点・縦横ライン</Typography>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
        {fields.map(field => (
          <ShapeNumber
            key={field.label}
            label={field.label}
            value={field.value}
            make={field.make}
            meta={meta}
            min={field.min}
            canvasLength={field.canvasLength}
          />
        ))}
      </Box>
      {note && <Typography variant="caption" color="text.secondary">{note}</Typography>}
      {fillable && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>描画方式</Typography>
          <FormControl size="small" fullWidth>
            <Select
              value={shapePaintMode(shape)}
              onChange={event => update(current => setShapePaintMode(current, event.target.value as ShapePaintMode))}
            >
              {PAINT_MODES.map(mode => <MenuItem key={mode.value} value={mode.value}>{mode.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      )}
      {(shape.kind === 'rect' || shape.kind === 'polygon') && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>線の角</Typography>
          <FormControl size="small" fullWidth>
            <Select
              value={shapeStrokeJoin(shape)}
              onChange={event => update(current => ({ ...current, strokeJoin: event.target.value as ShapeStrokeJoin }))}
              inputProps={{ 'aria-label': '線の角' }}
            >
              <MenuItem value="round">丸</MenuItem>
              <MenuItem value="miter">角</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      )}
      {(shape.kind === 'rect' || shape.kind === 'polygon') && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>角丸半径</Typography>
          <MmInlineControl
            valueMm={pxToMm(shape.cornerRadius ?? 0, ppi)}
            min={0}
            max={SIZE_MM_MAX}
            onChange={mm => update(current => current.kind === 'rect' || current.kind === 'polygon'
              ? { ...current, cornerRadius: mmToPx(Math.max(0, roundMm(mm)), ppi) }
              : current)}
          />
        </Stack>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
          {shapePaintMode(shape) === 'stroke' ? '線の太さ' : '線幅'}
        </Typography>
        <MmInlineControl
          valueMm={strokeMm}
          min={SIZE_MM_MIN}
          max={SIZE_MM_MAX}
          onChange={mm => {
            const next = clampSizeMm(roundMm(mm));
            update(current => ({ ...current, strokeWidth: mmToPx(next, ppi) }));
          }}
        />
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
        {actions.length > 0 && (
          <IconButton aria-label="図形のその他の操作" onClick={event => setMenuAnchor(event.currentTarget)}>
            <MoreVertIcon />
          </IconButton>
        )}
      </Stack>
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        {actions.map(action => (
          <MenuItem key={action.id} onClick={() => runAction(action)}>
            {action.label}
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  );
}
