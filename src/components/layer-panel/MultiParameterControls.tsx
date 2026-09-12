import { Box, Button, FormControl, MenuItem, Select, Stack, Switch, Typography } from '@mui/material';
import { commonLayerParameterDescriptors, parameterSemanticId } from '../../engine/layerParameters';
import { STANDARD_FONTS } from '../../engine/text/render';
import { clampSizeMm, mmToPx, pxToMm, roundMm, SIZE_MM_MAX, SIZE_MM_MIN } from '../../engine/units';
import { TRANSPARENT, type LayerMeta } from '../../model';
import { useStore } from '../../state/store';
import { useEngine } from '../EngineContext';
import { CanvasMmField } from '../CanvasMmField';
import { MmInlineControl } from '../MmControl';
import { NumericField } from '../NumericField';

function sharedValue(values: (number | string | boolean | null)[]) {
  if (!values.length) return { mixed: true, value: null };
  return values.every(value => Object.is(value, values[0]))
    ? { mixed: false, value: values[0] }
    : { mixed: true, value: null };
}

export function MultiParameterControls({ layers }: { layers: LayerMeta[] }) {
  const engine = useEngine();
  const projectFonts = useStore(state => state.fonts);
  const ppi = useStore(state => state.canvasSpec.ppi);
  const descriptors = commonLayerParameterDescriptors(layers, ppi);
  if (!descriptors.length) return null;
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">共通パラメータ</Typography>
      {layers.some(layer => !!layer.parameterLink) && (
        <Button
          size="small"
          variant="outlined"
          onClick={() => void Promise.all(layers.filter(layer => !!layer.parameterLink).map(layer => engine.relinkAllLayerParameters(layer.id)))}
        >
          各リンク元へ再リンク
        </Button>
      )}
      {descriptors.map(descriptor => {
        const shared = sharedValue(layers.map(layer => descriptor.read(layer)));
        const value = shared.value;
        const semanticId = parameterSemanticId(descriptor);
        const linkedCount = layers.filter(layer => layer.parameterLink?.linkedParameterIds.includes(semanticId)).length;
        const linkState = linkedCount === 0 ? 'none' : linkedCount === layers.length ? 'all' : 'mixed';
        const label = `${descriptor.label}${linkState === 'all' ? ' 🔗' : linkState === 'mixed' ? ' ◐' : ''}`;
        const labelColor = linkState === 'all' ? 'primary' : linkState === 'mixed' ? 'warning.main' : 'text.secondary';
        const commit = (next: number | string) => {
          engine.updateSelectedParameter(descriptor.key, next);
        };
        if (descriptor.control === 'switch') return (
          <Stack key={descriptor.key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="caption" color={labelColor} sx={{ width: 72, flex: 'none' }}>{label}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {shared.mixed ? '—' : value ? (descriptor.trueLabel ?? '表示') : (descriptor.falseLabel ?? '非表示')}
            </Typography>
            <Switch
              checked={value === true}
              onChange={event => {
                engine.updateSelectedParameter(descriptor.key, event.target.checked);
              }}
              slotProps={{ input: { 'aria-label': descriptor.label } }}
            />
          </Stack>
        );
        if (descriptor.control === 'number' && descriptor.canvasLength && descriptor.key === 'strokeWidth') {
          const strokeMm = typeof value === 'number' ? pxToMm(value, ppi) : null;
          return (
            <Stack key={descriptor.key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
                {label} (mm){shared.mixed ? ' —' : ''}
              </Typography>
              {strokeMm === null ? (
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>—</Typography>
              ) : (
                <MmInlineControl
                  valueMm={strokeMm}
                  min={SIZE_MM_MIN}
                  max={SIZE_MM_MAX}
                  onChange={mm => commit(mmToPx(clampSizeMm(roundMm(mm)), ppi))}
                />
              )}
            </Stack>
          );
        }
        if (descriptor.control === 'number' && descriptor.canvasLength) {
          if (typeof value !== 'number') {
            return (
              <Stack key={descriptor.key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="caption" color={labelColor} sx={{ width: 72 }}>{label}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {!shared.mixed && descriptor.nullable ? '自動' : '—'}
                </Typography>
              </Stack>
            );
          }
          return (
            <CanvasMmField
              key={descriptor.key}
              size="small"
              label={label}
              valuePx={value}
              minPx={descriptor.min}
              onCommitPx={commit}
            />
          );
        }
        if (descriptor.control === 'number') return (
          <NumericField
            key={descriptor.key}
            size="small"
            label={label}
            value={typeof value === 'number' ? value : null}
            min={descriptor.min}
            max={descriptor.max}
            onCommit={commit}
          />
        );
        if (descriptor.control === 'color') return (
          <Stack key={descriptor.key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
              {label}{shared.mixed ? ' —' : ''}
            </Typography>
            <Box
              component="input"
              aria-label={`共通の${descriptor.label}`}
              type="color"
              value={typeof value === 'string' && value !== TRANSPARENT ? value : '#ffffff'}
              onChange={event => commit(event.target.value)}
              sx={{ minWidth: 0, flex: 1, height: 34 }}
            />
            {descriptor.allowTransparent && (
              <Button size="small" variant={value === TRANSPARENT ? 'contained' : 'outlined'} onClick={() => commit(TRANSPARENT)}>透明</Button>
            )}
          </Stack>
        );
        const options = descriptor.key === 'fontId'
          ? [...STANDARD_FONTS, ...projectFonts].map(font => ({ value: font.id, label: font.name }))
          : descriptor.options ?? [];
        return (
          <Stack key={descriptor.key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="caption" color={labelColor} sx={{ width: 72, flex: 'none' }}>{label}</Typography>
            <FormControl size="small" fullWidth>
              <Select
                displayEmpty
                aria-label={descriptor.label}
                value={typeof value === 'string' ? value : ''}
                onChange={event => commit(event.target.value)}
              >
                {shared.mixed && <MenuItem value="" disabled>—</MenuItem>}
                {options.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
        );
      })}
    </Stack>
  );
}
