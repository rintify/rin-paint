import { NumericField } from './NumericField';
import { useStore } from '../state/store';
import { mmToPx, pxToMm, roundMm } from '../engine/units';

/**
 * Number field that displays / commits canvas lengths in mm while the model
 * stores pixels. Conversion uses the current page ppi.
 */
export function CanvasMmField({
  valuePx,
  onCommitPx,
  minPx,
  label,
  ...props
}: {
  valuePx: number;
  onCommitPx: (px: number) => void;
  minPx?: number;
  label?: string;
  size?: 'small' | 'medium';
  disabled?: boolean;
  sx?: object;
}) {
  const ppi = useStore(s => s.canvasSpec.ppi);
  const valueMm = roundMm(pxToMm(valuePx, ppi));
  const minMm = minPx === undefined ? undefined : Math.max(0, roundMm(pxToMm(minPx, ppi)));
  return (
    <NumericField
      {...props}
      label={label ? `${label} (mm)` : 'mm'}
      value={valueMm}
      min={minMm}
      onCommit={mm => {
        const px = mmToPx(roundMm(mm), ppi);
        onCommitPx(minPx === undefined ? px : Math.max(minPx, px));
      }}
    />
  );
}
