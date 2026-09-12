import { Box, FormControl, MenuItem, Select, Typography } from '@mui/material';
import { useEngine } from '../../components/EngineContext';
import { LabeledControl } from '../../components/inspectorLayout';
import { useStore } from '../../state/store';
import { normalizeEyedropperToolSettings, type EyedropperSource } from './settings';

export function EyedropperSettingsPanel() {
  const engine = useEngine();
  const activeTool = useStore((state) => state.tools.find((tool) => tool.id === state.activeToolId));
  const settings = normalizeEyedropperToolSettings(activeTool?.settings);

  return (
    <Box className="section">
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        スポイト設定
      </Typography>
      <LabeledControl label="取得元">
        <FormControl fullWidth size="small">
          <Select
            value={settings.source}
            inputProps={{ 'aria-label': '取得元' }}
            onChange={(event) => engine.updateActiveToolSettings({ source: event.target.value as EyedropperSource })}
          >
            <MenuItem value="active-layer">選択中のレイヤー</MenuItem>
            <MenuItem value="final-color">最終描画色</MenuItem>
          </Select>
        </FormControl>
      </LabeledControl>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        押したまま動かして位置を調整し、離すと色を取得します。
      </Typography>
    </Box>
  );
}
