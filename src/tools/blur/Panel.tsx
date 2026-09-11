import { Box, Slider, Stack, Typography } from '@mui/material';
import { useEngine } from '../../components/EngineContext';
import { useStore } from '../../state/store';

export function BlurSettingsPanel() {
  const engine = useEngine();
  const penSize = useStore((s) => s.penSize);
  const d = Math.min(penSize, 32);

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
        <Slider
          min={1}
          max={128}
          value={penSize}
          onChange={(_, v) => engine.setPenSize(Array.isArray(v) ? v[0] : v)}
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
  );
}
