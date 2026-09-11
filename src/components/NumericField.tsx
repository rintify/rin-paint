import { TextField, type TextFieldProps } from '@mui/material';
import { useEffect, useState } from 'react';

type Props = Omit<TextFieldProps, 'type' | 'value' | 'onChange' | 'onBlur'> & {
  value: number | null;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
};

/** 入力途中の文字列を保ち、Enter/Blur の時だけ数値として確定する。 */
export function NumericField({ value, min = -Infinity, max = Infinity, onCommit, helperText, ...props }: Props) {
  const shown = value === null ? '—' : String(value);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState('');
  useEffect(() => { if (document.activeElement?.getAttribute('data-numeric-draft') !== 'true') setDraft(shown); }, [shown]);
  const commit = () => {
    const parsed = Number(draft.trim());
    if (!draft.trim() || !Number.isFinite(parsed) || parsed < min || parsed > max) {
      setError(Number.isFinite(min) && Number.isFinite(max) ? `${min}〜${max}で入力してください` : '有効な数値を入力してください');
      return;
    }
    setError(''); onCommit(parsed); setDraft(String(parsed));
  };
  return <TextField {...props} type="text" value={draft} error={!!error} helperText={error || helperText}
    slotProps={{ ...props.slotProps, htmlInput: { inputMode: 'decimal', 'data-numeric-draft': 'true' } }}
    onChange={event => { setDraft(event.target.value); setError(''); }} onBlur={commit}
    onWheel={event => (event.currentTarget.querySelector('input') as HTMLInputElement | null)?.blur()}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } else if (event.key === 'Escape') { event.preventDefault(); setDraft(shown); setError(''); (event.currentTarget.querySelector('input') as HTMLInputElement | null)?.blur(); } }} />;
}
