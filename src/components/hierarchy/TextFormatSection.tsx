import { Button, FormControl, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { formatRange, setRuby, styleAt } from '../../engine/text/model';
import { STANDARD_FONTS } from '../../engine/text/render';
import { useTextSession } from '../../engine/text/session';
import { useStore } from '../../state/store';
import type { LayerMeta, TextParams, TextStyle } from '../../model';
import { appAlert } from '../AppDialogs';
import { useEngine } from '../EngineContext';
import { pickFile } from '../hooks/pickFile';
import { NumericField } from '../NumericField';
import { ColorField } from '../ColorField';
import { LabeledControl } from '../inspectorLayout';

export function TextFormatSection({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const session = useTextSession();
  const fonts = useStore(s => s.fonts);
  const [ruby, setReading] = useState('');
  if (meta.type !== 'text') return null;
  const text = meta.state.text;
  const selection = session.id === meta.id ? session : { start: 0, end: 0, typingStyle: text.style };
  const selected = selection.start !== selection.end;
  const style = selected ? styleAt(text, selection.start) : selection.typingStyle;
  const change = (make: (text: TextParams) => TextParams) => {
    engine.events.emit('textCommitRequest');
    const before = engine.getText(meta.id);
    if (before) engine.updateText(meta.id, before, make(before));
  };
  const format = (patch: Partial<TextStyle>) => {
    change(before => formatRange(before, selection.start, selection.end, patch));
    if (!selected) session.set({ id: meta.id, typingStyle: { ...style, ...patch } });
  };
  const addFont = () => {
    void pickFile('.ttf,.otf,.woff,.woff2').then(chosen => {
      if (!chosen) return;
      void engine.addFont(chosen)
        .then(font => {
          if (font && useStore.getState().activeLayerId === meta.id) format({ fontId: font.id });
        })
        .catch(error =>
          appAlert(error instanceof Error ? error.message : 'フォントを読み込めませんでした'));
    });
  };
  return (
    <Stack spacing={1.5} data-text-controls>
      <Typography variant="caption" color="text.secondary">
        {selected ? '選択した文字の書式' : 'これから入力する文字の書式'}
      </Typography>
      <LabeledControl label="フォント">
        <FormControl size="small" fullWidth>
          <Select
            value={style.fontId}
            disabled={session.composing}
            inputProps={{ 'aria-label': 'フォント' }}
            onChange={e => {
              if (e.target.value === '__add') addFont();
              else format({ fontId: e.target.value });
            }}
          >
            {[...STANDARD_FONTS, ...fonts].map(f => (
              <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
            ))}
            <MenuItem value="__add">フォントファイルを追加…</MenuItem>
          </Select>
        </FormControl>
      </LabeledControl>
      <NumericField
        size="small"
        fullWidth
        label="サイズ"
        value={style.sizeMm * 72 / 25.4}
        min={1}
        max={512}
        disabled={session.composing}
        onCommit={n => format({ sizeMm: n * 25.4 / 72 })}
        unit="pt"
      />
      <ColorField
        label="文字色"
        value={style.color}
        disabled={session.composing}
        onChange={color => format({ color })}
      />
      <LabeledControl label="ルビ">
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            fullWidth
            value={ruby}
            onChange={e => setReading(e.target.value)}
            disabled={!selected || session.composing}
            slotProps={{ htmlInput: { 'aria-label': 'ルビ' } }}
          />
          <Button
            disabled={
              !selected
              || session.composing
              || text.content.slice(selection.start, selection.end).includes('\n')
            }
            onClick={() => change(before => setRuby(before, selection.start, selection.end, ruby))}
          >
            {ruby.trim() ? '設定' : '解除'}
          </Button>
        </Stack>
      </LabeledControl>
      <Typography variant="caption" color="text.secondary">
        ルビは同じ行の文字を選択して設定します。
      </Typography>
      <Button onClick={() => engine.editTextLayer(meta.id)}>ページ上で文字を編集</Button>
    </Stack>
  );
}
