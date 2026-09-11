import CloseIcon from '@mui/icons-material/Close';
import {
  Box,
  Button,
  FormControl,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useEngine } from '../EngineContext';
import { useStore } from '../../state/store';
import { BLEND_OPTIONS, type BlendMode, type LayerMeta } from '../../model';
import { layerTypeHandler } from '../../engine/layer-types/registry';
import { CommitSlider } from './CommitSlider';
import { layerControlsPanel } from './layerControls';
import { MultiParameterControls } from './MultiParameterControls';

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

function LayerControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const multi = useStore(s => s.multiSelectMode);
  if (multi) return <MultiLayerControls />;
  const handler = layerTypeHandler(meta.type);
  const TypeControls = layerControlsPanel(meta.type);
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
      {handler.supportsBlend && (
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
      {TypeControls && <TypeControls meta={meta} />}
    </Stack>
  );
}

function MultiLayerControls() {
  const layers = useStore(s => s.layers);
  const ids = useStore(s => s.selectedLayerIds);
  const selected = layers.filter(layer => ids.includes(layer.id));
  return (
    <Stack spacing={1.25}>
      <Typography variant="caption" color="text.secondary">
        {selected.length}レイヤーの共通設定。異なる値は「—」で表示します。
      </Typography>
      <MultiParameterControls layers={selected} />
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
