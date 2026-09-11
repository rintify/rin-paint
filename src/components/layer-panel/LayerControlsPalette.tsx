import CloseIcon from '@mui/icons-material/Close';
import {
  Box,
  Button,
  FormControl,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useEngine } from '../EngineContext';
import { TextControls } from '../TextControls';
import { useStore } from '../../state/store';
import { BLEND_OPTIONS, type AdjustParams, type BlendMode, type LayerMeta } from '../../model';
import { MaskControls } from './MaskControls';
import { MultiShapeControls, ShapeControls } from './ShapeControlsPanel';

function CommitSlider({
  value,
  min,
  max,
  onPreview,
  onCommit,
}: {
  value: number | null;
  min: number;
  max: number;
  onPreview: (v: number) => void;
  onCommit: (before: number | null, after: number) => void;
}) {
  const before = useRef<number | null | undefined>(undefined);
  const latest = useRef(value ?? 0);
  if (value !== null) latest.current = value;
  const finish = () => {
    if (before.current !== undefined && before.current !== latest.current) {
      onCommit(before.current, latest.current);
    }
    before.current = undefined;
  };
  return (
    <Slider
      min={min}
      max={max}
      value={value ?? 0}
      className={value === null ? 'mixed-slider' : undefined}
      onChange={(_, v) => {
        if (before.current === undefined) before.current = value;
        latest.current = v as number;
        onPreview(v as number);
      }}
      onChangeCommitted={finish}
      sx={{ flex: 1 }}
    />
  );
}

function OpacityControl({
  value,
  onPreview,
  onCommit,
}: {
  value: number | null;
  onPreview: (value: number) => void;
  onCommit: (before: number | null, after: number) => void;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
        不透明度
      </Typography>
      <CommitSlider value={value} min={0} max={100} onPreview={onPreview} onCommit={onCommit} />
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ width: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flex: 'none' }}
      >
        {value ?? '—'}
      </Typography>
    </Stack>
  );
}

const ADJUST_SLIDERS: { key: keyof AdjustParams; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: '明度', min: 0, max: 200 },
  { key: 'contrast', label: 'コントラスト', min: 0, max: 200 },
  { key: 'hue', label: '色相', min: -180, max: 180 },
  { key: 'saturation', label: '彩度', min: 0, max: 200 },
];

function LayerControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const multi = useStore(s => s.multiSelectMode);
  if (multi) return <MultiLayerControls />;
  const pct = Math.round(meta.opacity * 100);
  return (
    <Stack spacing={1}>
      <OpacityControl
        value={pct}
        onPreview={v => engine.previewLayerProps(meta.id, { opacity: v / 100 })}
        onCommit={(b, a) =>
          engine.commitLayerProps(
            meta.id,
            { opacity: (b ?? pct) / 100 },
            { opacity: a / 100 },
            '不透明度',
          )}
      />
      {meta.type !== 'adjust' && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
            合成
          </Typography>
          <FormControl size="small" fullWidth>
            <Select
              value={meta.blend}
              onChange={(e) =>
                engine.commitLayerProps(
                  meta.id,
                  { blend: meta.blend },
                  { blend: e.target.value as BlendMode },
                  '合成モード',
                )}
            >
              {BLEND_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      )}
      {meta.type === 'adjust' &&
        ADJUST_SLIDERS.map((p) => (
          <Stack direction="row" spacing={1} key={p.key} sx={{ alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>
              {p.label}
            </Typography>
            <CommitSlider
              value={meta.params![p.key]}
              min={p.min}
              max={p.max}
              onPreview={(v) =>
                engine.previewLayerProps(meta.id, { params: { ...meta.params!, [p.key]: v } })}
              onCommit={(b, a) =>
                engine.commitLayerProps(
                  meta.id,
                  { params: { ...meta.params!, [p.key]: b ?? meta.params![p.key] } },
                  { params: { ...meta.params!, [p.key]: a } },
                  '色調補正',
                )}
            />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flex: 'none' }}
            >
              {meta.params![p.key]}
            </Typography>
          </Stack>
        ))}
      {meta.type === 'adjust' && <MaskControls meta={meta} />}
      {meta.type === 'shape' && <ShapeControls meta={meta} />}
      {meta.type === 'text' && <TextControls meta={meta} />}
    </Stack>
  );
}

