import { FormControl, MenuItem, Select, Stack } from '@mui/material';
import type { ShapeStrokeJoin } from '../../model';
import { useEngine } from '../../components/EngineContext';
import { LabeledControl } from '../../components/inspectorLayout';
import { SliderField } from '../../components/SliderField';
import { useStore } from '../../state/store';
import { SIZE_MM_MAX } from '../../engine/units';
import { normalizeShapeToolSettings } from './settings';

export function CornerControls() {
  const engine = useEngine();
  const activeTool = useStore(state => state.tools.find(tool => tool.id === state.activeToolId));
  const settings = normalizeShapeToolSettings(activeTool?.settings);
  return (
    <Stack spacing={1.5} sx={{ mt: 1.25 }}>
      <LabeledControl label="線の角">
        <FormControl size="small" fullWidth>
          <Select
            value={settings.strokeJoin}
            inputProps={{ 'aria-label': '線の角' }}
            onChange={event => engine.updateActiveToolSettings({ strokeJoin: event.target.value as ShapeStrokeJoin })}
          >
            <MenuItem value="round">丸</MenuItem>
            <MenuItem value="miter">角</MenuItem>
          </Select>
        </FormControl>
      </LabeledControl>
      <SliderField
        label="角丸半径"
        value={settings.cornerRadiusMm}
        min={0}
        max={SIZE_MM_MAX}
        unit="mm"
        scale="mm"
        onPreview={cornerRadiusMm => engine.updateActiveToolSettings({ cornerRadiusMm })}
        onCommit={(_before, cornerRadiusMm) => engine.updateActiveToolSettings({ cornerRadiusMm })}
      />
    </Stack>
  );
}
