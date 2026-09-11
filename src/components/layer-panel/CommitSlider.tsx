import { Slider } from '@mui/material';
import { useRef } from 'react';

/**
 * ドラッグ中はプレビュー、離した時だけ履歴へ 1 件積むスライダー。
 * value が null のときは「複数レイヤーで値が異なる」状態。
 */
export function CommitSlider({
  value,
  min,
  max,
  onPreview,
  onCommit,
}: {
  value: number | null;
  min: number;
  max: number;
  onPreview: (v: number) => void;
  onCommit: (before: number | null, after: number) => void;
}) {
  const before = useRef<number | null | undefined>(undefined);
  const latest = useRef(value ?? 0);
  if (value !== null) latest.current = value;
  const finish = () => {
    if (before.current !== undefined && before.current !== latest.current) {
      onCommit(before.current, latest.current);
    }
    before.current = undefined;
  };
  return (
    <Slider
      min={min}
      max={max}
      value={value ?? 0}
      className={value === null ? 'mixed-slider' : undefined}
      onChange={(_, v) => {
        if (before.current === undefined) before.current = value;
        latest.current = v as number;
        onPreview(v as number);
      }}
      onChangeCommitted={finish}
      sx={{ flex: 1 }}
    />
  );
}
