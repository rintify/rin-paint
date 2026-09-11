import { Box, Typography } from '@mui/material';
import { useEngine } from '../../components/EngineContext';
import { useStore } from '../../state/store';
import { DetailSlider } from '../DetailSlider';
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
      <DetailSlider
        label="帯全体 (px)"
        value={settings.width}
        max={128}
        onChange={(value) => engine.updateActiveToolSettings({ width: value })}
      />
    </Box>
  );
}
