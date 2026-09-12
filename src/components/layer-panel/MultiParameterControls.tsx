import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import { Box, Button, FormControl, IconButton, MenuItem, Select, Stack, Switch, Tooltip, Typography } from '@mui/material';
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
      {descriptors.map(descriptor => {
        const shared = sharedValue(layers.map(layer => descriptor.read(layer)));
        const value = shared.value;
        const semanticId = parameterSemanticId(descriptor);
        const linkedLayers = layers.filter(layer => layer.parameterLink?.linkedParameterIds.includes(semanticId));
        const linkedCount = linkedLayers.length;
        const linkState = linkedCount === 0 ? 'none' : linkedCount === layers.length ? 'all' : 'mixed';
        const label = descriptor.label;
        const labelColor = linkState === 'all' ? 'secondary' : linkState === 'mixed' ? 'warning.main' : 'text.secondary';
        const relinkable = layers.filter(layer => layer.parameterLink
          && layer.compatibleLinkParameterIds?.includes(semanticId)
          && !layer.parameterLink.linkedParameterIds.includes(semanticId));
        const indicatorSx = {
          width: 24, height: 24, minWidth: 24, p: 0, flex: '0 0 24px',
          boxSizing: 'border-box', border: '1px solid transparent',
        } as const;
        const linkIndicator = linkedLayers.length ? (
          <Tooltip title={linkState === 'mixed' ? `${linkedLayers.length}レイヤーのリンクを解除` : 'クリックしてリンクを解除'}>
            <IconButton
              disableRipple
              aria-label={`${descriptor.label}のリンクを解除`}
              sx={{ ...indicatorSx, color: linkState === 'mixed' ? 'warning.main' : 'secondary.main' }}
              onClick={() => engine.unlinkLayerParameters(linkedLayers.map(layer => layer.id), semanticId)}
            ><LinkIcon fontSize="small" /></IconButton>
          </Tooltip>
        ) : relinkable.length ? (
          <Tooltip title={`${relinkable.length}レイヤーをそれぞれのリンク元へ再リンク`}>
            <IconButton disableRipple aria-label={`${descriptor.label}を再リンク`} sx={{ ...indicatorSx, color: 'text.disabled', borderStyle: 'dashed', borderColor: 'text.disabled' }} onClick={() => void Promise.all(
              relinkable.map(layer => engine.relinkLayerParameter(layer.id, semanticId)),
            )}><LinkOffIcon fontSize="small" /></IconButton>
          </Tooltip>
        ) : null;
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
            {linkIndicator}
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
                  onPreview={mm => engine.previewSelectedParameter(descriptor.key, mmToPx(clampSizeMm(roundMm(mm)), ppi))}
                  onCommit={(before, after) => engine.commitSelectedParameterPreview(
                    descriptor.key,
                    mmToPx(clampSizeMm(roundMm(before)), ppi),
                    mmToPx(clampSizeMm(roundMm(after)), ppi),
                  )}
                />
              )}
              {linkIndicator}
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
            <Stack key={descriptor.key} direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
            <CanvasMmField
              size="small"
              label={label}
              valuePx={value}
              minPx={descriptor.min}
              onCommitPx={commit}
            />
            {linkIndicator}
            </Stack>
          );
        }
        if (descriptor.control === 'number') return (
          <Stack key={descriptor.key} direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
          <NumericField
            size="small"
            label={label}
            value={typeof value === 'number' ? value : null}
            min={descriptor.min}
            max={descriptor.max}
            onCommit={commit}
          />
          {linkIndicator}
          </Stack>
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
            {linkIndicator}
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
            {linkIndicator}
          </Stack>
        );
      })}
    </Stack>
  );
}
