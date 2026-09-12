import { Box } from '@mui/material';
import type { ReactNode } from 'react';
import { SliderField } from './SliderField';
import { formatMm, roundMm } from '../engine/units';

export { previewDiscCssPx, exponentialMmValue, exponentialMmPosition } from './mmScale';

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
  label = '太さ',
}: {
  valueMm: number;
  onChange?: (mm: number) => void;
  onPreview?: (mm: number) => void;
  onCommit?: (before: number, after: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  const preview = onPreview ?? onChange;
  const commit = onCommit ?? (onChange ? ((_before: number, after: number) => onChange(after)) : undefined);
  return (
    <SliderField
      label={label}
      value={roundMm(valueMm)}
      min={min}
      max={max}
      unit="mm"
      scale="mm"
      onPreview={mm => preview?.(mm)}
      onCommit={(before, after) => commit?.(before ?? valueMm, after)}
    />
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
  label = '太さ',
  trailing,
}: {
  valueMm: number;
  onChange?: (mm: number) => void;
  onPreview?: (mm: number) => void;
  onCommit?: (before: number, after: number) => void;
  min?: number;
  max?: number;
  label?: string;
  trailing?: ReactNode;
}) {
  const preview = onPreview ?? onChange;
  const commit = onCommit ?? (onChange ? ((_before: number, after: number) => onChange(after)) : undefined);
  return (
    <Box sx={{ minWidth: 0, width: '100%' }}>
      <SliderField
        label={label}
        value={roundMm(valueMm)}
        min={min}
        max={max}
        unit="mm"
        scale="mm"
        trailing={trailing}
        onPreview={mm => preview?.(mm)}
        onCommit={(before, after) => commit?.(before ?? valueMm, after)}
      />
    </Box>
  );
}

export { formatMm };
