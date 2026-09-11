import { Box, Stack, Typography } from '@mui/material';
import { useEngine } from '../../components/EngineContext';
import { MmControl, previewDiscCssPx } from '../../components/MmControl';
import { useStore } from '../../state/store';
import { SIZE_MM_MAX, SIZE_MM_MIN } from '../../engine/units';

export function BlurSettingsPanel() {
  const engine = useEngine();
  const penSizeMm = useStore((s) => s.penSizeMm);
  const d = previewDiscCssPx(penSizeMm);

  return (
    <Box className="section">
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        ぼかしの太さ
      </Typography>
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
            sx={{
              width: d,
              height: d,
              borderRadius: '50%',
              minWidth: 2,
              minHeight: 2,
              bgcolor: '#9db3d4',
              filter: 'blur(3px)',
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
  );
}
