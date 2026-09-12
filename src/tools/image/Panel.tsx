import { Box, Typography } from '@mui/material';
import { useEngine } from '../../components/EngineContext';
import { NumericField } from '../../components/NumericField';
import { useStore } from '../../state/store';
import { formatMm, roundMm } from '../../engine/units';
import { IMAGE_SIZE_MM_MAX, IMAGE_SIZE_MM_MIN, normalizeImageToolSettings } from './settings';

export function ImageSettingsPanel() {
  const engine = useEngine();
  const activeTool = useStore(state => state.tools.find(tool => tool.id === state.activeToolId));
  const settings = normalizeImageToolSettings(activeTool?.settings);

  return (
    <Box className="section">
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        配置サイズ
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        クリックした位置を左上にして、指定した幅・高さに収まるよう画像を拡大縮小します。
      </Typography>
      <NumericField
        size="small"
        fullWidth
        label="幅"
        value={settings.widthMm}
        min={IMAGE_SIZE_MM_MIN}
        max={IMAGE_SIZE_MM_MAX}
        format={formatMm}
        unit="mm"
        onCommit={value => engine.updateActiveToolSettings({ widthMm: roundMm(value) })}
        sx={{ mb: 1.5 }}
      />
      <NumericField
        size="small"
        fullWidth
        label="高さ"
        value={settings.heightMm}
        min={IMAGE_SIZE_MM_MIN}
        max={IMAGE_SIZE_MM_MAX}
        format={formatMm}
        unit="mm"
        onCommit={value => engine.updateActiveToolSettings({ heightMm: roundMm(value) })}
      />
    </Box>
  );
}
