import { Box, Slider, Stack, Typography } from '@mui/material';
import { useRef } from 'react';
import { NumericField } from './NumericField';
import { formatMm, roundMm } from '../engine/units';

/** Map 0.01–20 mm onto a CSS preview disc inside a 36px frame. */
export function previewDiscCssPx(sizeMm: number, maxMm = 20): number {
  const t = Math.max(0, Math.min(1, (sizeMm - 0.01) / (maxMm - 0.01)));
  return Math.max(2, Math.round(2 + t * 34));
}

const positiveFloor = (min: number, max: number) => min > 0 ? min : Math.min(max, Math.max(0.01, max / 1000));

/** Convert a normalized slider position to a length with fine control at small sizes. */
export function exponentialMmValue(position: number, min: number, max: number): number {
  const t = Math.max(0, Math.min(1, position));
  if (max <= min) return min;
  if (min <= 0 && t === 0) return 0;
  const floor = positiveFloor(min, max);
  return floor * Math.pow(max / floor, t);
}

export function exponentialMmPosition(value: number, min: number, max: number): number {
  if (max <= min || (min <= 0 && value <= 0)) return 0;
  const floor = positiveFloor(min, max);
  return Math.max(0, Math.min(1, Math.log(Math.max(floor, value) / floor) / Math.log(max / floor)));
}

/**
 * Slider + numeric field for a length in mm (step 0.01).
 * Display uses two decimal places; commit values are rounded to 0.01 mm.
 * Values above max still display; the slider clamps to max.
 */
export function MmControl({
  valueMm,
  onChange,
  onPreview,
  onCommit,
  min = 0,
  max = 20,
  label,
}: {
  valueMm: number;
  onChange?: (mm: number) => void;
  onPreview?: (mm: number) => void;
  onCommit?: (before: number, after: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  const clampedSlider = Math.max(min, Math.min(max, valueMm));
  const display = roundMm(valueMm);
  const before = useRef<number | null>(null);
  const latest = useRef(clampedSlider);
  const preview = onPreview ?? onChange;
  const commit = onCommit ?? (onChange ? ((_before: number, after: number) => onChange(after)) : undefined);
  return (
    <Stack spacing={0.5} sx={{ width: '100%' }}>
      {label && (
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
          {label}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Slider
          min={0}
          max={1}
          step={0.001}
          value={exponentialMmPosition(clampedSlider, min, max)}
          onChange={(_, v) => {
            if (before.current === null) before.current = valueMm;
            const mm = roundMm(exponentialMmValue(Array.isArray(v) ? v[0] : v, min, max));
            latest.current = mm;
            preview?.(mm);
          }}
          onChangeCommitted={() => {
            if (before.current !== null && before.current !== latest.current) commit?.(before.current, latest.current);
            before.current = null;
          }}
          sx={{ flex: 1 }}
        />
        <NumericField
          size="small"
          label="mm"
          value={display}
          min={min}
          onCommit={mm => {
            const next = roundMm(Math.max(min, Math.min(max, mm)));
            if (next !== valueMm) commit?.(valueMm, next);
          }}
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
  onPreview,
  onCommit,
  min = 0.01,
  max = 20,
}: {
  valueMm: number;
  onChange?: (mm: number) => void;
  onPreview?: (mm: number) => void;
  onCommit?: (before: number, after: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <MmControl valueMm={valueMm} onChange={onChange} onPreview={onPreview} onCommit={onCommit} min={min} max={max} />
    </Box>
  );
}

export { formatMm };
