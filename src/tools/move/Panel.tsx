import { Box } from '@mui/material';
import { ToggleControl } from '../../components/inspectorLayout';
import { useEngine } from '../../components/EngineContext';
import { useStore } from '../../state/store';
import { normalizeMoveToolSettings } from './settings';

export function MoveSettingsPanel() {
  const engine = useEngine();
  const tool = useStore((state) => state.tools.find((item) => item.id === state.activeToolId));
  const settings = normalizeMoveToolSettings(tool?.settings);
  return (
    <Box className="section">
      <ToggleControl
        label="スナップ"
        checked={settings.snapEnabled}
        onChange={(checked) => engine.updateActiveToolSettings({ snapEnabled: checked })}
      />
      <ToggleControl
        label="子孫も移動"
        checked={settings.includeDescendants}
        onChange={(checked) => engine.updateActiveToolSettings({ includeDescendants: checked })}
      />
    </Box>
  );
}
