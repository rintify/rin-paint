import { Box, Typography } from '@mui/material';
import { useEngine } from '../../components/EngineContext';
import { MmControl } from '../../components/MmControl';
import { useStore } from '../../state/store';
import { GAP_CLOSE_MM_MAX, roundMm } from '../../engine/units';
import { DetailSlider } from '../DetailSlider';
import { normalizeFillToolSettings } from './settings';

export function FillSettingsPanel() {
  const engine = useEngine();
  const activeTool = useStore((s) => s.tools.find((tool) => tool.id === s.activeToolId));
  const activeLayer = useStore((s) => s.layers.find((layer) => layer.id === s.activeLayerId));
  const settings = normalizeFillToolSettings(activeTool?.settings);

  return (
    <Box className="section">
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        塗りつぶし設定
      </Typography>
      <MmControl
        label="隙間閉じ (mm)"
        valueMm={settings.gapCloseMm}
        min={0}
        max={GAP_CLOSE_MM_MAX}
        onChange={(value) => engine.updateActiveToolSettings({ gapCloseMm: roundMm(value) })}
      />
      <DetailSlider
        label="色の誤差許容"
        value={settings.colorTolerance}
        onChange={(value) => engine.updateActiveToolSettings({ colorTolerance: value })}
      />
      {(!activeLayer || activeLayer.type !== 'raster' || !activeLayer.visible) && (
        <Typography variant="caption" color="error">
          表示中のラスターレイヤーを主選択してください。
        </Typography>
      )}
    </Box>
  );
}
