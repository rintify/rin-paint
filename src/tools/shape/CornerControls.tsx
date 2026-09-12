import { FormControl, MenuItem, Select, Stack, Typography } from '@mui/material';
import type { ShapeStrokeJoin } from '../../model';
import { useEngine } from '../../components/EngineContext';
import { MmInlineControl } from '../../components/MmControl';
import { useStore } from '../../state/store';
import { SIZE_MM_MAX } from '../../engine/units';
import { normalizeShapeToolSettings } from './settings';

export function CornerControls() {
  const engine = useEngine();
  const activeTool = useStore(state => state.tools.find(tool => tool.id === state.activeToolId));
  const settings = normalizeShapeToolSettings(activeTool?.settings);
  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.25 }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>線の角</Typography>
        <FormControl size="small" fullWidth>
          <Select
            value={settings.strokeJoin}
            onChange={event => engine.updateActiveToolSettings({ strokeJoin: event.target.value as ShapeStrokeJoin })}
            inputProps={{ 'aria-label': '線の角' }}
          >
            <MenuItem value="round">丸</MenuItem>
            <MenuItem value="miter">角</MenuItem>
          </Select>
        </FormControl>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.25 }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>角丸半径</Typography>
        <MmInlineControl
          valueMm={settings.cornerRadiusMm}
          min={0}
          max={SIZE_MM_MAX}
          onChange={cornerRadiusMm => engine.updateActiveToolSettings({ cornerRadiusMm })}
        />
      </Stack>
    </>
  );
}
