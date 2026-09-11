import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { formatRange, setRuby, styleAt } from '../engine/text/model';
import { STANDARD_FONTS } from '../engine/text/render';
import { useTextSession } from '../engine/text/session';
import { useStore } from '../state/store';
import type { LayerMeta, TextParams, TextStyle } from '../types';
import { appAlert } from './AppDialogs';
import { useEngine } from './EngineContext';
import { pickFile } from './hooks/pickFile';
import { NumericField } from './NumericField';

export function TextControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const session = useTextSession();
  const fonts = useStore(s => s.fonts);
  const [ruby, setReading] = useState('');
  const text = meta.text!;
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
    <Stack spacing={1.25} data-text-controls>
      <Typography variant="caption" color="text.secondary">
        {selected ? '選択した文字の書式' : 'これから入力する文字の書式'}
      </Typography>
      <TextField
        select
        size="small"
        label="フォント"
        value={style.fontId}
        disabled={session.composing}
        onChange={e => {
          if (e.target.value === '__add') addFont();
          else format({ fontId: e.target.value });
        }}
      >
        {[...STANDARD_FONTS, ...fonts].map(f => (
          <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
        ))}
        <MenuItem value="__add">フォントファイルを追加…</MenuItem>
      </TextField>
      <Stack direction="row" spacing={1}>
        <NumericField
          size="small"
          label="サイズ (pt)"
          value={style.sizePt}
          min={1}
          max={512}
          disabled={session.composing}
          onCommit={n => format({ sizePt: n })}
        />
        <TextField
          size="small"
          label="文字色"
          type="color"
          value={style.color}
          disabled={session.composing}
          onChange={e => format({ color: e.target.value })}
          sx={{ width: 100 }}
        />
      </Stack>
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          label="ルビ"
          value={ruby}
          onChange={e => setReading(e.target.value)}
          disabled={!selected || session.composing}
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
      <Typography variant="caption" color="text.secondary">
        ルビは同じ行の文字を選択して設定します。
      </Typography>
      <TextField
        select
        size="small"
        label="文字全体の方向"
        value={text.direction}
        disabled={session.composing}
        onChange={e =>
          change(before => ({ ...before, direction: e.target.value as TextParams['direction'] }))}
      >
        <MenuItem value="horizontal">横書き</MenuItem>
        <MenuItem value="vertical">縦書き</MenuItem>
      </TextField>
      <NumericField
        size="small"
        label="行間 (倍)"
        value={text.lineHeight}
        min={1}
        max={5}
        disabled={session.composing}
        onCommit={value => change(before => ({ ...before, lineHeight: value }))}
      />
      <NumericField
        size="small"
        label="回転 (度)"
        value={Math.round(((text.rotation ?? 0) * 1800) / Math.PI) / 10}
        min={-3600}
        max={3600}
        disabled={session.composing}
        onCommit={value => change(before => ({ ...before, rotation: (value * Math.PI) / 180 }))}
      />
      <Button onClick={() => engine.editTextLayer(meta.id)}>キャンバス上で文字を編集</Button>
    </Stack>
  );
}
