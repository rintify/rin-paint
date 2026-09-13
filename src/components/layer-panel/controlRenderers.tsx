import { FormControl, MenuItem, Select, Stack, Switch, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { STANDARD_FONTS } from '../../engine/text/render';
import { clampSizeMm, formatDeg, mmToPx, pxToMm, roundDeg, roundMm } from '../../engine/units';
import { PageMmField } from '../PageMmField';
import { ColorField } from '../ColorField';
import { NumericField } from '../NumericField';
import { SliderField } from '../SliderField';
import { LabeledControl } from '../inspectorLayout';
import type { ParameterValue, ResolvedParameter } from '../../engine/parameters/types';
import { editorUnit } from '../../engine/parameters/codec';

export interface ControlRendererProps {
  parameter: ResolvedParameter;
  value: ParameterValue;
  mixed: boolean;
  labelColor?: 'text.secondary' | 'secondary' | 'warning' | 'warning.main';
  trailing?: ReactNode;
  fonts?: { id: string; name: string }[];
  ppi: number;
  onCommit: (value: ParameterValue) => void;
  onPreview?: (value: ParameterValue) => void;
  onCommitRange?: (before: ParameterValue, after: ParameterValue) => void;
}

function switchRenderer({ parameter, value, mixed, labelColor, trailing, onCommit }: ControlRendererProps) {
  if (parameter.editor.kind !== 'switch') return null;
  return (
    <LabeledControl label={parameter.label} color={labelColor}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {mixed ? '—' : value ? parameter.editor.trueLabel : parameter.editor.falseLabel}
        </Typography>
        <Switch
          checked={value === true}
          onChange={event => onCommit(event.target.checked)}
          slotProps={{ input: { 'aria-label': parameter.label } }}
        />
        {trailing}
      </Stack>
    </LabeledControl>
  );
}

function sliderRenderer({ parameter, value, labelColor, trailing, onPreview, onCommitRange, ppi }: ControlRendererProps) {
  if (parameter.editor.kind !== 'slider') return null;
  const unit = parameter.editor.unit;
  if (unit?.kind === 'page-mm') {
    const mm = typeof value === 'number' ? pxToMm(value, ppi) : null;
    return (
      <SliderField
        label={parameter.label}
        value={mm}
        min={parameter.editor.min}
        max={parameter.editor.max}
        unit="mm"
        scale="mm"
        color={labelColor}
        trailing={trailing}
        onPreview={next => onPreview?.(mmToPx(clampSizeMm(roundMm(next)), ppi))}
        onCommit={(before, after) => onCommitRange?.(
          mmToPx(clampSizeMm(roundMm(before ?? after)), ppi),
          mmToPx(clampSizeMm(roundMm(after)), ppi),
        )}
      />
    );
  }
  const suffix = unit?.kind === 'percent' ? '%' : unit?.kind === 'mm' ? 'mm' : unit?.kind === 'pt' ? 'pt' : undefined;
  return (
    <SliderField
      label={parameter.label}
      value={typeof value === 'number' ? value : null}
      min={parameter.editor.min}
      max={parameter.editor.max}
      unit={suffix}
      scale={unit?.kind === 'mm' ? 'mm' : 'linear'}
      color={labelColor}
      trailing={trailing}
      onPreview={next => onPreview?.(next)}
      onCommit={(before, after) => onCommitRange?.(before ?? after, after)}
    />
  );
}

function numberRenderer({ parameter, value, mixed, labelColor, trailing, onCommit }: ControlRendererProps) {
  if (parameter.editor.kind !== 'number') return null;
  const unit = parameter.editor.unit;
  if (parameter.editor.nullable) {
    const auto = !mixed && value === null;
    return (
      <LabeledControl label={parameter.label} color={labelColor}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {unit?.kind === 'page-mm' ? (
            <PageMmField
              size="small"
              valuePx={typeof value === 'number' ? value : null}
              minPx={parameter.editor.min}
              disabled={auto}
              onCommitPx={onCommit}
            />
          ) : (
            <NumericField
              size="small"
              value={typeof value === 'number' ? value : null}
              min={parameter.editor.min}
              max={parameter.editor.max}
              disabled={auto}
              onCommit={onCommit}
            />
          )}
          <Typography variant="caption">自動</Typography>
          <Switch
            checked={auto}
            slotProps={{ input: { 'aria-label': `${parameter.label}を自動にする` } }}
            onChange={event => onCommit(event.target.checked ? null : (typeof value === 'number' ? value : 1))}
          />
          {trailing}
        </Stack>
      </LabeledControl>
    );
  }
  if (unit?.kind === 'page-mm') {
    return (
      <PageMmField
        size="small"
        label={parameter.label}
        valuePx={typeof value === 'number' ? value : null}
        minPx={parameter.editor.min}
        onCommitPx={onCommit}
        trailing={trailing}
        labelColor={labelColor}
      />
    );
  }
  const suffix = unit?.kind === 'degree' ? '度' : unit?.kind === 'pt' ? 'pt' : unit?.kind === 'none' ? unit.suffix : undefined;
  const numeric = typeof value === 'number'
    ? (unit?.kind === 'degree' ? roundDeg(value) : value)
    : null;
  return (
    <NumericField
      size="small"
      fullWidth
      label={parameter.label}
      value={numeric}
      min={parameter.editor.min}
      max={parameter.editor.max}
      unit={suffix}
      format={unit?.kind === 'degree' ? formatDeg : undefined}
      onCommit={next => onCommit(unit?.kind === 'degree' ? roundDeg(next) : next)}
      trailing={trailing}
      labelColor={labelColor}
    />
  );
}

function colorRenderer({ parameter, value, labelColor, trailing, onCommit }: ControlRendererProps) {
  if (parameter.editor.kind !== 'color') return null;
  return (
    <ColorField
      label={parameter.label}
      labelColor={labelColor}
      value={typeof value === 'string' ? value : null}
      allowTransparent={parameter.editor.transparent}
      trailing={trailing}
      onChange={onCommit}
    />
  );
}

function selectRenderer({ parameter, value, mixed, labelColor, trailing, onCommit, fonts }: ControlRendererProps) {
  if (parameter.editor.kind !== 'select') return null;
  const options = parameter.editor.options.kind === 'project-fonts'
    ? [...STANDARD_FONTS, ...(fonts ?? [])].map(font => ({ value: font.id, label: font.name }))
    : [...parameter.editor.options.options];
  return (
    <LabeledControl label={parameter.label} color={labelColor}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <FormControl size="small" fullWidth>
          <Select
            displayEmpty
            aria-label={parameter.label}
            value={typeof value === 'string' ? value : ''}
            onChange={event => onCommit(event.target.value)}
          >
            {mixed && <MenuItem value="" disabled>—</MenuItem>}
            {options.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
          </Select>
        </FormControl>
        {trailing}
      </Stack>
    </LabeledControl>
  );
}

const RENDERERS: Record<ResolvedParameter['editor']['kind'], (props: ControlRendererProps) => ReactNode> = {
  switch: switchRenderer,
  slider: sliderRenderer,
  number: numberRenderer,
  color: colorRenderer,
  select: selectRenderer,
};

export function renderParameterControl(props: ControlRendererProps): ReactNode {
  return RENDERERS[props.parameter.editor.kind](props);
}

export { editorUnit };
