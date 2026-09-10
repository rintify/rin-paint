import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slider,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import {
  normalizePenDetailSettings,
  TRANSPARENT,
  type PenDetailSettings,
} from '../types';

export function PenSettings() {
  const penSize = useStore((s) => s.penSize);
  const penColor = useStore((s) => s.penColor);
  const kind = useStore((s) => s.tool);
  const activeTool = useStore((s) =>
    s.tools.find((tool) => tool.id === s.activeToolId),
  );
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detailsOpen]);

  if (kind === 'lasso') return null;
  const d = Math.min(penSize, 32);
  const transparent = penColor === TRANSPARENT;
  const penDetails = normalizePenDetailSettings(activeTool?.penSettings);
  const setDetail = (key: keyof PenDetailSettings, value: number) =>
    useStore.getState().setPenDetail(key, value);

  const title =
    kind === 'blur'
      ? 'ぼかしの太さ'
      : kind === 'line' || kind === 'rect' || kind === 'ellipse'
        ? '線の太さ'
        : 'ペンの太さ';

  return (
    <>
      <Box className="section">
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
            {title}
          </Typography>
          {kind === 'pen' && (
            <Button size="small" onClick={() => setDetailsOpen(true)} sx={{ fontSize: 11, py: 0.25, px: 1 }}>
              詳細設定…
            </Button>
          )}
        </Stack>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <Box
            className="pen-preview"
            sx={{
              width: 36,
              height: 36,
              flex: 'none',
              borderRadius: 1,
              bgcolor: '#fff',
              display: 'grid',
              placeItems: 'center',
              overflow: 'hidden',
            }}
          >
            <Box
              className={transparent && kind !== 'blur' ? 'checker' : undefined}
              sx={{
                width: d,
                height: d,
                borderRadius: '50%',
                minWidth: 2,
                minHeight: 2,
                bgcolor: kind === 'blur' ? '#9db3d4' : transparent ? undefined : penColor,
                filter: kind === 'blur' ? 'blur(3px)' : undefined,
              }}
            />
          </Box>
          <Slider
            min={1}
            max={128}
            value={penSize}
            onChange={(_, v) => useStore.getState().setPenSize(v as number)}
            sx={{ flex: 1 }}
          />
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ width: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flex: 'none' }}
          >
            {penSize}
          </Typography>
        </Stack>
      </Box>
      <Dialog open={detailsOpen && kind === 'pen'} onClose={() => setDetailsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>ペンの詳細設定</DialogTitle>
        <DialogContent>
          <DetailSlider
            label="筆圧ブレ補正"
            value={penDetails.pressureStabilization}
            onChange={(value) => setDetail('pressureStabilization', value)}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            値を上げるほど筆圧の急な変化をなめらかにします。
          </Typography>
          <DetailSlider
            label="入り"
            value={penDetails.taperIn}
            onChange={(value) => setDetail('taperIn', value)}
          />
          <DetailSlider
            label="抜き"
            value={penDetails.taperOut}
            onChange={(value) => setDetail('taperOut', value)}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            値を上げるほど線の始端・終端が長く細くなります。0で無効です。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setDetailsOpen(false)}>
            完了
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function DetailSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '92px minmax(120px, 1fr) 32px',
        alignItems: 'center',
        gap: 1.25,
        mb: 1,
      }}
    >
      <Typography variant="body2">{label}</Typography>
      <Slider
        min={0}
        max={100}
        value={value}
        onChange={(_, v) => onChange(v as number)}
      />
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
    </Box>
  );
}
