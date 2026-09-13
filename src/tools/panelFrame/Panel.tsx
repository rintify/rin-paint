import { Box, Stack, Switch, Typography } from '@mui/material';
import { ColorField } from '../../components/ColorField';
import { useEngine } from '../../components/EngineContext';
import { useStore } from '../../state/store';
import { SizePanel } from '../shape/SizePanel';
import { normalizePanelFrameToolSettings } from './settings';

export function PanelFrameSettingsPanel() {
  const engine = useEngine();
  const active = useStore(state => state.tools.find(tool => tool.id === state.activeToolId));
  const settings = normalizePanelFrameToolSettings(active?.settings);
  return (
    <Box className="section">
      <Stack spacing={1.5}>
        <Typography variant="caption" color="text.secondary">枠の太さ</Typography>
        <SizePanel />
        <ColorField label="枠の色" value={settings.outlineColor} onChange={outlineColor => engine.updateActiveToolSettings({ outlineColor })} />
        <Stack direction="row" sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>正方形に固定</Typography>
          <Switch checked={settings.constrainAspect} onChange={event => engine.updateActiveToolSettings({ constrainAspect: event.target.checked })} />
        </Stack>
      </Stack>
    </Box>
  );
}
