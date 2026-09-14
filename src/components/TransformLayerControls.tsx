import { Button, Paper, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { useStore } from '../state/store';
import { useEngine } from './EngineContext';
import type { TransformEditMode } from '../engine/transform/TransformEditController';

const MODES: { value: TransformEditMode; label: string; help: string }[] = [
  {
    value: 'perspective',
    label: '自由変形',
    help: '角の□を1つずつ動かす・辺の◇で2つの角をまとめて動かす',
  },
  {
    value: 'scale',
    label: '拡大縮小',
    help: '角の□で拡大縮小、辺の◇で縦・横だけ伸縮',
  },
  {
    value: 'shear',
    label: 'せん断',
    help: '辺の◇を辺に沿ってドラッグして傾ける',
  },
];
export function TransformLayerControls() {
  const engine = useEngine();
  const [mode, setMode] = useState<TransformEditMode>(
    engine.transformEdit.mode,
  );
  const selected = useStore((s) =>
    s.layers.find((layer) => layer.id === s.activeLayerId),
  );
  const multi = useStore((s) => s.multiSelectMode);
  const toolSelected = useStore((s) => !!s.tool);
  if (selected?.type !== 'transform' || multi || toolSelected) return null;
  return (
    <Paper
      data-canvas-ui
      role="region"
      aria-label="トランスフォームの操作"
      elevation={6}
      sx={{
        position: 'absolute',
        top: 12,
        left: 12,
        right: 12,
        width: 'fit-content',
        maxWidth: 'calc(100% - 24px)',
        p: 1.5,
        zIndex: 6,
      }}
    >
      <Stack spacing={1}>
        <Typography variant="subtitle2">自由変形 — {selected.name}</Typography>
        {!selected.visible ? (
          <Typography variant="body2">
            レイヤーを表示すると操作できます。
          </Typography>
        ) : (
          <>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              {MODES.map((item) => (
                <Button
                  key={item.value}
                  size="small"
                  variant={mode === item.value ? 'contained' : 'outlined'}
                  aria-pressed={mode === item.value}
                  onClick={() => {
                    engine.transformEdit.setMode(item.value);
                    setMode(item.value);
                  }}
                >
                  {item.label}
                </Button>
              ))}
              <Button size="small" onClick={() => engine.transformEdit.reset()}>
                リセット
              </Button>
            </Stack>
            <Typography variant="caption">
              色調補正と同じ範囲の合成結果に適用します。
            </Typography>
            <Typography variant="body2">
              枠の内側をドラッグで移動・外側の○で回転
            </Typography>
            <Typography variant="caption">
              {MODES.find((item) => item.value === mode)!.help}
              。離すと元の解像度で確定します。
            </Typography>
          </>
        )}
      </Stack>
    </Paper>
  );
}
