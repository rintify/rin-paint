import { Box, FormControl, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useEngine } from '../EngineContext';
import type { LayerMeta, OutlineParams } from '../../model';
import { CommitSlider } from './CommitSlider';
import { MmInlineControl } from '../MmControl';
import { ParameterLinkIndicator } from './ParameterLinkIndicator';
import { linkedParameterColor } from './parameterLinkUi';

export function OutlineControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const outline = meta.outline!;
  const commit = (before: OutlineParams, after: OutlineParams, label: string) =>
    engine.commitLayerProps(meta.id, { outline: before }, { outline: after }, label);
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color={linkedParameterColor(meta, 'appearance.color')} sx={{ width: 72, flex: 'none' }}>縁の色</Typography>
        <Box
          component="input"
          type="color"
          aria-label="縁の色"
          value={outline.color}
          onChange={event => commit(outline, { ...outline, color: event.target.value }, '縁の色')}
          sx={{ minWidth: 0, flex: 1, height: 34 }}
        />
        <ParameterLinkIndicator meta={meta} semanticId="appearance.color" />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color={linkedParameterColor(meta, 'appearance.cornerStyle')} sx={{ width: 72, flex: 'none' }}>縁の角</Typography>
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
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color={linkedParameterColor(meta, 'appearance.widthMm')} sx={{ width: 72, flex: 'none' }}>太さ (mm)</Typography>
        <MmInlineControl
          valueMm={outline.widthMm}
          min={0.01}
          max={20}
          onPreview={value => engine.previewLayerProps(meta.id, { outline: { ...outline, widthMm: value } })}
          onCommit={(before, after) => commit(
            { ...outline, widthMm: before },
            { ...outline, widthMm: after },
            '縁の太さ',
          )}
        />
        <ParameterLinkIndicator meta={meta} semanticId="appearance.widthMm" />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color={linkedParameterColor(meta, 'outline.alphaThreshold')} sx={{ width: 72, flex: 'none' }}>閾値</Typography>
        <CommitSlider
          value={Math.round(outline.alphaThreshold * 100)}
          min={0}
          max={100}
          onPreview={value => engine.previewLayerProps(meta.id, { outline: { ...outline, alphaThreshold: value / 100 } })}
          onCommit={(before, after) => commit(
            { ...outline, alphaThreshold: (before ?? outline.alphaThreshold * 100) / 100 },
            { ...outline, alphaThreshold: after / 100 },
            '縁どりの透明度閾値',
          )}
        />
        <Typography variant="body2" color="text.secondary" sx={{ width: 34, textAlign: 'right' }}>
          {Math.round(outline.alphaThreshold * 100)}%
        </Typography>
        <ParameterLinkIndicator meta={meta} semanticId="outline.alphaThreshold" />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        閾値以上のアルファから外側の縁を作り、半透明部分の下にも縁色を敷きます。
      </Typography>
    </Stack>
  );
}
