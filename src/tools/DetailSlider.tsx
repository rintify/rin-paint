import { SliderField } from '../components/SliderField';

export function DetailSlider({
  label,
  value,
  onChange,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
}) {
  return (
    <SliderField
      label={label}
      value={value}
      min={0}
      max={max}
      onPreview={onChange}
      onCommit={(_before, after) => onChange(after)}
    />
  );
}
