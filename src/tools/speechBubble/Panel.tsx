import { Box, FormControl, MenuItem, Select, Stack, Switch, Typography } from '@mui/material';
import { ColorField } from '../../components/ColorField';
import { useEngine } from '../../components/EngineContext';
import { LabeledControl } from '../../components/inspectorLayout';
import { MmControl } from '../../components/MmControl';
import { NumericField } from '../../components/NumericField';
import { SIZE_MM_MAX } from '../../engine/units';
import { useStore } from '../../state/store';
import { SizePanel } from '../shape/SizePanel';
import { FontSelect } from '../text/FontSelect';
import { normalizeSpeechBubbleToolSettings } from './settings';

export function SpeechBubbleSettingsPanel() {
  const engine = useEngine();
  const active = useStore(state => state.tools.find(tool => tool.id === state.activeToolId));
  const settings = normalizeSpeechBubbleToolSettings(active?.settings);
  const update = (patch: Record<string, unknown>) => engine.updateActiveToolSettings(patch);
  return (
    <Box className="section">
      <Stack spacing={1.5}>
        <LabeledControl label="本体">
          <FormControl size="small" fullWidth><Select value={settings.bodyKind} onChange={event => update({ bodyKind: event.target.value })}>
            <MenuItem value="rect">四角形</MenuItem><MenuItem value="ellipse">楕円</MenuItem>
          </Select></FormControl>
        </LabeledControl>
        <Typography variant="caption" color="text.secondary">枠の太さ</Typography>
        <SizePanel />
        <ColorField label="枠の色" value={settings.outlineColor} onChange={outlineColor => update({ outlineColor })} />
        <LabeledControl label="しっぽ">
          <FormControl size="small" fullWidth><Select value={settings.tailStyle} onChange={event => update({ tailStyle: event.target.value })}>
            <MenuItem value="none">なし</MenuItem><MenuItem value="pointed">普通</MenuItem><MenuItem value="rounds">丸が連なる</MenuItem>
          </Select></FormControl>
        </LabeledControl>
        {settings.tailStyle !== 'none' && <MmControl label="しっぽの太さ" valueMm={settings.tailWidthMm} min={.01} max={SIZE_MM_MAX} onChange={tailWidthMm => update({ tailWidthMm })} />}
        {settings.tailStyle === 'rounds' && <NumericField label="丸の数" value={settings.circleCount} min={2} max={20} onCommit={circleCount => update({ circleCount })} />}
        {settings.tailStyle === 'rounds' && <NumericField
          label="間隔減衰"
          value={Math.round(settings.tailSpacingDecay * 100)}
          min={0}
          max={100}
          unit="%"
          onCommit={value => update({ tailSpacingDecay: value / 100 })}
        />}
        <ColorField label="文字の色" value={settings.textColor} onChange={textColor => update({ textColor })} />
        <FontSelect value={settings.fontId} onChange={fontId => update({ fontId })} />
        <NumericField label="フォントサイズ" value={settings.fontSizePt} min={1} max={512} unit="pt" onCommit={fontSizePt => update({ fontSizePt })} />
        <MmControl label="文字余白" valueMm={settings.textPaddingMm} min={0} max={SIZE_MM_MAX} onChange={textPaddingMm => update({ textPaddingMm })} />
        <Stack direction="row" sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>縦横比を固定</Typography>
          <Switch checked={settings.constrainAspect} onChange={event => update({ constrainAspect: event.target.checked })} />
        </Stack>
      </Stack>
    </Box>
  );
}
