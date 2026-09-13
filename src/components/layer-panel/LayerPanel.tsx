import AddIcon from '@mui/icons-material/Add';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import LibraryAddCheckIcon from '@mui/icons-material/LibraryAddCheck';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import LinkIcon from '@mui/icons-material/Link';
import {
  Badge,
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
import { liftListOriginIfTooLow } from './layerListLayout';
import { selectedLayerRows } from '../../engine/layerTree';
import { useStore } from '../../state/store';
import type { LayerMeta } from '../../model';
import { identityTransformState } from '../../model';
import { appAlert } from '../AppDialogs';
import { useEngine } from '../EngineContext';
import { useLongPress } from '../hooks/useLongPress';
import { NameEditor } from '../NameEditor';
import { LayerControlsPalette } from './LayerControlsPalette';
import { Thumb } from './Thumb';
import { LAYER_FOCUS_EVENT } from './layerPanelEvents';
import { BinPanel } from '../BinPanel';

interface VisibleRow { id: string; depth: number; index: number; exiting?: boolean }
interface DropTarget {
  scopeId: string | null;
  index: number;
  anchorId: string;
  edge: 'before' | 'after' | 'inside';
  depth: number;
  stackWithId?: string;
}
const ROW_HEIGHT = 48;
const MOTION_MS = 220;

export function HierarchyPanel() {
  const engine = useEngine();
  const layers = useStore(s => s.layers);
  const rootLayerIds = useStore(s => s.rootLayerIds);
  const hierarchy = useStore(s => s.hierarchy);
  const activeId = useStore(s => s.activeLayerId);
  const selectedIds = useStore(s => s.selectedLayerIds);
  const multi = useStore(s => s.multiSelectMode);
  const clipboard = useStore(s => s.clipboardAvailable);
  const generation = useStore(s => s.projectGeneration);
  const previousGeneration = useRef(generation);
  const previousMulti = useRef(multi);
  const previousActiveId = useRef(activeId);
  const requestedPaletteId = useRef<string | null>(null);
  const byId = useMemo(() => new Map(layers.map(l => [l.id, l])), [layers]);
  const active = byId.get(activeId);
  const [palette, setPalette] = useState<{ id: string; open: boolean }>(() => ({
    id: activeId,
    open: !!active && hasLayerControls(active.type),
  }));
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [addEffectAnchor, setAddEffectAnchor] = useState<HTMLElement | null>(null);
  const [binOpen, setBinOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [canvasDropChoice, setCanvasDropChoice] = useState<{ dragId: string; canvasId: string; index: number } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; token: number } | null>(null);
  const frozen = useRef<{ id: string; depth: number }[] | null>(null);
  const stacks = useMemo(() => [
    ...hierarchy.filter(item => item.kind === 'stack'),
    ...layers.flatMap(layer => layer.type === 'canvas'
      ? layer.state.hierarchy.filter(item => item.kind === 'stack')
      : []),
  ], [hierarchy, layers]);
  const stackByLayer = useMemo(() => new Map(stacks.flatMap(stack => stack.layerIds.map(id => [id, stack] as const))), [stacks]);
  const collapsedStackByLayer = useMemo(() => {
    const result = new Map<string, (typeof stacks)[number]>();
    for (const stack of stacks) if (!stack.layerIds.some(id => selectedIds.includes(id))) {
      for (const id of stack.layerIds) result.set(id, stack);
    }
    return result;
  }, [stacks, selectedIds]);
  const desired = useMemo(() => {
    const rows = selectedLayerRows(
      rootLayerIds,
      layers,
      [...(multi ? selectedIds : [activeId]), ...(focusRequest ? [focusRequest.id] : [])],
    );
    return rows.filter(row => {
      const stack = collapsedStackByLayer.get(row.id);
      return !stack || stack.layerIds[0] === row.id;
    });
  }, [rootLayerIds, layers, activeId, multi, selectedIds, focusRequest, collapsedStackByLayer]);
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);
  const renameSubmit = useRef<(() => boolean) | null>(null);
  const pendingRename = useRef<{ id: string; value: string } | null>(null);
  const longPressTarget = useRef<string | null>(null);
  const ignoreClick = useRef(false);
  const longPress = useLongPress(() => {
    const id = longPressTarget.current;
    if (!id) return;
    const stack = stackByLayer.get(id);
    if (stack) {
      ignoreClick.current = true;
      engine.setStackSelection(id, !selectedIds.includes(id));
      return;
    }
    const layer = byId.get(id) ?? metadata.current.get(id);
    if (!layer?.scopeLayerIds.length) return;
    ignoreClick.current = true;
    engine.toggleDescendantSelection(id);
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
    if (!frozen.current) {
      const lifted = liftListOriginIfTooLow(top, scroll, el.clientHeight);
      top = lifted.top;
      scroll = lifted.scroll;
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
    const focus = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      setFocusRequest(current => ({ id, token: (current?.token ?? 0) + 1 }));
    };
    window.addEventListener(LAYER_FOCUS_EVENT, focus);
    return () => window.removeEventListener(LAYER_FOCUS_EVENT, focus);
  }, []);
  useLayoutEffect(() => {
    if (!focusRequest || rows.some(row => row.id === focusRequest.id && row.exiting)) return;
    const el = list.current;
    const node = elements.current.get(focusRequest.id);
    if (!el || !node) return;
    const rowTop = Number.parseFloat(node.style.top) || 0;
    const top = Math.max(0, rowTop - Math.max(0, el.clientHeight - ROW_HEIGHT) / 2);
    if (reduceMotion()) el.scrollTop = top;
    else if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: 'smooth' });
    else el.scrollTop = top;
    if (!reduceMotion()) {
      node.animate([
        { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(128,191,255,0)' },
        { transform: 'scale(1.06)', boxShadow: '0 0 0 4px rgba(128,191,255,.55)' },
        { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(128,191,255,0)' },
      ], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }, [rows, focusRequest]);
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
    const explicitlyRequested = requestedPaletteId.current === activeId;
    if (explicitlyRequested) requestedPaletteId.current = null;
    setPalette(current => ({
      id: activeId,
      open: multi ? current.open : explicitlyRequested || (!!active && hasLayerControls(active.type)),
    }));
  }, [activeId, active, multi]);

  const select = (id: string, additive = false) => {
    if (ignoreClick.current) {
      ignoreClick.current = false;
      return;
    }
    oldRects.current = new Map([...elements.current].map(([key, node]) => [key, node.getBoundingClientRect()]));
    setFocusRequest(null);
    const stack = collapsedStackByLayer.get(id);
    if (stack) engine.setStackSelection(id, true);
    else if (additive) engine.beginMultiSelect(id);
    else engine.setActiveLayer(id);
  };
  const finishDrag = () => {
    frozen.current = null;
    setDragId(null);
    setDrop(null);
  };
  const menuMeta = menu ? byId.get(menu.id) : undefined;
  const menuStack = menu ? stackByLayer.get(menu.id) : undefined;
  const applyDrop = () => {
    if (dragId && drop?.stackWithId) {
      engine.createStack([drop.stackWithId, dragId]);
      finishDrag();
      return;
    }
    if (dragId && drop?.scopeId) {
      const canvas = byId.get(drop.scopeId);
      const expanded = canvas?.type === 'canvas' && (selectedIds.includes(canvas.id)
        || selectedIds.some(id => byId.get(id)?.scopeId === canvas.id));
      if (canvas?.type === 'canvas' && !expanded) {
        setCanvasDropChoice({ dragId, canvasId: canvas.id, index: drop.index });
        finishDrag();
        return;
      }
    }
    if (dragId && drop && engine.canMoveLayer(dragId, drop.scopeId)) {
      skipAnchorOnce.current = true;
      if (!engine.moveLayer(dragId, { scopeId: drop.scopeId, index: drop.index })) {
        skipAnchorOnce.current = false;
      }
    }
    finishDrag();
  };

  return (
    <Box className="section layers-section">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
          ヒエラルキー
        </Typography>
        <Stack direction="row" spacing={0.5}>
          {clipboard && (
            <Button size="small" onClick={() => void engine.pasteLayers().catch(error => appAlert(String(error)))}>
              ペースト
            </Button>
          )}
          <Tooltip title={multi ? '複数選択を解除' : '複数選択'}>
            <IconButton
              size="small"
              color={multi ? 'primary' : 'default'}
              aria-label={multi ? '複数選択を解除' : '複数選択'}
              aria-pressed={multi}
              onClick={() => {
                if (multi) engine.exitMultiSelect();
                else engine.beginMultiSelect(activeId);
              }}
            >
              <LibraryAddCheckIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="レイヤーを追加">
            <IconButton size="small" onClick={() => engine.addRasterLayer()} aria-label="レイヤーを追加">
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="キャンバスレイヤーを追加">
            <IconButton size="small" onClick={() => engine.addCanvasLayer()} aria-label="キャンバスレイヤーを追加">
              <DashboardCustomizeIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="効果レイヤーを追加">
            <IconButton
              size="small"
              aria-label="効果レイヤーを追加"
              onClick={event => setAddEffectAnchor(event.currentTarget)}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={addEffectAnchor} open={!!addEffectAnchor} onClose={() => setAddEffectAnchor(null)}>
            <MenuItem disabled={selectedIds.length < 2} onClick={() => { engine.createStack(); setAddEffectAnchor(null); }}>選択をスタック化</MenuItem>
            <MenuItem onClick={() => { engine.addAdjustLayer(); setAddEffectAnchor(null); }}>色調補正を追加</MenuItem>
            <MenuItem onClick={() => { engine.addOutlineLayer(); setAddEffectAnchor(null); }}>縁どりを追加</MenuItem>
            <MenuItem onClick={() => { engine.addClipLayer(); setAddEffectAnchor(null); }}>クリップを追加</MenuItem>
            <MenuItem onClick={() => { engine.addTransformLayer(); setAddEffectAnchor(null); }}>トランスフォームを追加</MenuItem>
            <MenuItem onClick={() => { setBinOpen(true); setAddEffectAnchor(null); }}>ビンを表示</MenuItem>
          </Menu>
        </Stack>
      </Stack>
      <Box
        ref={list}
        onDragOverCapture={event => {
          if (event.dataTransfer.types.includes('application/x-rin-bin-item')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDropCapture={event => {
          const binId = event.dataTransfer.getData('application/x-rin-bin-item');
          if (!binId) return;
          event.preventDefault();
          event.stopPropagation();
          void engine.placeBinItem(binId).catch(error => appAlert(String(error)));
        }}
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
              while (depth > targetDepth && anchor.scopeId) {
                anchor = byId.get(anchor.scopeId)!;
                depth--;
              }
              if (engine.canMoveLayer(dragId, anchor.scopeId)) {
                const siblings = anchor.scopeId ? byId.get(anchor.scopeId)!.scopeLayerIds : rootLayerIds;
                setDrop({
                  scopeId: anchor.scopeId,
                  index: siblings.indexOf(anchor.id) + 1,
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
            const isPrimary = selectedIds[0] === meta.id;
            const isSelected = selectedIds.includes(meta.id);
            const memberStack = stackByLayer.get(meta.id);
            const collapsedStack = collapsedStackByLayer.get(meta.id);
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
                  + (isPrimary ? ' active' : '')
                  + (multi && isSelected && !isPrimary ? ' selected' : '')
                  + (dragId === meta.id ? ' is-dragging' : '')
                  + (guide?.edge === 'inside' ? ' drop-inside' : '')
                  + (memberStack && !collapsedStack ? ' stack-member-expanded' : '')
                  + (collapsedStack ? ' stack-collapsed' : '')
                }
                aria-current={isPrimary ? 'true' : undefined}
                style={{
                  top: spacing.top + row.index * ROW_HEIGHT,
                  left: row.depth * 16,
                  height: ROW_HEIGHT - 4,
                  pointerEvents: row.exiting ? 'none' : undefined,
                  opacity: row.exiting ? 0 : undefined,
                }}
                draggable={!row.exiting}
                onClick={event => {
                  if (event.shiftKey) event.preventDefault();
                  select(meta.id, event.shiftKey);
                }}
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
                  event.dataTransfer.effectAllowed = 'copyMove';
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
                  while (depth > requestedDepth && anchor.scopeId) {
                    anchor = byId.get(anchor.scopeId)!;
                    depth--;
                  }
                  const siblings = anchor.scopeId ? byId.get(anchor.scopeId)!.scopeLayerIds : rootLayerIds;
                  const inside = anchor.id === meta.id && ratio >= 0.28 && ratio <= 0.72;
                  if (inside && meta.type !== 'canvas') {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDrop({ scopeId: meta.scopeId, index: siblings.indexOf(meta.id), anchorId: meta.id, edge: 'inside', depth, stackWithId: meta.id });
                    return;
                  }
                  const target: DropTarget = inside
                    ? {
                        scopeId: meta.id,
                        index: meta.scopeLayerIds.length,
                        anchorId: meta.id,
                        edge: 'inside',
                        depth: row.depth + 1,
                      }
                    : {
                        scopeId: anchor.scopeId,
                        index: siblings.indexOf(anchor.id) + (ratio < 0.5 ? 0 : 1),
                        anchorId: meta.id,
                        edge: ratio < 0.5 ? 'before' : 'after',
                        depth,
                      };
                  if (!engine.canMoveLayer(dragId, target.scopeId)) {
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
                <Tooltip title={meta.parameterLink?.linkedParameterIds.includes('layer.visible')
                  ? '表示状態はリンク元を参照中'
                  : meta.parameterLink && meta.compatibleLinkParameterIds?.includes('layer.visible')
                    ? '表示状態のリンクは解除済み'
                    : '表示切替'}>
                <IconButton
                  draggable={false}
                  size="small"
                  aria-label={meta.parameterLink?.linkedParameterIds.includes('layer.visible') ? '表示切替・リンク中' : '表示切替'}
                  sx={meta.parameterLink?.linkedParameterIds.includes('layer.visible')
                    ? { color: 'secondary.main' }
                    : meta.parameterLink && meta.compatibleLinkParameterIds?.includes('layer.visible')
                      ? { color: 'text.disabled', outline: '1px dashed', outlineColor: 'divider' }
                      : undefined}
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
                </Tooltip>
                {collapsedStack
                  ? <Box sx={{ position: 'relative', width: 32, height: 30, flex: 'none' }}><Box sx={{ position: 'absolute', left: 4, top: 3, width: 22, height: 22, borderRadius: .5, bgcolor: 'action.selected', border: 1, borderColor: 'divider' }} /><Box sx={{ position: 'absolute', left: 8, top: 7, width: 22, height: 22, borderRadius: .5, bgcolor: 'background.paper', border: 1, borderColor: 'primary.main' }} /></Box>
                  : meta.type === 'adjust' || meta.type === 'outline' || meta.type === 'clip'
                  ? <Box className={`effect-badge ${meta.type}`}>{meta.type === 'adjust' ? '補正' : meta.type === 'outline' ? '縁' : 'クリップ'}</Box>
                  : <Thumb meta={meta} />}
                <Typography variant="body2" noWrap sx={{ flex: 1, opacity: meta.visible ? 1 : 0.5 }}>
                  {collapsedStack ? collapsedStack.layerIds.map(id => byId.get(id)?.name ?? '').join('・') : meta.name}
                </Typography>
                {(meta.dataLink || meta.parameterLink || !!meta.directLinkTargets?.length) && (
                  <Tooltip title={[
                    meta.dataLink && 'レイヤーデータ全体をビンから参照中',
                    meta.parameterLink && (meta.linkSource?.missing ? 'リンク元が見つかりません' : 'パラメータのリンク元を参照中'),
                    !!meta.directLinkTargets?.length && `${meta.directLinkTargets.length}レイヤーから参照`,
                  ].filter(Boolean).join('・')}>
                    <Badge
                      badgeContent={meta.directLinkTargets?.length || 0}
                      color="secondary"
                      max={99}
                      sx={{ '& .MuiBadge-badge': { fontSize: 9, minWidth: 14, height: 14 } }}
                    >
                      <LinkIcon sx={{ fontSize: 16, color: meta.linkSource?.missing ? 'warning.main' : 'secondary.main' }} />
                    </Badge>
                  </Tooltip>
                )}
                {multi && isPrimary && <Box className="primary-badge">主</Box>}
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
              setDrop({ scopeId: null, index: rootLayerIds.length, anchorId: 'end', edge: 'after', depth: 0 });
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
              requestedPaletteId.current = menu.id;
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
        {menuMeta?.type === 'transform' && (
          <MenuItem onClick={() => {
            const id = menuMeta.id;
            const before = structuredClone(menuMeta.state);
            setMenu(null);
            engine.commitLayerProps(id, { state: before }, { state: identityTransformState() }, 'トランスフォームをリセット');
          }}>
            トランスフォームをリセット
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            const id = menu?.id;
            setMenu(null);
            if (id) void engine.copyLayers(id).catch(error => appAlert(String(error)));
          }}
        >
          コピー
        </MenuItem>
        <MenuItem disabled={selectedIds.length < 2} onClick={() => { engine.createStack(); setMenu(null); }}>
          選択をスタック化
        </MenuItem>
        {menuStack && (
          <MenuItem onClick={() => { if (menu) engine.convertStackToCanvas(menu.id); setMenu(null); }}>
            キャンバスレイヤーへ変換
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            const id = menu?.id;
            setMenu(null);
            if (id) void engine.putLayerInBin(id).catch(error => appAlert(String(error)));
          }}
        >
          ビンに保管
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
        <LayerControlsPalette
          meta={active}
          onClose={() => setPalette({ id: active.id, open: false })}
        />
      )}
      {binOpen && <BinPanel onClose={() => setBinOpen(false)} />}
      <Dialog open={!!canvasDropChoice} onClose={() => setCanvasDropChoice(null)} maxWidth="xs" fullWidth>
        <DialogTitle>キャンバスレイヤーへドロップ</DialogTitle>
        <DialogContent>
          <Typography>外側でまとめるか、キャンバス内部の描画スコープへ移動するかを選択してください。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCanvasDropChoice(null)}>キャンセル</Button>
          <Button onClick={() => {
            if (canvasDropChoice) engine.createStack([canvasDropChoice.canvasId, canvasDropChoice.dragId]);
            setCanvasDropChoice(null);
          }}>外側でスタック化</Button>
          <Button variant="contained" onClick={() => {
            if (canvasDropChoice) engine.moveLayer(canvasDropChoice.dragId, { scopeId: canvasDropChoice.canvasId, index: canvasDropChoice.index });
            setCanvasDropChoice(null);
          }}>キャンバス内部へ移動</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export { maskCandidateRows } from './maskCandidates';
