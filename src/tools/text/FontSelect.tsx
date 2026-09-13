import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { Button, FormControl, MenuItem, Select, Stack } from '@mui/material';
import { appAlert } from '../../components/AppDialogs';
import { useEngine } from '../../components/EngineContext';
import { pickFile } from '../../components/hooks/pickFile';
import { LabeledControl } from '../../components/inspectorLayout';
import { STANDARD_FONTS } from '../../engine/text/render';
import { useStore } from '../../state/store';

export function FontSelect({ value, onChange }: { value: string; onChange: (fontId: string) => void }) {
  const engine = useEngine();
  const fonts = useStore(state => state.fonts);
  const addFont = () => {
    void pickFile('.ttf,.otf,.woff,.woff2').then(chosen => {
      if (!chosen) return;
      void engine.addFont(chosen)
        .then(font => { if (font) onChange(font.id); })
        .catch(error => appAlert(error instanceof Error ? error.message : 'フォントを読み込めませんでした'));
    });
  };
  return (
    <Stack spacing={1}>
      <LabeledControl label="フォント">
        <FormControl size="small" fullWidth>
          <Select
            value={value}
            inputProps={{ 'aria-label': 'フォント' }}
            onChange={event => event.target.value === '__add' ? addFont() : onChange(event.target.value)}
          >
            {[...STANDARD_FONTS, ...fonts].map(font => <MenuItem key={font.id} value={font.id}>{font.name}</MenuItem>)}
            <MenuItem value="__add"><UploadFileOutlinedIcon sx={{ mr: 1, fontSize: 18 }} />フォントを追加…</MenuItem>
          </Select>
        </FormControl>
      </LabeledControl>
      <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={addFont}>フォントファイルを追加</Button>
    </Stack>
  );
}
