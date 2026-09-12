import { Stack } from '@mui/material';
import { useEngine } from '../EngineContext';
import type { AdjustParams, LayerMeta } from '../../model';
import { SliderField } from '../SliderField';
import { MaskControls } from './MaskControls';
import { ParameterLinkIndicator } from './ParameterLinkIndicator';
import { linkedParameterColor } from './parameterLinkUi';

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
    <Stack spacing={1.5}>
      {ADJUST_SLIDERS.map((p) => (
        <SliderField
          key={p.key}
          label={p.label}
          value={params[p.key]}
          min={p.min}
          max={p.max}
          color={linkedParameterColor(meta, `adjust.${p.key}`)}
          trailing={<ParameterLinkIndicator meta={meta} semanticId={`adjust.${p.key}`} />}
          onPreview={v => engine.previewLayerProps(meta.id, { params: { ...params, [p.key]: v } })}
          onCommit={(b, a) =>
            engine.commitLayerProps(
              meta.id,
              { params: { ...params, [p.key]: b ?? params[p.key] } },
              { params: { ...params, [p.key]: a } },
              '色調補正',
            )}
        />
      ))}
      <MaskControls meta={meta} />
    </Stack>
  );
}
