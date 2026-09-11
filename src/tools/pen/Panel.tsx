import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { TRANSPARENT } from '../../model';
import { useStore } from '../../state/store';
import { useEngine } from '../../components/EngineContext';
import { MmControl, previewDiscCssPx } from '../../components/MmControl';
import { DetailSlider } from '../DetailSlider';
import { SIZE_MM_MAX, SIZE_MM_MIN } from '../../engine/units';
import { normalizePenDetailSettings, type PenDetailSettings } from './settings';

export function PenSettingsPanel() {
  const engine = useEngine();
  const penSizeMm = useStore((s) => s.penSizeMm);
  const penColor = useStore((s) => s.penColor);
  const activeTool = useStore((s) => s.tools.find((tool) => tool.id === s.activeToolId));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const penDetails = normalizePenDetailSettings(activeTool?.settings);
  const d = previewDiscCssPx(penSizeMm);
  const transparent = penColor === TRANSPARENT;

  useEffect(() => {
    if (!detailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detailsOpen]);

  const setDetail = (key: keyof PenDetailSettings, value: number) =>
    engine.updateActiveToolSettings({ [key]: value });

  return (
    <>
      <Box className="section">
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
            ペンの太さ
          </Typography>
          <Button size="small" onClick={() => setDetailsOpen(true)} sx={{ fontSize: 11, py: 0.25, px: 1 }}>
            詳細設定…
          </Button>
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
              className={transparent ? 'checker' : undefined}
              sx={{
                width: d,
                height: d,
                borderRadius: '50%',
                minWidth: 2,
                minHeight: 2,
                bgcolor: transparent ? undefined : penColor,
              }}
            />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <MmControl
              valueMm={penSizeMm}
              min={SIZE_MM_MIN}
              max={SIZE_MM_MAX}
              onChange={mm => engine.setPenSizeMm(mm)}
            />
          </Box>
        </Stack>
      </Box>
      <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} maxWidth="xs" fullWidth>
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
          <DetailSlider label="入り" value={penDetails.taperIn} onChange={(value) => setDetail('taperIn', value)} />
          <DetailSlider label="抜き" value={penDetails.taperOut} onChange={(value) => setDetail('taperOut', value)} />
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
