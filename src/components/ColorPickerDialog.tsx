import { Box, Button, Popover, Slider, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { TRANSPARENT } from '../model';
import { ColorHistoryGrid } from './ColorHistoryGrid';
import { LabeledControl } from './inspectorLayout';
import { hexToHsv, hsvToHex, hueHex, parseHex, type Hsv } from './colorMath';

function fractionFromPointer(event: ReactPointerEvent<HTMLElement>, horizontal: boolean, vertical: boolean) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = horizontal ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
  const y = vertical ? Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) : 0;
  return { x, y };
}

function originTowardCenter(anchor: HTMLElement | null) {
  if (!anchor) {
    return {
      anchorOrigin: { vertical: 'bottom' as const, horizontal: 'right' as const },
      transformOrigin: { vertical: 'top' as const, horizontal: 'left' as const },
    };
  }
  const rect = anchor.getBoundingClientRect();
  const towardRight = rect.left + rect.width / 2 < window.innerWidth / 2;
  const towardBottom = rect.top + rect.height / 2 < window.innerHeight / 2;
  return {
    anchorOrigin: {
      vertical: towardBottom ? 'bottom' as const : 'top' as const,
      horizontal: towardRight ? 'right' as const : 'left' as const,
    },
    transformOrigin: {
      vertical: towardBottom ? 'top' as const : 'bottom' as const,
      horizontal: towardRight ? 'left' as const : 'right' as const,
    },
  };
}

export function ColorPickerDialog({
  open,
  anchorEl,
  value,
  onChange,
  onClose,
  allowTransparent = false,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  value: string;
  onChange: (color: string) => void;
  onClose: () => void;
  allowTransparent?: boolean;
}) {
  const lastHex = useRef('#ffffff');
  const parsed = parseHex(value);
  if (parsed) lastHex.current = parsed;
  const hsv = hexToHsv(lastHex.current);
  const hue = useRef(hsv.h);
  if (hsv.s > 0.001) hue.current = hsv.h;
  const shown: Hsv = { ...hsv, h: hue.current };
  const [hexDraft, setHexDraft] = useState(value === TRANSPARENT ? '透明' : value);
  useEffect(() => { setHexDraft(value === TRANSPARENT ? '透明' : value); }, [value]);
  const origin = useMemo(() => originTowardCenter(anchorEl), [anchorEl, open]);

  const setHsv = (next: Hsv) => {
    if (next.s > 0.001) hue.current = next.h;
    onChange(hsvToHex({ ...next, h: next.s > 0.001 ? next.h : hue.current }));
  };

  const dragSv = (event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = fractionFromPointer(event, true, true);
    setHsv({ h: hue.current, s: x, v: 1 - y });
  };
  const moveSv = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const { x, y } = fractionFromPointer(event, true, true);
    setHsv({ h: hue.current, s: x, v: 1 - y });
  };

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={origin.anchorOrigin}
      transformOrigin={origin.transformOrigin}
      marginThreshold={8}
      slotProps={{ paper: { sx: { width: 280, p: 1.5 } } }}
    >
      <Stack spacing={1.5}>
        <Box
          role="slider"
          aria-label="彩度と明度"
          tabIndex={0}
          onPointerDown={dragSv}
          onPointerMove={moveSv}
          sx={{
            position: 'relative',
            height: 160,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            cursor: 'crosshair',
            touchAction: 'none',
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex(shown.h)})`,
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '2px solid #fff',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
              left: `${shown.s * 100}%`,
              top: `${(1 - shown.v) * 100}%`,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
          />
        </Box>
        <Slider
          min={0}
          max={360}
          step={1}
          value={shown.h}
          aria-label="色相"
          onChange={(_, next) => setHsv({ ...shown, h: Array.isArray(next) ? next[0] : next })}
          sx={{
            py: 0,
            '& .MuiSlider-rail': {
              height: 12,
              borderRadius: 1,
              opacity: 1,
              background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
            },
            '& .MuiSlider-track': { display: 'none' },
            '& .MuiSlider-thumb': { width: 16, height: 16, border: '2px solid #fff' },
          }}
        />
        <LabeledControl label="HEX">
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box
              className={value === TRANSPARENT ? 'checker' : undefined}
              sx={{
                width: 40,
                height: 34,
                flex: 'none',
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
                bgcolor: value === TRANSPARENT ? undefined : value,
              }}
            />
            <TextField
              fullWidth
              value={hexDraft}
              onChange={event => {
                setHexDraft(event.target.value);
                const next = parseHex(event.target.value);
                if (next) onChange(next);
              }}
              onBlur={() => setHexDraft(value === TRANSPARENT ? '透明' : value)}
              slotProps={{ htmlInput: { 'aria-label': 'HEX', spellCheck: false } }}
            />
          </Stack>
        </LabeledControl>
        <Typography variant="caption" color="text.secondary">履歴</Typography>
        <ColorHistoryGrid value={value} onSelect={onChange} allowTransparent={allowTransparent} />
        <Button variant="contained" fullWidth onClick={onClose}>完了</Button>
      </Stack>
    </Popover>
  );
}
