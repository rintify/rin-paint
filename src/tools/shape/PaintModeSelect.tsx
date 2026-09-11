import { FormControl, MenuItem, Select, Stack, Typography } from '@mui/material';
import type { ShapePaintMode } from '../../model';
import { useEngine } from '../../components/EngineContext';
import { useStore } from '../../state/store';
import { normalizeShapeToolSettings } from './settings';

export function PaintModeSelect() {
  const engine = useEngine();
  const activeTool = useStore((s) => s.tools.find((tool) => tool.id === s.activeToolId));
  const paintMode = normalizeShapeToolSettings(activeTool?.settings).paintMode;

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
        描画方式
      </Typography>
      <FormControl size="small" fullWidth>
        <Select
          value={paintMode}
          onChange={(event) => engine.updateActiveToolSettings({ paintMode: event.target.value as ShapePaintMode })}
        >
          <MenuItem value="stroke">輪郭</MenuItem>
          <MenuItem value="fill-inside">内側塗りつぶし</MenuItem>
          <MenuItem value="fill-outside">外側塗りつぶし</MenuItem>
        </Select>
      </FormControl>
    </Stack>
  );
}
