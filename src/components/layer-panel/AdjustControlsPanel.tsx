import { Stack, Typography } from '@mui/material';
import { useEngine } from '../EngineContext';
import type { AdjustParams, LayerMeta } from '../../model';
import { CommitSlider } from './CommitSlider';
import { MaskControls } from './MaskControls';

const ADJUST_SLIDERS: { key: keyof AdjustParams; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: '明度', min: 0, max: 200 },
  { key: 'contrast', label: 'コントラスト', min: 0, max: 200 },
  { key: 'hue', label: '色相', min: -180, max: 180 },
  { key: 'saturation', label: '彩度', min: 0, max: 200 },
];

export function AdjustControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const params = meta.params!;
  return (
    <>
      {ADJUST_SLIDERS.map((p) => (
        <Stack direction="row" spacing={1} key={p.key} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
            {p.label}
          </Typography>
          <CommitSlider
            value={params[p.key]}
            min={p.min}
            max={p.max}
            onPreview={(v) => engine.previewLayerProps(meta.id, { params: { ...params, [p.key]: v } })}
            onCommit={(b, a) =>
              engine.commitLayerProps(
                meta.id,
                { params: { ...params, [p.key]: b ?? params[p.key] } },
                { params: { ...params, [p.key]: a } },
                '色調補正',
              )}
          />
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flex: 'none' }}
          >
            {params[p.key]}
          </Typography>
        </Stack>
      ))}
      <MaskControls meta={meta} />
    </>
  );
}
