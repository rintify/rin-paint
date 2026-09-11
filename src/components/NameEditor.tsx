import { TextField, type TextFieldProps } from '@mui/material';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';

type Props = Omit<TextFieldProps, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'> & {
  value: string;
  editing: boolean;
  onCommit: (value: string) => boolean | void;
  onCancel: () => void;
  onEditingChange?: (editing: boolean) => void;
  submitRef?: MutableRefObject<(() => boolean) | null>;
};

/** A local-draft name field that never treats an IME conversion Enter as submit. */
export function NameEditor({ value, editing, onCommit, onCancel, onEditingChange, submitRef, ...props }: Props) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const composing = useRef(false);
  const compositionEndedAt = useRef(-Infinity);
  const skipBlurCommit = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) { setDraft(value); setError(''); }
  }, [editing, value]);

  const commit = () => {
    if (composing.current) return false;
    if (!draft.trim()) {
      setError('空白だけの名称は使えません');
      requestAnimationFrame(() => input.current?.focus());
      return false;
    }
    const accepted = onCommit(draft);
    if (accepted === false) return false;
    setError('');
    onEditingChange?.(false);
    return true;
  };
  if (submitRef) submitRef.current = commit;

  if (!editing) return null;
  return <TextField
    {...props}
    inputRef={input}
    autoFocus
    value={draft}
    error={!!error}
    helperText={error || props.helperText}
    onClick={event => event.stopPropagation()}
    onPointerDown={event => event.stopPropagation()}
    onChange={event => { setDraft(event.target.value); setError(''); }}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; compositionEndedAt.current = performance.now(); }}
    onBlur={() => {
      if (skipBlurCommit.current) { skipBlurCommit.current = false; return; }
      if (!composing.current) commit();
    }}
    onKeyDown={event => {
      const native = event.nativeEvent as KeyboardEvent;
      if (composing.current || native.isComposing || native.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        skipBlurCommit.current = true;
        setDraft(value); setError(''); onCancel(); onEditingChange?.(false);
        return;
      }
      if (event.key !== 'Enter') return;
      if (composing.current || native.isComposing || native.keyCode === 229 || performance.now() - compositionEndedAt.current < 120) return;
      event.preventDefault();
      if (commit()) { skipBlurCommit.current = true; input.current?.blur(); }
    }}
  />;
}
