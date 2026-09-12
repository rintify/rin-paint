import { Box, FormControl, MenuItem, Select } from '@mui/material';
import type { ShapePaintMode } from '../../model';
import { useEngine } from '../../components/EngineContext';
import { LabeledControl } from '../../components/inspectorLayout';
import { useStore } from '../../state/store';
import { normalizeShapeToolSettings } from './settings';

export function PaintModeSelect() {
  const engine = useEngine();
  const activeTool = useStore((s) => s.tools.find((tool) => tool.id === s.activeToolId));
  const paintMode = normalizeShapeToolSettings(activeTool?.settings).paintMode;

  return (
    <Box sx={{ mt: 1.25 }}>
      <LabeledControl label="描画方式">
        <FormControl size="small" fullWidth>
          <Select
            value={paintMode}
            inputProps={{ 'aria-label': '描画方式' }}
            onChange={(event) => engine.updateActiveToolSettings({ paintMode: event.target.value as ShapePaintMode })}
          >
            <MenuItem value="stroke">輪郭</MenuItem>
            <MenuItem value="fill-inside">内側塗りつぶし</MenuItem>
            <MenuItem value="fill-outside">外側塗りつぶし</MenuItem>
          </Select>
        </FormControl>
      </LabeledControl>
    </Box>
  );
}
