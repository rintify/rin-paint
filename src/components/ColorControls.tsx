import { Box } from '@mui/material';
import { useEngine } from './EngineContext';
import { useStore } from '../state/store';
import { ColorField } from './ColorField';

export function ColorControls() {
  const engine = useEngine();
  const penColor = useStore(s => s.penColor);
  return (
    <Box className="section">
      <ColorField
        label="色"
        value={penColor}
        onChange={color => engine.setPenColor(color)}
        allowTransparent
        hint="同じ位置付近を0.5秒長押しでスポイト（最初のスポイトツールの取得元を使用）"
        showHistory
      />
    </Box>
  );
}
