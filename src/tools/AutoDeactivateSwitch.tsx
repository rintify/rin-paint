import { Box, Stack, Switch, Typography } from '@mui/material';
import { useEngine } from '../components/EngineContext';
import { LabeledControl } from '../components/inspectorLayout';
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
    <Box sx={{ mt: 1.25 }}>
      <LabeledControl label="使用後に解除">
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {enabled ? '解除する' : '維持する'}
          </Typography>
          <Switch
            checked={enabled}
            onChange={(event) => engine.updateActiveToolSettings({ autoDeactivateAfterUse: event.target.checked })}
            slotProps={{ input: { 'aria-label': LABEL } }}
          />
        </Stack>
      </LabeledControl>
    </Box>
  );
}
