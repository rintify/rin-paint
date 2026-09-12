import { InputAdornment, TextField, Typography, type TextFieldProps } from '@mui/material';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { LabeledControl } from './inspectorLayout';

type Props = Omit<TextFieldProps, 'type' | 'value' | 'onChange'> & {
  value: number | null;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
  format?: (value: number) => string;
  unit?: string;
  trailing?: ReactNode;
  labelColor?: 'text.secondary' | 'secondary' | 'warning' | 'warning.main';
};

/** 入力途中の文字列を保ち、Enter/Blur の時だけ数値として確定する。 */
export function NumericField({
  value,
  min = -Infinity,
  max = Infinity,
  onCommit,
  helperText,
  onBlur,
  format,
  unit,
  trailing,
  sx,
  slotProps,
  label,
  labelColor,
  ...props
}: Props) {
  const display = (n: number) => (format ? format(n) : String(n));
  const shown = value === null ? '—' : display(value);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const skipBlur = useRef(false);
  useEffect(() => { if (document.activeElement !== input.current) setDraft(shown); }, [shown]);
  const commit = () => {
    const parsed = Number(draft.trim());
    if (!draft.trim() || !Number.isFinite(parsed) || parsed < min || parsed > max) {
      setError(Number.isFinite(min) && Number.isFinite(max) ? `${min}〜${max}で入力してください` : '有効な数値を入力してください');
      return;
    }
    setError('');
    if (parsed !== value) onCommit(parsed);
    setDraft(display(parsed));
  };
  const packed = !!(unit || trailing);
  const { htmlInput, input: inputSlot, ...restSlot } = slotProps ?? {};
  const inputProps = typeof inputSlot === 'object' && inputSlot ? inputSlot : {};
  const sideLabel = typeof label === 'string' ? label : undefined;
  const field = (
    <TextField
      {...props}
      inputRef={input}
      type="text"
      value={draft}
      error={!!error}
      helperText={error || helperText}
      fullWidth
      sx={[
        packed ? { '& input': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } } : {},
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      slotProps={{
        ...restSlot,
        htmlInput: {
          inputMode: 'decimal',
          'data-numeric-draft': 'true',
          'aria-label': sideLabel,
          ...(typeof htmlInput === 'object' ? htmlInput : {}),
        },
        input: {
          ...inputProps,
          endAdornment: packed ? (
            <InputAdornment position="end" sx={{ ml: 0.75, gap: 0.25 }}>
              {unit && (
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1, userSelect: 'none' }}>
                  {unit}
                </Typography>
              )}
              {trailing}
              {inputProps.endAdornment}
            </InputAdornment>
          ) : inputProps.endAdornment,
        },
      }}
      onChange={event => { setDraft(event.target.value); setError(''); }}
      onFocus={props.onFocus}
      onBlur={event => {
        if (skipBlur.current) { skipBlur.current = false; onBlur?.(event); return; }
        if (draft !== shown) commit();
        onBlur?.(event);
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
        else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          skipBlur.current = true;
          setDraft(shown);
          setError('');
          input.current?.blur();
        }
      }}
    />
  );
  if (!sideLabel) return field;
  return (
    <LabeledControl label={sideLabel} color={labelColor}>
      {field}
    </LabeledControl>
  );
}
