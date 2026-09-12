import { FormControl, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useEngine } from '../EngineContext';
import type { LayerMeta, OutlineParams } from '../../model';
import { SliderField } from '../SliderField';
import { ParameterLinkIndicator } from './ParameterLinkIndicator';
import { linkedParameterColor } from './parameterLinkUi';
import { LabeledControl } from '../inspectorLayout';
import { ColorField } from '../ColorField';

export function OutlineControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const outline = meta.outline!;
  const commit = (before: OutlineParams, after: OutlineParams, label: string) =>
    engine.commitLayerProps(meta.id, { outline: before }, { outline: after }, label);
  return (
    <Stack spacing={1.5}>
      <ColorField
        label="縁の色"
        labelColor={linkedParameterColor(meta, 'appearance.color')}
        value={outline.color}
        trailing={<ParameterLinkIndicator meta={meta} semanticId="appearance.color" />}
        onChange={color => commit(outline, { ...outline, color }, '縁の色')}
      />
      <LabeledControl label="縁の角" color={linkedParameterColor(meta, 'appearance.cornerStyle')}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <FormControl size="small" fullWidth>
            <Select
              value={outline.cornerStyle ?? 'round'}
              onChange={event => commit(outline, { ...outline, cornerStyle: event.target.value as 'round' | 'sharp' }, '縁の角')}
              inputProps={{ 'aria-label': '縁の角' }}
            >
              <MenuItem value="round">丸</MenuItem>
              <MenuItem value="sharp">角</MenuItem>
            </Select>
          </FormControl>
          <ParameterLinkIndicator meta={meta} semanticId="appearance.cornerStyle" />
        </Stack>
      </LabeledControl>
      <SliderField
        label="太さ"
        value={outline.widthMm}
        min={0.01}
        max={20}
        unit="mm"
        scale="mm"
        color={linkedParameterColor(meta, 'appearance.widthMm')}
        trailing={<ParameterLinkIndicator meta={meta} semanticId="appearance.widthMm" />}
        onPreview={value => engine.previewLayerProps(meta.id, { outline: { ...outline, widthMm: value } })}
        onCommit={(before, after) => commit(
          { ...outline, widthMm: before ?? outline.widthMm },
          { ...outline, widthMm: after },
          '縁の太さ',
        )}
      />
      <SliderField
        label="閾値"
        value={Math.round(outline.alphaThreshold * 100)}
        min={0}
        max={100}
        unit="%"
        color={linkedParameterColor(meta, 'outline.alphaThreshold')}
        trailing={<ParameterLinkIndicator meta={meta} semanticId="outline.alphaThreshold" />}
        onPreview={value => engine.previewLayerProps(meta.id, { outline: { ...outline, alphaThreshold: value / 100 } })}
        onCommit={(before, after) => commit(
          { ...outline, alphaThreshold: (before ?? outline.alphaThreshold * 100) / 100 },
          { ...outline, alphaThreshold: after / 100 },
          '縁どりの透明度閾値',
        )}
      />
      <Typography variant="caption" color="text.secondary">
        閾値以上のアルファから外側の縁を作り、半透明部分の下にも縁色を敷きます。
      </Typography>
    </Stack>
  );
}
