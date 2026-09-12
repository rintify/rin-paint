import FormatTextdirectionLToRIcon from '@mui/icons-material/FormatTextdirectionLToR';
import FormatTextdirectionRToLIcon from '@mui/icons-material/FormatTextdirectionRToL';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import {
  Box,
  Button,
  FormControl,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { STANDARD_FONTS } from '../../engine/text/render';
import { useStore } from '../../state/store';
import { appAlert } from '../../components/AppDialogs';
import { useEngine } from '../../components/EngineContext';
import { pickFile } from '../../components/hooks/pickFile';
import { LabeledControl } from '../../components/inspectorLayout';
import { NumericField } from '../../components/NumericField';
import { normalizeTextToolSettings } from './settings';

export function TextSettingsPanel() {
  const engine = useEngine();
  const active = useStore((state) => state.tools.find((tool) => tool.id === state.activeToolId));
  const fonts = useStore((state) => state.fonts);
  const settings = normalizeTextToolSettings(active?.settings);

  const addFont = () => {
    void pickFile('.ttf,.otf,.woff,.woff2').then((chosen) => {
      if (!chosen) return;
      void engine
        .addFont(chosen)
        .then((font) => {
          if (font && useStore.getState().tool === 'text') {
            engine.updateActiveToolSettings({ fontId: font.id });
          }
        })
        .catch((error) =>
          appAlert(error instanceof Error ? error.message : 'フォントを読み込めませんでした'),
        );
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
        <LabeledControl label="フォント">
          <FormControl size="small" fullWidth>
            <Select
              value={settings.fontId}
              inputProps={{ 'aria-label': 'フォント' }}
              onChange={(event) => {
                if (event.target.value === '__add') addFont();
                else engine.updateActiveToolSettings({ fontId: event.target.value });
              }}
            >
              {[...STANDARD_FONTS, ...fonts].map((font) => (
                <MenuItem key={font.id} value={font.id}>
                  {font.name}
                </MenuItem>
              ))}
              <MenuItem value="__add">
                <UploadFileOutlinedIcon sx={{ mr: 1, fontSize: 18 }} />
                フォントを追加…
              </MenuItem>
            </Select>
          </FormControl>
        </LabeledControl>
        <NumericField
          label="フォントサイズ"
          value={settings.sizePt}
          min={1}
          max={512}
          onCommit={(value) => engine.updateActiveToolSettings({ sizePt: value })}
          unit="pt"
        />
        <NumericField
          label="行間"
          value={settings.lineHeight}
          min={1}
          max={5}
          onCommit={(value) => engine.updateActiveToolSettings({ lineHeight: value })}
          unit="倍"
        />
        <LabeledControl label="方向">
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={settings.direction}
            onChange={(_, value) => {
              if (value) engine.updateActiveToolSettings({ direction: value });
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
        </LabeledControl>
        <LabeledControl label="横位置">
          <FormControl size="small" fullWidth>
            <Select
              value={settings.horizontalAlign}
              inputProps={{ 'aria-label': '横位置' }}
              onChange={(event) => engine.updateActiveToolSettings({ horizontalAlign: event.target.value })}
            >
              <MenuItem value="left">左揃え</MenuItem>
              <MenuItem value="center">中央揃え</MenuItem>
              <MenuItem value="right">右揃え</MenuItem>
            </Select>
          </FormControl>
        </LabeledControl>
        <LabeledControl label="縦位置">
          <FormControl size="small" fullWidth>
            <Select
              value={settings.verticalAlign}
              inputProps={{ 'aria-label': '縦位置' }}
              onChange={(event) => engine.updateActiveToolSettings({ verticalAlign: event.target.value })}
            >
              <MenuItem value="top">上揃え</MenuItem>
              <MenuItem value="center">中央揃え</MenuItem>
              <MenuItem value="bottom">下揃え</MenuItem>
            </Select>
          </FormControl>
        </LabeledControl>
        <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={addFont}>
          フォントファイルを追加
        </Button>
      </Stack>
    </Box>
  );
}
