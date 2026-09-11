import { Box, Button, FormControl, MenuItem, Select, Stack, Switch, Typography } from '@mui/material';
import { commonLayerParameterDescriptors } from '../../engine/layerParameters';
import { STANDARD_FONTS } from '../../engine/text/render';
import { TRANSPARENT, type LayerMeta } from '../../model';
import { useStore } from '../../state/store';
import { useEngine } from '../EngineContext';
import { NumericField } from '../NumericField';

function sameValue(values: (number | string | boolean | null)[]) {
  if (!values.length || values.some(value => value === null)) return null;
  return values.every(value => Object.is(value, values[0])) ? values[0] : null;
}

export function MultiParameterControls({ layers }: { layers: LayerMeta[] }) {
  const engine = useEngine();
  const projectFonts = useStore(state => state.fonts);
  const descriptors = commonLayerParameterDescriptors(layers);
  if (!descriptors.length) return null;
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">共通パラメータ</Typography>
      {descriptors.map(descriptor => {
        const value = sameValue(layers.map(layer => descriptor.read(layer)));
        const commit = (next: number | string) => {
          engine.updateSelectedParameter(descriptor.key, next);
        };
        if (descriptor.control === 'switch') return (
          <Stack key={descriptor.key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>{descriptor.label}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {value === null ? '—' : value ? '表示' : '非表示'}
            </Typography>
            <Switch checked={value === true} onChange={event => {
              engine.updateSelectedParameter(descriptor.key, event.target.checked);
            }} />
          </Stack>
        );
        if (descriptor.control === 'number') return (
          <NumericField
            key={descriptor.key}
            size="small"
            label={descriptor.label}
            value={typeof value === 'number' ? value : null}
            min={descriptor.min}
            max={descriptor.max}
            onCommit={commit}
          />
        );
        if (descriptor.control === 'color') return (
          <Stack key={descriptor.key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
              {descriptor.label}{value === null ? ' —' : ''}
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
            <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>{descriptor.label}</Typography>
            <FormControl size="small" fullWidth>
              <Select
                displayEmpty
                aria-label={descriptor.label}
                value={typeof value === 'string' ? value : ''}
                onChange={event => commit(event.target.value)}
              >
                {value === null && <MenuItem value="" disabled>—</MenuItem>}
                {options.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
        );
      })}
    </Stack>
  );
}
