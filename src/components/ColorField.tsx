import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useRef, useState, type ReactNode } from 'react';
import { TRANSPARENT } from '../model';
import { LabeledControl } from './inspectorLayout';
import { ColorHistoryGrid } from './ColorHistoryGrid';
import { ColorPickerDialog } from './ColorPickerDialog';

export function ColorField({
  label,
  labelColor,
  value,
  onChange,
  allowTransparent = false,
  trailing,
  disabled = false,
  hint,
  showHistory = false,
}: {
  label: string;
  labelColor?: 'text.secondary' | 'secondary' | 'warning' | 'warning.main';
  value: string | null;
  onChange: (color: string) => void;
  allowTransparent?: boolean;
  trailing?: ReactNode;
  disabled?: boolean;
  hint?: string;
  showHistory?: boolean;
}) {
  const mixed = value === null;
  const transparent = value === TRANSPARENT;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState(value ?? '#ffffff');
  const initial = useRef(value ?? '#ffffff');
  const open = !!anchor;
  const showing = open ? draft : value;
  const showingTransparent = showing === TRANSPARENT;
  const closePicker = () => {
    if (draft !== initial.current) onChange(draft);
    setAnchor(null);
  };
  const openPicker = (el: HTMLElement) => {
    if (disabled) return;
    const current = value ?? '#ffffff';
    initial.current = current;
    setDraft(current);
    setAnchor(el);
  };
  return (
    <Stack spacing={0.75} sx={{ minWidth: 0, width: '100%', opacity: disabled ? 0.5 : 1 }}>
      <LabeledControl label={label} color={labelColor}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          <ButtonBase
            aria-label={label}
            disabled={disabled}
            onClick={event => openPicker(event.currentTarget)}
            className={showingTransparent || (!open && mixed) ? 'checker' : undefined}
            sx={{
              width: 46,
              height: 34,
              flex: 'none',
              p: '2px',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: 'var(--field)',
              opacity: !open && mixed ? 0.45 : 1,
            }}
          >
            <Box sx={{
              width: 1,
              height: 1,
              borderRadius: 0.5,
              bgcolor: showingTransparent || (!open && mixed) || !showing ? undefined : showing,
            }} />
          </ButtonBase>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {open ? (draft === TRANSPARENT ? '透明' : draft) : mixed ? '—' : transparent ? '透明' : value}
          </Typography>
          {trailing}
        </Stack>
      </LabeledControl>
      {showHistory && (
        <ColorHistoryGrid
          value={open ? draft : value}
          disabled={disabled}
          allowTransparent={allowTransparent}
          onSelect={color => (open ? setDraft(color) : onChange(color))}
        />
      )}
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
      <ColorPickerDialog
        open={open}
        anchorEl={anchor}
        value={draft}
        allowTransparent={allowTransparent}
        onChange={setDraft}
        onClose={closePicker}
      />
    </Stack>
  );
}
