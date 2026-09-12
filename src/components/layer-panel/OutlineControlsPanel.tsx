import { Box, Stack, Typography } from '@mui/material';
import { useEngine } from '../EngineContext';
import type { LayerMeta, OutlineParams } from '../../model';
import { CommitSlider } from './CommitSlider';

export function OutlineControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const outline = meta.outline!;
  const commit = (before: OutlineParams, after: OutlineParams, label: string) =>
    engine.commitLayerProps(meta.id, { outline: before }, { outline: after }, label);
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>縁の色</Typography>
        <Box
          component="input"
          type="color"
          aria-label="縁の色"
          value={outline.color}
          onChange={event => commit(outline, { ...outline, color: event.target.value }, '縁の色')}
          sx={{ minWidth: 0, flex: 1, height: 34 }}
        />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>太さ (mm)</Typography>
        <CommitSlider
          value={outline.widthMm}
          min={0.01}
          max={20}
          onPreview={value => engine.previewLayerProps(meta.id, { outline: { ...outline, widthMm: value } })}
          onCommit={(before, after) => commit(
            { ...outline, widthMm: before ?? outline.widthMm },
            { ...outline, widthMm: after },
            '縁の太さ',
          )}
        />
        <Typography variant="body2" color="text.secondary" sx={{ width: 42, textAlign: 'right' }}>
          {outline.widthMm.toFixed(2)}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>閾値</Typography>
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
      </Stack>
      <Typography variant="caption" color="text.secondary">
        閾値以上のアルファから外側の縁を作り、半透明部分の下にも縁色を敷きます。
      </Typography>
    </Stack>
  );
}
