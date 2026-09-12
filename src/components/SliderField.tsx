import { Box, Collapse, Slider } from '@mui/material';
import { useRef, useState, type ReactNode } from 'react';
import { NumericField } from './NumericField';
import { LabeledControl } from './inspectorLayout';
import { exponentialMmPosition, exponentialMmValue } from './mmScale';
import { formatMm, roundMm } from '../engine/units';

export function SliderField({
  label,
  value,
  min,
  max,
  onPreview,
  onCommit,
  unit,
  trailing,
  scale = 'linear',
  color,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  onPreview: (value: number) => void;
  onCommit: (before: number | null, after: number) => void;
  unit?: string;
  trailing?: ReactNode;
  scale?: 'linear' | 'mm';
  color?: 'text.secondary' | 'secondary' | 'warning' | 'warning.main';
}) {
  const [expanded, setExpanded] = useState(false);
  const before = useRef<number | null | undefined>(undefined);
  const latest = useRef(value ?? min);
  if (value !== null) latest.current = value;
  const clamped = Math.max(min, Math.min(max, value ?? min));
  const sliderValue = scale === 'mm' ? exponentialMmPosition(clamped, min, max) : clamped;
  const toValue = (raw: number) => (scale === 'mm' ? roundMm(exponentialMmValue(raw, min, max)) : raw);
  return (
    <LabeledControl label={label} color={color}>
      <Box
        onFocus={() => setExpanded(true)}
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setExpanded(false);
        }}
      >
        <NumericField
          fullWidth
          value={value}
          min={min}
          max={scale === 'mm' ? undefined : max}
          format={scale === 'mm' ? formatMm : undefined}
          unit={unit}
          trailing={trailing}
          onCommit={n => {
            const next = scale === 'mm' ? roundMm(Math.max(min, Math.min(max, n))) : Math.max(min, Math.min(max, n));
            if (next !== value) onCommit(value, next);
          }}
          slotProps={{
            htmlInput: { 'aria-label': label },
          }}
        />
        <Collapse in={expanded}>
          <Box sx={{ px: 0.75, pt: 0.75, pb: 0.25 }}>
            <Slider
              min={scale === 'mm' ? 0 : min}
              max={scale === 'mm' ? 1 : max}
              step={scale === 'mm' ? 0.001 : 1}
              value={sliderValue}
              className={value === null ? 'mixed-slider' : undefined}
              onChange={(_, v) => {
                if (before.current === undefined) before.current = value;
                const next = toValue(Array.isArray(v) ? v[0] : v);
                latest.current = next;
                onPreview(next);
              }}
              onChangeCommitted={() => {
                if (before.current !== undefined && before.current !== latest.current) {
                  onCommit(before.current, latest.current);
                }
                before.current = undefined;
              }}
            />
          </Box>
        </Collapse>
      </Box>
    </LabeledControl>
  );
}
