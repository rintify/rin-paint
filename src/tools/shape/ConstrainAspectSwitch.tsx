import { Stack, Switch, Typography } from '@mui/material';
import { useEngine } from '../../components/EngineContext';
import { useStore } from '../../state/store';
import { normalizeShapeToolSettings } from './settings';

export function ConstrainAspectSwitch({ label }: { label: string }) {
  const engine = useEngine();
  const activeTool = useStore(state => state.tools.find(tool => tool.id === state.activeToolId));
  const constrainAspect = normalizeShapeToolSettings(activeTool?.settings).constrainAspect;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>{label}</Typography>
      <Switch
        checked={constrainAspect}
        onChange={event => engine.updateActiveToolSettings({ constrainAspect: event.target.checked })}
        slotProps={{ input: { 'aria-label': label } }}
      />
    </Stack>
  );
}
