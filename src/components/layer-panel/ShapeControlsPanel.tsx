import {
  Box,
  Button,
  FormControl,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
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
  shapePanelNote,
} from '../../engine/shapes';
import { clampSizeMm, mmToPx, pxToMm, roundMm, SIZE_MM_MAX, SIZE_MM_MIN } from '../../engine/units';
import {
  TRANSPARENT,
  type LayerMeta,
  type ShapePaintMode,
  type ShapeParams,
  type ShapeStrokeJoin,
} from '../../model';
import { layerParameterDescriptors, parameterSemanticId } from '../../engine/layerParameters';
import { ParameterLinkIndicator } from './ParameterLinkIndicator';
import { linkedParameterColor } from './parameterLinkUi';

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
  semanticId,
}: {
  label: string;
  value: number;
  make: (value: number, shape: ShapeParams) => ShapeParams;
  meta: LayerMeta;
  min?: number;
  canvasLength?: boolean;
  semanticId: string;
}) {
  const engine = useEngine();
  const commit = (number: number) => {
    const shape = engine.getShape(meta.id);
    if (shape) engine.updateShapeParams(meta.id, shape, make(number, shape));
  };
  if (canvasLength) {
    return (
      <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', minWidth: 0 }}>
        <CanvasMmField
        size="small"
        label={label}
        valuePx={value}
        minPx={min}
        onCommitPx={commit}
        sx={{ minWidth: 0 }}
        />
        <ParameterLinkIndicator meta={meta} semanticId={semanticId} />
      </Stack>
    );
  }
  return (
    <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', minWidth: 0 }}>
      <NumericField
      size="small"
      label={label}
      value={Math.round(value * 10) / 10}
      min={min}
      onCommit={commit}
      sx={{ minWidth: 0 }}
      />
      <ParameterLinkIndicator meta={meta} semanticId={semanticId} />
    </Stack>
  );
}

export function ShapeControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const ppi = useStore(s => s.canvasSpec.ppi);
  const shape = meta.shape!;
  const fields = shapeControlFields(shape);
  const descriptors = layerParameterDescriptors(meta);
  const note = shapePanelNote(shape);
  const fillable = shapeFillable(shape);
  const strokeMm = pxToMm(shape.strokeWidth, ppi);

  const update = (make: (current: ShapeParams) => ShapeParams) => {
    const current = engine.getShape(meta.id);
    if (current) engine.updateShapeParams(meta.id, current, make(current));
  };
  return (
    <Stack spacing={1} sx={{ pt: 0.5 }}>
      <Stack spacing={0.25}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color={linkedParameterColor(meta, 'interaction.snap')} sx={{ width: 72, flex: 'none' }}>スナップ</Typography>
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
          <ParameterLinkIndicator meta={meta} semanticId="interaction.snap" />
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
            semanticId={parameterSemanticId(descriptors.find(descriptor =>
              descriptor.label === field.label || descriptor.label.startsWith(`${field.label} `),
            ) ?? descriptors[0])}
          />
        ))}
      </Box>
      {note && <Typography variant="caption" color="text.secondary">{note}</Typography>}
      {fillable && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color={linkedParameterColor(meta, 'shape.paintMode')} sx={{ width: 72, flex: 'none' }}>描画方式</Typography>
          <FormControl size="small" fullWidth>
            <Select
              value={shapePaintMode(shape)}
              onChange={event => update(current => setShapePaintMode(current, event.target.value as ShapePaintMode))}
            >
              {PAINT_MODES.map(mode => <MenuItem key={mode.value} value={mode.value}>{mode.label}</MenuItem>)}
            </Select>
          </FormControl>
          <ParameterLinkIndicator meta={meta} semanticId="shape.paintMode" />
        </Stack>
      )}
      {(shape.kind === 'rect' || shape.kind === 'polygon') && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color={linkedParameterColor(meta, 'appearance.cornerStyle')} sx={{ width: 72, flex: 'none' }}>線の角</Typography>
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
          <ParameterLinkIndicator meta={meta} semanticId="appearance.cornerStyle" />
        </Stack>
      )}
      {(shape.kind === 'rect' || shape.kind === 'polygon') && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color={linkedParameterColor(meta, 'shape.cornerRadiusMm')} sx={{ width: 72, flex: 'none' }}>角丸半径</Typography>
          <MmInlineControl
            valueMm={pxToMm(shape.cornerRadius ?? 0, ppi)}
            min={0}
            max={SIZE_MM_MAX}
            onPreview={mm => {
              const current = engine.getShape(meta.id);
              if (current?.kind === 'rect' || current?.kind === 'polygon') engine.updateShapeParams(meta.id, current, {
                ...current, cornerRadius: mmToPx(Math.max(0, roundMm(mm)), ppi),
              }, true);
            }}
            onCommit={(before, after) => {
              const current = engine.getShape(meta.id);
              if (current?.kind === 'rect' || current?.kind === 'polygon') engine.updateShapeParams(meta.id,
                { ...current, cornerRadius: mmToPx(Math.max(0, roundMm(before)), ppi) },
                { ...current, cornerRadius: mmToPx(Math.max(0, roundMm(after)), ppi) });
            }}
          />
          <ParameterLinkIndicator meta={meta} semanticId="shape.cornerRadiusMm" />
        </Stack>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color={linkedParameterColor(meta, 'appearance.widthMm')} sx={{ width: 72, flex: 'none' }}>
          {shapePaintMode(shape) === 'stroke' ? '線の太さ' : '線幅'}
        </Typography>
        <MmInlineControl
          valueMm={strokeMm}
          min={SIZE_MM_MIN}
          max={SIZE_MM_MAX}
          onPreview={mm => {
            const next = clampSizeMm(roundMm(mm));
            const current = engine.getShape(meta.id);
            if (current) engine.updateShapeParams(meta.id, current, { ...current, strokeWidth: mmToPx(next, ppi) }, true);
          }}
          onCommit={(before, after) => {
            const current = engine.getShape(meta.id);
            if (!current) return;
            engine.updateShapeParams(meta.id,
              { ...current, strokeWidth: mmToPx(clampSizeMm(roundMm(before)), ppi) },
              { ...current, strokeWidth: mmToPx(clampSizeMm(roundMm(after)), ppi) });
          }}
        />
        <ParameterLinkIndicator meta={meta} semanticId="appearance.widthMm" />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color={linkedParameterColor(meta, 'appearance.color')} sx={{ width: 72, flex: 'none' }}>色</Typography>
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
        <ParameterLinkIndicator meta={meta} semanticId="appearance.color" />
      </Stack>
      <Button fullWidth onClick={() => engine.transferShapeLayer()} disabled={!meta.canTransferShape}>親へ転写</Button>
    </Stack>
  );
}
