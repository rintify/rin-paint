import type { ReactNode } from 'react';
import { NumericField } from './NumericField';
import { useStore } from '../state/store';
import { formatMm, mmToPx, pxToMm, roundMm } from '../engine/units';

/**
 * Number field that displays / commits page-space lengths in mm while the model
 * stores pixels. Conversion uses the current page ppi.
 */
export function PageMmField({
  valuePx,
  onCommitPx,
  minPx,
  label,
  trailing,
  labelColor,
  ...props
}: {
  valuePx: number | null;
  onCommitPx: (px: number) => void;
  minPx?: number;
  label?: string;
  trailing?: ReactNode;
  labelColor?: 'text.secondary' | 'secondary' | 'warning' | 'warning.main';
  size?: 'small' | 'medium';
  disabled?: boolean;
  sx?: object;
}) {
  const ppi = useStore(s => s.pageSpec.ppi);
  const valueMm = valuePx === null ? null : roundMm(pxToMm(valuePx, ppi));
  const minMm = minPx === undefined ? undefined : Math.max(0, roundMm(pxToMm(minPx, ppi)));
  return (
    <NumericField
      {...props}
      fullWidth
      label={label}
      value={valueMm}
      min={minMm}
      format={formatMm}
      unit="mm"
      trailing={trailing}
      labelColor={labelColor}
      onCommit={mm => {
        const px = mmToPx(roundMm(mm), ppi);
        onCommitPx(minPx === undefined ? px : Math.max(minPx, px));
      }}
    />
  );
}
