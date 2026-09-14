import { Box } from '@mui/material';
import { useEngine } from '../components/EngineContext';
import { ToggleControl } from '../components/inspectorLayout';
import { normalizeToolSettings } from './registry';
import { useStore } from '../state/store';

const LABEL = '使用後にツール選択を解除';

export function AutoDeactivateSwitch() {
  const engine = useEngine();
  const enabled = useStore((state) => {
    const tool = state.tools.find((item) => item.id === state.activeToolId);
    return tool && state.tool
      ? normalizeToolSettings(state.tool, tool.settings).autoDeactivateAfterUse !== false
      : true;
  });
  return (
    <Box className="section">
      <ToggleControl
        label="使用後に解除"
        ariaLabel={LABEL}
        checked={enabled}
        onChange={(checked) => engine.updateActiveToolSettings({ autoDeactivateAfterUse: checked })}
      />
    </Box>
  );
}