function MultiLayerControls() {
  const engine = useEngine();
  const layers = useStore(s => s.layers);
  const ids = useStore(s => s.selectedLayerIds);
  const selected = layers.filter(layer => ids.includes(layer.id));
  const common = <T,>(read: (layer: LayerMeta) => T): T | null => {
    if (!selected.length) return null;
    const first = read(selected[0]);
    return selected.every(layer => Object.is(read(layer), first)) ? first : null;
  };
  const opacity = common(layer => Math.round(layer.opacity * 100));
  const visible = common(layer => layer.visible);
  const blend = common(layer => layer.blend);
  const opacityBefore = useRef<Record<string, number> | null>(null);
  return (
    <Stack spacing={1.25}>
      <Typography variant="caption" color="text.secondary">
        {selected.length}レイヤーの共通設定。異なる値は「—」で表示します。
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>表示</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {visible === null ? '—' : visible ? '表示' : '非表示'}
        </Typography>
        <Switch
          checked={visible ?? false}
          onChange={event =>
            engine.commitSelectedLayerProps({}, { visible: event.target.checked }, '複数レイヤーの表示')}
        />
      </Stack>
      <OpacityControl
        value={opacity}
        onPreview={value => {
          if (!opacityBefore.current) {
            opacityBefore.current = Object.fromEntries(selected.map(layer => [layer.id, layer.opacity]));
          }
          engine.previewSelectedLayerProps({ opacity: value / 100 });
        }}
        onCommit={(_, value) => {
          engine.commitSelectedLayerOpacity(
            opacityBefore.current
              ?? Object.fromEntries(selected.map(layer => [layer.id, layer.opacity])),
            value / 100,
          );
          opacityBefore.current = null;
        }}
      />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ width: 72, flex: 'none' }}>合成</Typography>
        <FormControl size="small" fullWidth>
          <Select
            displayEmpty
            value={blend ?? ''}
            onChange={event =>
              engine.commitSelectedLayerProps(
                {},
                { blend: event.target.value as BlendMode },
                '複数レイヤーの合成モード',
              )}
          >
            {!blend && <MenuItem value="" disabled>—</MenuItem>}
            {BLEND_OPTIONS.map(option => (
              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      {selected.length > 0
        && selected.every(layer => layer.type === 'shape' && layer.shape)
        && <MultiShapeControls shapes={selected.map(layer => layer.shape!)} />}
    </Stack>
  );
}

export function LayerControlsPalette({ meta, onClose }: { meta: LayerMeta; onClose: () => void }) {
  const engine = useEngine();
  const multi = useStore(s => s.multiSelectMode);
  const selectedCount = useStore(s => s.selectedLayerIds.length);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const paper = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const clamp = () => {
      const rect = paper.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = rect.left < 8 ? 8 - rect.left : Math.min(0, window.innerWidth - 8 - rect.right);
      const dy = rect.top < 8 ? 8 - rect.top : Math.min(0, window.innerHeight - 8 - rect.bottom);
      if (dx || dy) setPosition(p => ({ x: p.x + dx, y: p.y + dy }));
    };
    const observer = new ResizeObserver(clamp);
    if (paper.current) observer.observe(paper.current);
    window.addEventListener('resize', clamp);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', clamp);
    };
  }, []);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setPosition({
      x: Math.max(current.minX, Math.min(current.maxX, current.left + event.clientX - current.x)),
      y: Math.max(current.minY, Math.min(current.maxY, current.top + event.clientY - current.y)),
    });
  };
  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <Paper
      data-text-controls
      role="region"
      aria-label={`${meta.name}の設定`}
      ref={paper}
      elevation={12}
      className="layer-controls-palette"
      sx={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <Box
        className="layer-controls-palette-title"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const rect = paper.current?.getBoundingClientRect();
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: position.x,
            top: position.y,
            minX: position.x + 8 - (rect?.left ?? 8),
            maxX: position.x + window.innerWidth - 8 - (rect?.right ?? window.innerWidth - 8),
            minY: position.y + 8 - (rect?.top ?? 8),
            maxY: position.y + window.innerHeight - 8 - (rect?.bottom ?? window.innerHeight - 8),
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>
          {multi ? `${selectedCount}レイヤーを複数選択中` : meta.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">パラメータ</Typography>
        <IconButton
          size="small"
          aria-label="レイヤーの設定を閉じる"
          onPointerDown={e => e.stopPropagation()}
          onClick={onClose}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box className="layer-controls-palette-content">
        {multi && (
          <Button
            fullWidth
            size="small"
            variant="outlined"
            sx={{ mb: 1 }}
            onClick={() => engine.exitMultiSelect()}
          >
            複数選択を解除
          </Button>
        )}
        <LayerControls meta={meta} />
      </Box>
    </Paper>
  );
}
