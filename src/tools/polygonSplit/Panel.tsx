import { Box, Typography } from '@mui/material';
import { useEngine } from '../../components/EngineContext';
import { MmControl } from '../../components/MmControl';
import { useStore } from '../../state/store';
import { roundMm, SPLIT_WIDTH_MM_MAX } from '../../engine/units';
import { normalizePolygonSplitToolSettings } from './settings';

export function PolygonSplitSettingsPanel() {
  const engine = useEngine();
  const activeTool = useStore((s) => s.tools.find((tool) => tool.id === s.activeToolId));
  const settings = normalizePolygonSplitToolSettings(activeTool?.settings);

  return (
    <Box className="section">
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        分断幅
      </Typography>
      <MmControl
        label="帯全体"
        valueMm={settings.widthMm}
        min={0}
        max={SPLIT_WIDTH_MM_MAX}
        onChange={(value) => engine.updateActiveToolSettings({ widthMm: roundMm(value) })}
      />
    </Box>
  );
}
