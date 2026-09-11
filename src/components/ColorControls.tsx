import {
  Box,
  ButtonBase,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEngine } from './EngineContext';
import { useStore } from '../state/store';
import { TRANSPARENT } from '../model';

export function ColorControls() {
  const engine = useEngine();
  const penColor = useStore((s) => s.penColor);
  const colorHistory = useStore((s) => s.colorHistory);
  const kind = useStore((s) => s.tool);
  if (kind === 'lasso' || kind === 'blur' || kind === 'polygonSplit') return null;
  const transparent = penColor === TRANSPARENT;
  const set = (c: string) => engine.setPenColor(c);

  return (
    <Box className="section">
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        色
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1 }}>
        <Box
          component="input"
          type="color"
          className={transparent ? 'inactive' : undefined}
          value={transparent ? '#ffffff' : penColor}
          onChange={(e) => set(e.target.value)}
          sx={{
            width: 46,
            height: 34,
            p: '2px',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'action.hover',
            cursor: 'pointer',
            opacity: transparent ? 0.45 : 1,
          }}
        />
        <Tooltip title="透明 (描いた場所を消す)">
          <ButtonBase
            onClick={() => set(TRANSPARENT)}
            className="checker"
            sx={{
              width: 34,
              height: 34,
              flex: 'none',
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
              outline: transparent ? '2px solid' : 'none',
              outlineColor: 'primary.main',
              outlineOffset: 1,
            }}
            aria-label="透明"
          />
        </Tooltip>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontFamily: 'ui-monospace, monospace' }}
        >
          {transparent ? '透明' : penColor}
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr)',
          gap: 0.625,
        }}
      >
        {colorHistory.map((c) => (
          <ButtonBase
            key={c}
            title={c}
            onClick={() => set(c)}
            sx={{
              aspectRatio: '1',
              borderRadius: 0.75,
              border: '1px solid rgba(255,255,255,0.18)',
              bgcolor: c,
              outline: c === penColor ? '2px solid' : 'none',
              outlineColor: 'primary.main',
              outlineOffset: 1,
            }}
          />
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        同じ位置付近を0.5秒長押しでスポイト (アクティブレイヤーの色を拾います)
      </Typography>
    </Box>
  );
}
