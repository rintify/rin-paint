import CloseIcon from '@mui/icons-material/Close';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useEngine } from '../EngineContext';
import { useStore } from '../../state/store';
import type { LayerMeta } from '../../model';
import { shapePanelActions } from '../../engine/shapes';
import { ParameterPanel } from './ParameterPanel';
import { LayerLinkControls } from './LayerLinkControls';

function LayerSettingsOverflow({
  meta,
  onRequestLinkDialog,
}: {
  meta: LayerMeta;
  onRequestLinkDialog: () => void;
}) {
  const engine = useEngine();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const shapeActions = meta.type === 'shape' ? shapePanelActions(meta.state.shape) : [];
  return (
    <>
      <IconButton
        size="small"
        aria-label="レイヤー設定のその他の操作"
        sx={{ alignSelf: 'flex-end' }}
        onClick={event => setAnchor(event.currentTarget)}
      >
        <MoreVertIcon />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} disableRestoreFocus>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onRequestLinkDialog();
          }}
        >
          {meta.parameterLink ? 'リンク元を変更' : 'リンク元を設定'}
        </MenuItem>
        {meta.parameterLink && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              void engine.relinkAllLayerParameters(meta.id);
            }}
          >
            互換項目をすべて再リンク
          </MenuItem>
        )}
        {meta.parameterLink && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              engine.removeLayerLink(meta.id);
            }}
          >
            パラメータリンクを解除
          </MenuItem>
        )}
        {shapeActions.map(action => (
          <MenuItem
            key={action.id}
            onClick={() => {
              setAnchor(null);
              if (action.id === 'convertToPolygon') engine.convertRectToPolygon(meta.id);
            }}
          >
            {action.label}
          </MenuItem>
        ))}
        {meta.type === 'image' && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              engine.fitImageAspect(meta.id);
            }}
          >
            比率を画像に合わせる
          </MenuItem>
        )}
      </Menu>
    </>
  );
}

function LayerControls({
  meta,
  onRequestLinkDialog,
}: {
  meta: LayerMeta;
  onRequestLinkDialog: () => void;
}) {
  const multi = useStore(s => s.multiSelectMode);
  const layers = useStore(s => s.layers);
  const ids = useStore(s => s.selectedLayerIds);
  const selected = multi ? layers.filter(layer => ids.includes(layer.id)) : [meta];
  return (
    <Stack spacing={1.5}>
      {multi && (
        <Typography variant="caption" color="text.secondary">
          {selected.length}レイヤーの共通設定。異なる値は「—」で表示します。
        </Typography>
      )}
      <ParameterPanel layers={selected} />
      {!multi && <LayerSettingsOverflow meta={meta} onRequestLinkDialog={onRequestLinkDialog} />}
    </Stack>
  );
}

export function LayerControlsPalette({
  meta,
  onClose,
}: {
  meta: LayerMeta;
  onClose: () => void;
}) {
  const engine = useEngine();
  const multi = useStore(s => s.multiSelectMode);
  const selectedCount = useStore(s => s.selectedLayerIds.length);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [linkDialogRequested, setLinkDialogRequested] = useState(false);
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
        {!multi && (
          <LayerLinkControls
            meta={meta}
            sourceDialogRequested={linkDialogRequested}
            onSourceDialogOpened={() => setLinkDialogRequested(false)}
          />
        )}
        <LayerControls meta={meta} onRequestLinkDialog={() => setLinkDialogRequested(true)} />
      </Box>
    </Paper>
  );
}
