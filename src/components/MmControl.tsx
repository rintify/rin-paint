import { Box, Slider, Stack, Typography } from '@mui/material';
import { NumericField } from './NumericField';
import { formatMm, roundMm } from '../engine/units';

/** Map 0.01–20 mm onto a CSS preview disc inside a 36px frame. */
export function previewDiscCssPx(sizeMm: number, maxMm = 20): number {
  const t = Math.max(0, Math.min(1, (sizeMm - 0.01) / (maxMm - 0.01)));
  return Math.max(2, Math.round(2 + t * 34));
}

/**
 * Slider + numeric field for a length in mm (step 0.01).
 * Display uses two decimal places; commit values are rounded to 0.01 mm.
 * Values above max still display; the slider clamps to max.
 */
export function MmControl({
  valueMm,
  onChange,
  min = 0,
  max = 20,
  label,
}: {
  valueMm: number;
  onChange: (mm: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  const clampedSlider = Math.max(min, Math.min(max, valueMm));
  const display = roundMm(valueMm);
  return (
    <Stack spacing={0.5} sx={{ width: '100%' }}>
      {label && (
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
          {label}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Slider
          min={min}
          max={max}
          step={0.01}
          value={clampedSlider}
          onChange={(_, v) => onChange(roundMm(Array.isArray(v) ? v[0] : v))}
          sx={{ flex: 1 }}
        />
        <NumericField
          size="small"
          label="mm"
          value={display}
          min={min}
          onCommit={mm => onChange(roundMm(Math.max(min, Math.min(max, mm))))}
          sx={{ width: 72, flex: 'none' }}
        />
      </Stack>
    </Stack>
  );
}

/** Compact mm control used next to a caption (shape stroke width row). */
export function MmInlineControl({
  valueMm,
  onChange,
  min = 0.01,
  max = 20,
}: {
  valueMm: number;
  onChange: (mm: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <MmControl valueMm={valueMm} onChange={onChange} min={min} max={max} />
    </Box>
  );
}

export { formatMm };
