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
import { STANDARD_FONTS } from '../engine/text/render';
import { useStore } from '../state/store';
import { normalizeTextToolSettings } from '../types';
import { appAlert } from './AppDialogs';
import { useEngine } from './EngineContext';
import { pickFile } from './hooks/pickFile';
import { NumericField } from './NumericField';

export function TextToolSettings() {
  const engine = useEngine();
  const kind = useStore(state => state.tool);
  const active = useStore(state => state.tools.find(tool => tool.id === state.activeToolId));
  const fonts = useStore(state => state.fonts);
  if (kind !== 'text') return null;
  const settings = normalizeTextToolSettings(active?.textSettings);
  const update = useStore.getState().setTextToolSettings;

  const addFont = () => {
    void pickFile('.ttf,.otf,.woff,.woff2').then(chosen => {
      if (!chosen) return;
      void engine.addFont(chosen)
        .then(font => {
          if (font && useStore.getState().tool === 'text') {
            useStore.getState().setTextToolSettings({ fontId: font.id });
          }
        })
        .catch(error =>
          appAlert(error instanceof Error ? error.message : 'フォントを読み込めませんでした'));
    });
  };

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
            if (event.target.value === '__add') addFont();
            else update({ fontId: event.target.value });
          }}
        >
          {[...STANDARD_FONTS, ...fonts].map(font => (
            <MenuItem key={font.id} value={font.id}>{font.name}</MenuItem>
          ))}
          <MenuItem value="__add">
            <UploadFileOutlinedIcon sx={{ mr: 1, fontSize: 18 }} />
            フォントを追加…
          </MenuItem>
        </TextField>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <NumericField
            label="フォントサイズ"
            value={settings.sizePt}
            min={1}
            max={512}
            onCommit={value => update({ sizePt: value })}
            helperText="pt"
          />
          <NumericField
            label="行間"
            value={settings.lineHeight}
            min={1}
            max={5}
            onCommit={value => update({ lineHeight: value })}
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
            onChange={(_, value) => {
              if (value) update({ direction: value });
            }}
          >
            <ToggleButton value="horizontal">
              <FormatTextdirectionLToRIcon sx={{ mr: 0.75, fontSize: 18 }} />
              横書き
            </ToggleButton>
            <ToggleButton value="vertical">
              <FormatTextdirectionRToLIcon sx={{ mr: 0.75, fontSize: 18, transform: 'rotate(90deg)' }} />
              縦書き
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={addFont}>
          フォントファイルを追加
        </Button>
      </Stack>
    </Box>
  );
}
