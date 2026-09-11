import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import TuneIcon from '@mui/icons-material/Tune';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { hasLayerControls } from './layerControls';
import { selectedLayerRows } from '../../engine/layerTree';
import { useStore } from '../../state/store';
import type { LayerMeta } from '../../model';
import { appAlert } from '../AppDialogs';
import { useEngine } from '../EngineContext';
import { useLongPress } from '../hooks/useLongPress';
import { NameEditor } from '../NameEditor';
import { LayerControlsPalette } from './LayerControlsPalette';
import { Thumb } from './Thumb';

interface VisibleRow { id: string; depth: number; index: number; exiting?: boolean }
interface DropTarget {
  parentId: string | null;
  index: number;
  anchorId: string;
  edge: 'before' | 'after' | 'inside';
  depth: number;
}
const ROW_HEIGHT = 48;
const MOTION_MS = 220;

export function LayerPanel() {
  const engine = useEngine();
  const layers = useStore(s => s.layers);
  const rootLayerIds = useStore(s => s.rootLayerIds);
  const activeId = useStore(s => s.activeLayerId);
  const selectedIds = useStore(s => s.selectedLayerIds);
  const multi = useStore(s => s.multiSelectMode);
  const clipboard = useStore(s => s.clipboardAvailable);
  const generation = useStore(s => s.projectGeneration);
  const previousGeneration = useRef(generation);
  const previousMulti = useRef(multi);
  const previousActiveId = useRef(activeId);
  const byId = useMemo(() => new Map(layers.map(l => [l.id, l])), [layers]);
  const active = byId.get(activeId);
  const [palette, setPalette] = useState<{ id: string; open: boolean }>(() => ({
    id: activeId,
    open: !!active && hasLayerControls(active.type),
  }));
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const frozen = useRef<{ id: string; depth: number }[] | null>(null);
  const desired = useMemo(
    () => selectedLayerRows(rootLayerIds, layers, multi ? selectedIds : activeId),
    [rootLayerIds, layers, activeId, multi, selectedIds],
  );
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);
  const renameSubmit = useRef<(() => boolean) | null>(null);
  const pendingRename = useRef<{ id: string; value: string } | null>(null);
  const longPressTarget = useRef<string | null>(null);
  const longPress = useLongPress(() => {
    const id = longPressTarget.current;
    if (!id) return;
    engine.beginMultiSelect(id);
    setPalette({ id, open: true });
  });
  const visible = dragId && frozen.current ? frozen.current : desired;
  const signature = visible.map(r => r.id + ':' + r.depth).join('|');
  const [rows, setRows] = useState<VisibleRow[]>([]);
  const [spacing, setSpacing] = useState({ top: 0, height: 0 });
  const list = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const oldRects = useRef(new Map<string, DOMRect>());
  const pending = useRef<{
    rects: Map<string, DOMRect>;
    anchorY: number | null;
    id: string;
    preserveAnchor: boolean;
  } | null>(null);
  const skipAnchorOnce = useRef(false);
  const animations = useRef<Animation[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadata = useRef(new Map<string, LayerMeta>());
  for (const layer of layers) metadata.current.set(layer.id, layer);
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (timer.current) clearTimeout(timer.current);
    const rects = new Map([...elements.current].map(([id, node]) => [id, node.getBoundingClientRect()]));
    const anchor = rects.get(activeId) ?? oldRects.current.get(activeId);
    const preserveAnchor = !skipAnchorOnce.current;
    skipAnchorOnce.current = false;
    pending.current = {
      rects,
      anchorY: anchor ? anchor.top - el.getBoundingClientRect().top : null,
      id: activeId,
      preserveAnchor,
    };
    const ids = new Set(visible.map(r => r.id));
    setRows(previous => [
      ...visible.map((row, index) => ({ ...row, index })),
      ...previous.filter(row => !ids.has(row.id)).map(row => ({ ...row, exiting: true })),
    ]);
  }, [signature, activeId]);

  useLayoutEffect(() => {
    const el = list.current;
    const change = pending.current;
    if (!el || !change) return;
    pending.current = null;
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    const selected = rows.find(r => r.id === change.id && !r.exiting);
    let top = spacing.top;
    let scroll = el.scrollTop;
    if (selected && change.preserveAnchor) {
      if (change.anchorY !== null) {
        scroll = top + selected.index * ROW_HEIGHT - change.anchorY;
        if (scroll < 0) {
          top -= scroll;
          scroll = 0;
        }
      } else {
        const y = top + selected.index * ROW_HEIGHT;
        if (y < scroll || y + ROW_HEIGHT > scroll + el.clientHeight) {
          scroll = Math.max(0, y - el.clientHeight / 2 + ROW_HEIGHT / 2);
        }
      }
    }
    const height = Math.max(top + visible.length * ROW_HEIGHT + 8, scroll + el.clientHeight);
    const body = el.firstElementChild as HTMLElement;
    body.style.height = height + 'px';
    for (const row of rows) {
      const node = elements.current.get(row.id);
      if (node) node.style.top = top + row.index * ROW_HEIGHT + 'px';
    }
    el.scrollTop = scroll;
    setSpacing({ top, height });
    if (!reduceMotion()) {
      for (const row of rows) {
        const node = elements.current.get(row.id);
        if (!node) continue;
        const before = change.rects.get(row.id);
        const after = node.getBoundingClientRect();
        const dx = before ? before.left - after.left : 0;
        const dy = before ? before.top - after.top : -6;
        animations.current.push(node.animate([
          { transform: 'translate(' + dx + 'px,' + dy + 'px)', opacity: before ? 1 : 0 },
          { transform: 'translate(0,0)', opacity: row.exiting ? 0 : 1 },
        ], { duration: MOTION_MS, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }));
      }
    }
    oldRects.current = new Map([...elements.current].map(([id, node]) => [id, node.getBoundingClientRect()]));
    timer.current = setTimeout(() => {
      for (const animation of animations.current) animation.cancel();
      animations.current = [];
      setRows(current => current.filter(r => !r.exiting));
      oldRects.current = new Map([...elements.current].map(([id, node]) => [id, node.getBoundingClientRect()]));
    }, reduceMotion() ? 0 : MOTION_MS);
  }, [rows]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    for (const animation of animations.current) animation.cancel();
  }, []);
  useEffect(() => {
    if (previousGeneration.current === generation) return;
    previousGeneration.current = generation;
    setMenu(null);
    setDragId(null);
    setDrop(null);
    setPalette({ id: activeId, open: false });
    setSpacing({ top: 0, height: 0 });
  }, [generation]);
  useLayoutEffect(() => {
    if (multi && !previousMulti.current) setPalette({ id: activeId, open: true });
    previousMulti.current = multi;
  }, [multi, activeId]);
  useLayoutEffect(() => {
    if (previousActiveId.current === activeId) return;
    previousActiveId.current = activeId;
    setPalette(current => ({
      id: activeId,
      open: multi ? current.open : !!active && hasLayerControls(active.type),
    }));
  }, [activeId, active, multi]);

  const select = (id: string) => {
    oldRects.current = new Map([...elements.current].map(([key, node]) => [key, node.getBoundingClientRect()]));
    engine.setActiveLayer(id);
  };
  const finishDrag = () => {
    frozen.current = null;
    setDragId(null);
    setDrop(null);
  };
  const menuMeta = menu ? byId.get(menu.id) : undefined;
  const applyDrop = () => {
    if (dragId && drop && engine.canMoveLayer(dragId, drop.parentId)) {
      skipAnchorOnce.current = true;
      if (!engine.moveLayer(dragId, { parentId: drop.parentId, index: drop.index })) {
        skipAnchorOnce.current = false;
      }
    }
    finishDrag();
  };

  return (
    <Box className="section layers-section">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
          レイヤー
        </Typography>
        <Stack direction="row" spacing={0.5}>
          {clipboard && (
            <Button size="small" onClick={() => void engine.pasteLayers().catch(error => appAlert(String(error)))}>
              ペースト
            </Button>
          )}
          <Tooltip title="レイヤーを追加">
            <IconButton size="small" onClick={() => engine.addRasterLayer()} aria-label="レイヤーを追加">
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button
            size="small"
            onClick={() => engine.addAdjustLayer()}
            startIcon={<TuneIcon sx={{ fontSize: 14 }} />}
            sx={{ fontSize: 12 }}
          >
            補正
          </Button>
        </Stack>
      </Stack>
      <Box
        ref={list}
        className="layer-list layer-flat-list"
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDrop(null);
        }}
        onDragOver={event => {
          if (!dragId) return;
          event.preventDefault();
          const el = event.currentTarget;
          const rect = el.getBoundingClientRect();
          const edge = 32;
          if (event.clientY < rect.top + edge) el.scrollTop -= 12;
          else if (event.clientY > rect.bottom - edge) el.scrollTop += 12;
          if (!(event.target as HTMLElement).closest('.layer-flat-row')) {
            const hovered = rows.find(row => {
              const box = elements.current.get(row.id)?.getBoundingClientRect();
              return !row.exiting && box && event.clientY >= box.top && event.clientY <= box.bottom && event.clientX < box.left;
            });
            if (hovered) {
              let anchor = byId.get(hovered.id)!;
              let depth = hovered.depth;
              const targetDepth = Math.max(0, Math.floor((event.clientX - rect.left) / 16));
              while (depth > targetDepth && anchor.parentId) {
                anchor = byId.get(anchor.parentId)!;
                depth--;
              }
              if (engine.canMoveLayer(dragId, anchor.parentId)) {
                const siblings = anchor.parentId ? byId.get(anchor.parentId)!.childIds : rootLayerIds;
                setDrop({
                  parentId: anchor.parentId,
                  index: siblings.indexOf(anchor.id),
                  anchorId: hovered.id,
                  edge: 'after',
                  depth,
                });
              }
            }
          }
        }}
        onDrop={event => {
          event.preventDefault();
          applyDrop();
        }}
      >
        <Box
          sx={{
            position: 'relative',
            height: spacing.height,
            minHeight: visible.length * ROW_HEIGHT + 8,
            flex: 'none',
          }}
        >
          {rows.map(row => {
            const meta = byId.get(row.id) ?? metadata.current.get(row.id);
            if (!meta) return null;
            const isActive = selectedIds.includes(meta.id);
            const guide = drop?.anchorId === meta.id ? drop : null;
            return (
              <Box
                key={meta.id}
                ref={(node: HTMLElement | null) => {
                  if (node) elements.current.set(meta.id, node);
                  else elements.current.delete(meta.id);
                }}
                className={
                  'layer-row layer-flat-row'
                  + (isActive ? ' active' : '')
                  + (dragId === meta.id ? ' is-dragging' : '')
                  + (guide?.edge === 'inside' ? ' drop-inside' : '')
                }
                style={{
                  top: spacing.top + row.index * ROW_HEIGHT,
                  left: row.depth * 16,
                  height: ROW_HEIGHT - 4,
                  pointerEvents: row.exiting ? 'none' : undefined,
                  opacity: row.exiting ? 0 : undefined,
                }}
                draggable={!row.exiting}
                onClick={() => select(meta.id)}
                onPointerDown={event => {
                  if ((event.target as HTMLElement).closest('button')) return;
                  longPressTarget.current = meta.id;
                  longPress.onPointerDown(event);
                }}
                onPointerMove={event => longPress.onPointerMove(event)}
                onPointerUp={longPress.onPointerUp}
                onPointerCancel={longPress.onPointerCancel}
                onDragStart={event => {
                  if ((event.target as HTMLElement).closest('button')) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', meta.id);
                  frozen.current = desired;
                  setDragId(meta.id);
                }}
                onDragEnd={finishDrag}
                onDragOver={event => {
                  if (!dragId || dragId === meta.id) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const ratio = (event.clientY - rect.top) / rect.height;
                  let anchor = meta;
                  let depth = row.depth;
                  const requestedDepth = Math.max(
                    0,
                    Math.floor((event.clientX - list.current!.getBoundingClientRect().left) / 16),
                  );
                  while (depth > requestedDepth && anchor.parentId) {
                    anchor = byId.get(anchor.parentId)!;
                    depth--;
                  }
                  const siblings = anchor.parentId ? byId.get(anchor.parentId)!.childIds : rootLayerIds;
                  const inside = anchor.id === meta.id && ratio >= 0.28 && ratio <= 0.72;
                  const target: DropTarget = inside
                    ? {
                        parentId: meta.id,
                        index: meta.childIds.length,
                        anchorId: meta.id,
                        edge: 'inside',
                        depth: row.depth + 1,
                      }
                    : {
                        parentId: anchor.parentId,
                        index: siblings.indexOf(anchor.id) + (ratio < 0.5 ? 1 : 0),
                        anchorId: meta.id,
                        edge: ratio < 0.5 ? 'before' : 'after',
                        depth,
                      };
                  if (!engine.canMoveLayer(dragId, target.parentId)) {
                    setDrop(null);
                    return;
                  }
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDrop(target);
                }}
                onDrop={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  applyDrop();
                }}
              >
                <IconButton
                  draggable={false}
                  size="small"
                  aria-label="表示切替"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation();
                    engine.commitLayerProps(
                      meta.id,
                      { visible: meta.visible },
                      { visible: !meta.visible },
                      '表示切替',
                    );
                  }}
                >
                  {meta.visible
                    ? <VisibilityIcon sx={{ fontSize: 16 }} />
                    : <VisibilityOffIcon sx={{ fontSize: 16 }} />}
                </IconButton>
                {meta.type === 'adjust' ? <Box className="adjust-badge">補正</Box> : <Thumb meta={meta} />}
                <Typography variant="body2" noWrap sx={{ flex: 1, opacity: meta.visible ? 1 : 0.5 }}>
                  {meta.name}
                </Typography>
                <IconButton
                  draggable={false}
                  size="small"
                  aria-label={meta.name + 'のメニュー'}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation();
                    setMenu({ id: meta.id, anchor: event.currentTarget });
                  }}
                >
                  <MoreVertIcon sx={{ fontSize: 18 }} />
                </IconButton>
                {guide && guide.edge !== 'inside' && (
                  <Box
                    className="layer-insertion-guide"
                    sx={{
                      left: (guide.depth - row.depth) * 16,
                      top: guide.edge === 'before' ? -3 : undefined,
                      bottom: guide.edge === 'after' ? -3 : undefined,
                    }}
                  />
                )}
              </Box>
            );
          })}
          <Box
            sx={{ position: 'absolute', top: spacing.top + visible.length * ROW_HEIGHT, height: 32, left: 0, right: 0 }}
            onDragOver={event => {
              if (!dragId) return;
              event.preventDefault();
              setDrop({ parentId: null, index: 0, anchorId: 'end', edge: 'after', depth: 0 });
            }}
            onDrop={event => {
              event.preventDefault();
              applyDrop();
            }}
          >
            {drop?.anchorId === 'end' && <Box className="layer-insertion-guide" sx={{ left: 0, top: 0 }} />}
          </Box>
        </Box>
      </Box>
      <Menu
        anchorEl={menu?.anchor}
        open={!!menu && !!menuMeta}
        onClose={() => setMenu(null)}
        disableRestoreFocus
        slotProps={{
          transition: {
            onExited: () => {
              if (pendingRename.current) {
                setRename(pendingRename.current);
                pendingRename.current = null;
              }
            },
          },
        }}
      >
        <MenuItem
          onClick={() => {
            if (menu) {
              select(menu.id);
              setPalette({ id: menu.id, open: true });
            }
            setMenu(null);
          }}
        >
          レイヤーの設定
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu && menuMeta) pendingRename.current = { id: menu.id, value: menuMeta.name };
            setMenu(null);
          }}
        >
          名称変更
        </MenuItem>
        <MenuItem
          onClick={() => {
            const id = menu?.id;
            setMenu(null);
            if (id) void engine.copyLayers(id).catch(error => appAlert(String(error)));
          }}
        >
          コピー
        </MenuItem>
        <MenuItem
          disabled={!menuMeta?.canMergeDown}
          onClick={() => {
            const id = menu?.id;
            setMenu(null);
            if (id) void engine.mergeLayerDown(id).catch(error => appAlert(String(error)));
          }}
        >
          下と統合
        </MenuItem>
        <MenuItem
          disabled={!menuMeta?.canRemove}
          onClick={() => {
            if (menu) engine.removeLayer(menu.id);
            setMenu(null);
          }}
          sx={{ color: 'error.main' }}
        >
          削除
        </MenuItem>
      </Menu>
      <Dialog open={!!rename} onClose={() => setRename(null)} maxWidth="xs" fullWidth>
        <DialogTitle>レイヤー名を変更</DialogTitle>
        <DialogContent>
          {rename && (
            <NameEditor
              key={rename.id}
              fullWidth
              value={rename.value}
              editing
              submitRef={renameSubmit}
              onCommit={value => engine.renameLayer(rename.id, value)}
              onCancel={() => setRename(null)}
              onEditingChange={() => setRename(null)}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onMouseDown={event => event.preventDefault()} onClick={() => setRename(null)}>
            キャンセル
          </Button>
          <Button
            variant="contained"
            onMouseDown={event => event.preventDefault()}
            onClick={() => renameSubmit.current?.()}
          >
            変更
          </Button>
        </DialogActions>
      </Dialog>
      {active && palette.id === active.id && palette.open && (
        <LayerControlsPalette meta={active} onClose={() => setPalette({ id: active.id, open: false })} />
      )}
    </Box>
  );
}

export { maskCandidateRows } from './maskCandidates';
