import { Box, Stack } from '@mui/material';
import { TRANSPARENT } from '../../model';
import { useEngine } from '../../components/EngineContext';
import { MmControl, previewDiscCssPx } from '../../components/MmControl';
import { useStore } from '../../state/store';
import { SIZE_MM_MAX, SIZE_MM_MIN } from '../../engine/units';

export function SizePanel() {
  const engine = useEngine();
  const penSizeMm = useStore((s) => s.penSizeMm);
  const penColor = useStore((s) => s.penColor);
  const d = previewDiscCssPx(penSizeMm);
  const transparent = penColor === TRANSPARENT;

  return (
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
  );
}
