import FormatTextdirectionLToRIcon from '@mui/icons-material/FormatTextdirectionLToR';
import FormatTextdirectionRToLIcon from '@mui/icons-material/FormatTextdirectionRToL';
import {
  Box,
  FormControl,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useStore } from '../../state/store';
import { useEngine } from '../../components/EngineContext';
import { LabeledControl } from '../../components/inspectorLayout';
import { NumericField } from '../../components/NumericField';
import { normalizeTextToolSettings } from './settings';
import { FontSelect } from './FontSelect';

export function TextSettingsPanel() {
  const engine = useEngine();
  const active = useStore((state) => state.tools.find((tool) => tool.id === state.activeToolId));
  const settings = normalizeTextToolSettings(active?.settings);

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
        <FontSelect value={settings.fontId} onChange={fontId => engine.updateActiveToolSettings({ fontId })} />
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
      </Stack>
    </Box>
  );
}
