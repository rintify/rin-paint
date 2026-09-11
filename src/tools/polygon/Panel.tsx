import { Box, Typography } from '@mui/material';
import { PaintModeSelect } from '../shape/PaintModeSelect';
import { SizePanel } from '../shape/SizePanel';

export function PolygonSettingsPanel() {
  return (
    <Box className="section">
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        線の太さ
      </Typography>
      <SizePanel />
      <PaintModeSelect />
    </Box>
  );
}
