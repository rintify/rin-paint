import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import { FormControl, IconButton, MenuItem, Select, Stack, Switch, Tooltip, Typography } from '@mui/material';
import { commonLayerParameterDescriptors, parameterSemanticId } from '../../engine/layerParameters';
import { STANDARD_FONTS } from '../../engine/text/render';
import { clampSizeMm, mmToPx, pxToMm, roundMm, SIZE_MM_MAX, SIZE_MM_MIN } from '../../engine/units';
import type { LayerMeta } from '../../model';
import { useStore } from '../../state/store';
import { useEngine } from '../EngineContext';
import { CanvasMmField } from '../CanvasMmField';
import { SliderField } from '../SliderField';
import { NumericField } from '../NumericField';
import { ColorField } from '../ColorField';
import { LabeledControl } from '../inspectorLayout';

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
    <Stack spacing={1.5}>
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
          width: 28, height: 28, p: 0.25,
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
            <IconButton disableRipple aria-label={`${descriptor.label}を再リンク`} sx={{ ...indicatorSx, color: 'text.secondary', opacity: 0.55 }} onClick={() => void Promise.all(
              relinkable.map(layer => engine.relinkLayerParameter(layer.id, semanticId)),
            )}><LinkOffIcon fontSize="small" /></IconButton>
          </Tooltip>
        ) : null;
        const commit = (next: number | string) => {
          engine.updateSelectedParameter(descriptor.key, next);
        };
        if (descriptor.control === 'switch') return (
          <LabeledControl key={descriptor.key} label={label} color={labelColor}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
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
          </LabeledControl>
        );
        if (descriptor.control === 'number' && descriptor.canvasLength && descriptor.key === 'strokeWidth') {
          const strokeMm = typeof value === 'number' ? pxToMm(value, ppi) : null;
          return (
            <SliderField
              key={descriptor.key}
              label={label}
              value={strokeMm}
              min={SIZE_MM_MIN}
              max={SIZE_MM_MAX}
              unit="mm"
              scale="mm"
              color={labelColor}
              trailing={linkIndicator}
              onPreview={mm => engine.previewSelectedParameter(descriptor.key, mmToPx(clampSizeMm(roundMm(mm)), ppi))}
              onCommit={(before, after) => engine.commitSelectedParameterPreview(
                descriptor.key,
                mmToPx(clampSizeMm(roundMm(before ?? after)), ppi),
                mmToPx(clampSizeMm(roundMm(after)), ppi),
              )}
            />
          );
        }
        if (descriptor.control === 'number' && descriptor.canvasLength) {
          if (!shared.mixed && descriptor.nullable && value === null) {
            return (
              <Typography key={descriptor.key} variant="body2" color="text.secondary">
                {label}: 自動
              </Typography>
            );
          }
          return (
            <CanvasMmField
              key={descriptor.key}
              size="small"
              label={label}
              valuePx={typeof value === 'number' ? value : null}
              minPx={descriptor.min}
              onCommitPx={commit}
              trailing={linkIndicator}
              labelColor={labelColor}
            />
          );
        }
        if (descriptor.control === 'number') return (
          <NumericField
            key={descriptor.key}
            size="small"
            fullWidth
            label={label}
            value={typeof value === 'number' ? value : null}
            min={descriptor.min}
            max={descriptor.max}
            onCommit={commit}
            trailing={linkIndicator}
            labelColor={labelColor}
          />
        );
        if (descriptor.control === 'color') return (
          <ColorField
            key={descriptor.key}
            label={label}
            labelColor={labelColor}
            value={typeof value === 'string' ? value : null}
            allowTransparent={descriptor.allowTransparent}
            trailing={linkIndicator}
            onChange={commit}
          />
        );
        const options = descriptor.key === 'fontId'
          ? [...STANDARD_FONTS, ...projectFonts].map(font => ({ value: font.id, label: font.name }))
          : descriptor.options ?? [];
        return (
          <LabeledControl key={descriptor.key} label={label} color={labelColor}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
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
          </LabeledControl>
        );
      })}
    </Stack>
  );
}
