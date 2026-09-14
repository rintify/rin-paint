import { Stack, Switch, Typography } from '@mui/material';
import { useEngine } from '../components/EngineContext';
import { useStore } from '../state/store';

const LABEL = '使用後にツール選択を解除';

export function AutoDeactivateSwitch() {
  const engine = useEngine();
  const enabled = useStore((state) => {
    const tool = state.tools.find((item) => item.id === state.activeToolId);
    return tool?.autoDeactivateAfterUse !== false;
  });
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
        {LABEL}
      </Typography>
      <Switch
        checked={enabled}
        onChange={(event) => engine.setActiveToolAutoDeactivateAfterUse(event.target.checked)}
        slotProps={{ input: { 'aria-label': LABEL } }}
      />
    </Stack>
  );
}
