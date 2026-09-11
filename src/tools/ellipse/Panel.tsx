import { Box, Typography } from '@mui/material';
import { PaintModeSelect } from '../shape/PaintModeSelect';
import { ConstrainAspectSwitch } from '../shape/ConstrainAspectSwitch';
import { SizePanel } from '../shape/SizePanel';

export function EllipseSettingsPanel() {
  return (
    <Box className="section">
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        線の太さ
      </Typography>
      <SizePanel />
      <PaintModeSelect />
      <ConstrainAspectSwitch label="正円に固定" />
    </Box>
  );
}
