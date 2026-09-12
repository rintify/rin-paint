import { Button, FormControl, MenuItem, Select, Stack, Switch, TextField, Typography } from '@mui/material';
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
import { CanvasMmField } from './CanvasMmField';
import { ParameterLinkIndicator } from './layer-panel/ParameterLinkIndicator';
import { linkedParameterColor } from './layer-panel/parameterLinkUi';
import { ColorField } from './ColorField';
import { FieldStack, LabeledControl } from './inspectorLayout';

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
    <Stack spacing={1.5} data-text-controls>
      <Typography variant="caption" color="text.secondary">
        {selected ? '選択した文字の書式' : 'これから入力する文字の書式'}
      </Typography>
      <Stack spacing={0.75}>
        <LabeledControl label="スナップ" color={linkedParameterColor(meta, 'interaction.snap')}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Switch
              checked={meta.snapEnabled !== false}
              onChange={event => engine.commitLayerProps(
                meta.id,
                { snapEnabled: meta.snapEnabled !== false },
                { snapEnabled: event.target.checked },
                'スナップを変更',
              )}
              slotProps={{ input: { 'aria-label': 'スナップ' } }}
            />
            <ParameterLinkIndicator meta={meta} semanticId="interaction.snap" />
          </Stack>
        </LabeledControl>
        <Typography variant="caption" color="text.secondary">移動の端・中央と90°回転</Typography>
      </Stack>
      <FieldStack>
        <CanvasMmField
          size="small"
          label="X"
          valuePx={text.x}
          onCommitPx={value => change(before => ({ ...before, x: value }))}
          trailing={<ParameterLinkIndicator meta={meta} semanticId="frame.leftMm" />}
          labelColor={linkedParameterColor(meta, 'frame.leftMm')}
        />
        <CanvasMmField
          size="small"
          label="Y"
          valuePx={text.y}
          onCommitPx={value => change(before => ({ ...before, y: value }))}
          trailing={<ParameterLinkIndicator meta={meta} semanticId="frame.topMm" />}
          labelColor={linkedParameterColor(meta, 'frame.topMm')}
        />
      </FieldStack>
      <LabeledControl label="枠幅" color={linkedParameterColor(meta, 'frame.widthMm')}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CanvasMmField
            size="small"
            valuePx={text.width ?? engine.textFrameSize(meta.id)?.width ?? 0}
            disabled={text.width === null}
            onCommitPx={value => change(before => ({ ...before, width: value }))}
          />
          <Typography variant="caption">自動</Typography>
          <Switch
            checked={text.width === null}
            slotProps={{ input: { 'aria-label': '枠幅を自動にする' } }}
            onChange={event => change(before => ({
              ...before,
              width: event.target.checked ? null : (engine.textFrameSize(meta.id)?.width ?? 1),
            }))}
          />
          <ParameterLinkIndicator meta={meta} semanticId="frame.widthMm" />
        </Stack>
      </LabeledControl>
      <LabeledControl label="枠高さ" color={linkedParameterColor(meta, 'frame.heightMm')}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CanvasMmField
            size="small"
            valuePx={text.height ?? engine.textFrameSize(meta.id)?.height ?? 0}
            disabled={text.height === null}
            onCommitPx={value => change(before => ({ ...before, height: value }))}
          />
          <Typography variant="caption">自動</Typography>
          <Switch
            checked={text.height === null}
            slotProps={{ input: { 'aria-label': '枠高さを自動にする' } }}
            onChange={event => change(before => ({
              ...before,
              height: event.target.checked ? null : (engine.textFrameSize(meta.id)?.height ?? 1),
            }))}
          />
          <ParameterLinkIndicator meta={meta} semanticId="frame.heightMm" />
        </Stack>
      </LabeledControl>
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
        value={style.sizePt}
        min={1}
        max={512}
        disabled={session.composing}
        onCommit={n => format({ sizePt: n })}
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
      <LabeledControl label="方向" color={linkedParameterColor(meta, 'text.direction')}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <FormControl size="small" fullWidth>
            <Select
              value={text.direction}
              disabled={session.composing}
              inputProps={{ 'aria-label': '文字全体の方向' }}
              onChange={e => change(before => ({ ...before, direction: e.target.value as TextParams['direction'] }))}
            >
              <MenuItem value="horizontal">横書き</MenuItem>
              <MenuItem value="vertical">縦書き</MenuItem>
            </Select>
          </FormControl>
          <ParameterLinkIndicator meta={meta} semanticId="text.direction" />
        </Stack>
      </LabeledControl>
      <FieldStack>
        <LabeledControl label="横位置" color={linkedParameterColor(meta, 'text.horizontalAlign')}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <FormControl size="small" fullWidth>
              <Select
                value={text.horizontalAlign ?? 'left'}
                disabled={session.composing}
                inputProps={{ 'aria-label': '横位置' }}
                onChange={e => change(before => ({ ...before, horizontalAlign: e.target.value as TextParams['horizontalAlign'] }))}
              >
                <MenuItem value="left">左揃え</MenuItem>
                <MenuItem value="center">中央揃え</MenuItem>
                <MenuItem value="right">右揃え</MenuItem>
              </Select>
            </FormControl>
            <ParameterLinkIndicator meta={meta} semanticId="text.horizontalAlign" />
          </Stack>
        </LabeledControl>
        <LabeledControl label="縦位置" color={linkedParameterColor(meta, 'text.verticalAlign')}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <FormControl size="small" fullWidth>
              <Select
                value={text.verticalAlign ?? 'top'}
                disabled={session.composing}
                inputProps={{ 'aria-label': '縦位置' }}
                onChange={e => change(before => ({ ...before, verticalAlign: e.target.value as TextParams['verticalAlign'] }))}
              >
                <MenuItem value="top">上揃え</MenuItem>
                <MenuItem value="center">中央揃え</MenuItem>
                <MenuItem value="bottom">下揃え</MenuItem>
              </Select>
            </FormControl>
            <ParameterLinkIndicator meta={meta} semanticId="text.verticalAlign" />
          </Stack>
        </LabeledControl>
      </FieldStack>
      <NumericField
        fullWidth size="small" label="行間" value={text.lineHeight} min={1} max={5}
        disabled={session.composing}
        onCommit={value => change(before => ({ ...before, lineHeight: value }))}
        unit="倍"
        trailing={<ParameterLinkIndicator meta={meta} semanticId="text.lineHeight" />}
        labelColor={linkedParameterColor(meta, 'text.lineHeight')}
      />
      <NumericField
        size="small"
        fullWidth
        label="回転"
        unit="度"
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
