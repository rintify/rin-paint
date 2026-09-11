import FormatTextdirectionLToRIcon from '@mui/icons-material/FormatTextdirectionLToR';
import FormatTextdirectionRToLIcon from '@mui/icons-material/FormatTextdirectionRToL';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import {
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useRef } from 'react';
import { engine } from '../engine/PaintEngine';
import { STANDARD_FONTS } from '../engine/text/render';
import { useStore } from '../state/store';
import { normalizeTextToolSettings } from '../types';
import { appAlert } from './AppDialogs';

export function TextToolSettings() {
  const kind = useStore(state => state.tool);
  const active = useStore(state => state.tools.find(tool => tool.id === state.activeToolId));
  const fonts = useStore(state => state.fonts);
  const file = useRef<HTMLInputElement>(null);
  if (kind !== 'text') return null;
  const settings = normalizeTextToolSettings(active?.textSettings);
  const update = useStore.getState().setTextToolSettings;

  return (
    <Box className="section text-tool-settings">
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', letterSpacing: 1 }}>
            文字
          </Typography>
          <Typography variant="caption" color="text.secondary">
            新しく作る文字の初期設定
          </Typography>
        </Box>
        <TextField
          select
          fullWidth
          label="フォント"
          value={settings.fontId}
          onChange={event => {
            if (event.target.value === '__add') file.current?.click();
            else update({ fontId: event.target.value });
          }}
        >
          {[...STANDARD_FONTS, ...fonts].map(font => (
            <MenuItem key={font.id} value={font.id}>{font.name}</MenuItem>
          ))}
          <MenuItem value="__add">
            <UploadFileOutlinedIcon sx={{ mr: 1, fontSize: 18 }} />フォントを追加…
          </MenuItem>
        </TextField>
        <input
          ref={file}
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          hidden
          onChange={event => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (!chosen) return;
            void engine.addFont(chosen)
              .then(font => { if (font && useStore.getState().tool === 'text') useStore.getState().setTextToolSettings({ fontId: font.id }); })
              .catch(error => appAlert(error instanceof Error ? error.message : 'フォントを読み込めませんでした'));
          }}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <TextField
            label="フォントサイズ"
            type="number"
            value={settings.sizePt}
            slotProps={{ htmlInput: { min: 1, max: 512, step: 0.5 } }}
            onChange={event => {
              const value = Number(event.target.value);
              if (value >= 1 && value <= 512) update({ sizePt: value });
            }}
            helperText="pt"
          />
          <TextField
            label="行間"
            type="number"
            value={settings.lineHeight}
            slotProps={{ htmlInput: { min: 1, max: 5, step: 0.1 } }}
            onChange={event => {
              const value = Number(event.target.value);
              if (value >= 1 && value <= 5) update({ lineHeight: value });
            }}
            helperText="倍"
          />
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            方向
          </Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={settings.direction}
            onChange={(_, value) => { if (value) update({ direction: value }); }}
          >
            <ToggleButton value="horizontal">
              <FormatTextdirectionLToRIcon sx={{ mr: 0.75, fontSize: 18 }} />横書き
            </ToggleButton>
            <ToggleButton value="vertical">
              <FormatTextdirectionRToLIcon sx={{ mr: 0.75, fontSize: 18, transform: 'rotate(90deg)' }} />縦書き
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => file.current?.click()}>
          フォントファイルを追加
        </Button>
      </Stack>
    </Box>
  );
}
