import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BlurOnIcon from '@mui/icons-material/BlurOn';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import GestureIcon from '@mui/icons-material/Gesture';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Popper,
  Paper,
  Collapse,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { engine } from '../engine/PaintEngine';
import { useStore } from '../state/store';
import { normalizeTextToolSettings, TOOL_KIND_LABELS, type ToolInstance, type ToolKind } from '../types';
import { NameEditor } from './NameEditor';
import { createPortal } from 'react-dom';

const iconSx = { fontSize: 20 };

export const TOOL_ICONS: Record<ToolKind, ReactNode> = {
  text: <TextFieldsIcon sx={iconSx} />,
  pen: <EditOutlinedIcon sx={iconSx} />,
  line: <HorizontalRuleIcon sx={{ ...iconSx, transform: 'rotate(-45deg)' }} />,
  rect: <CropSquareIcon sx={iconSx} />,
  ellipse: <CircleOutlinedIcon sx={iconSx} />,
  lasso: <GestureIcon sx={iconSx} />,
  blur: <BlurOnIcon sx={iconSx} />,
};

const descriptions: Record<ToolKind, string> = {
  pen: '筆圧対応の描画', text: '部分書式と縦書き', line: '直線を作成', rect: '四角形を作成',
  ellipse: '楕円を作成', lasso: '選択して変形', blur: 'なぞってぼかす',
};
const shapeKinds: ToolKind[] = ['line', 'rect', 'ellipse'];
const rootKinds: ToolKind[] = ['pen', 'text', 'lasso', 'blur'];

function ToolCatalogCard({ kind, path, onClick }: { kind: ToolKind; path?: string; onClick: () => void }) {
  return (
    <ButtonBase className="tool-catalog-card" onClick={onClick}>
      <Box className="tool-catalog-icon">{TOOL_ICONS[kind]}</Box>
      <Box sx={{ minWidth: 0, textAlign: 'left' }}>
        {path && <Typography variant="caption" color="text.secondary" noWrap>{path}</Typography>}
        <Typography variant="body2" sx={{ fontWeight: 650 }}>{TOOL_KIND_LABELS[kind]}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap>{descriptions[kind]}</Typography>
      </Box>
    </ButtonBase>
  );
}

function AddToolDialog({ onClose }: { onClose: () => void }) {
  const [shapePage, setShapePage] = useState(false);
  const [query, setQuery] = useState('');
  const add = (kind: ToolKind) => { engine.addToolInstance(kind); onClose(); };
  const normalized = query.trim().toLocaleLowerCase();
  const matched = useMemo(() => [...rootKinds, ...shapeKinds].filter(kind =>
    `${TOOL_KIND_LABELS[kind]} ${descriptions[kind]} ${shapeKinds.includes(kind) ? '図形' : ''}`.toLocaleLowerCase().includes(normalized),
  ), [normalized]);
  const results = normalized ? matched : shapePage ? shapeKinds : rootKinds;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 2.5, overflow: 'hidden' } } }}>
      <DialogTitle sx={{ px: 2.5, py: 1.75, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {shapePage && !normalized && (
            <IconButton aria-label="ツールの種類に戻る" onClick={() => setShapePage(false)}><ArrowBackIcon /></IconButton>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" component="div" sx={{ fontSize: 17 }}>ツールを追加</Typography>
            <Typography variant="caption" color="text.secondary">
              {shapePage && !normalized ? '図形 › 種類を選択' : '追加する種類を選択'}
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="ツール追加を閉じる"><CloseIcon /></IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ p: '18px !important' }}>
        <TextField
          autoFocus
          fullWidth
          placeholder="ツールを検索"
          value={query}
          onChange={event => setQuery(event.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
          sx={{ mb: 1.5 }}
        />
        <Box className="tool-catalog-scroll">
          <Box className="tool-catalog-grid">
            {!normalized && !shapePage && (
              <ButtonBase className="tool-catalog-card" onClick={() => setShapePage(true)}>
                <Box className="tool-catalog-icon">{TOOL_ICONS.rect}</Box>
                <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>図形</Typography>
                  <Typography variant="caption" color="text.secondary">直線・四角形・楕円</Typography>
                </Box>
                <ChevronRightIcon color="action" />
              </ButtonBase>
            )}
            {results.map(kind => (
              <ToolCatalogCard key={kind} kind={kind} path={normalized && shapeKinds.includes(kind) ? '図形' : undefined} onClick={() => add(kind)} />
            ))}
          </Box>
          {results.length === 0 && (
            <Box className="tool-catalog-empty">
              <Typography color="text.secondary">一致するツールがありません</Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}

function toolSummary(tool: ToolInstance): string {
  if (tool.kind === 'text') {
    const settings = normalizeTextToolSettings(tool.textSettings);
    return `${settings.sizePt}pt・${settings.direction === 'vertical' ? '縦書き' : '横書き'}`;
  }
  if (tool.kind === 'lasso') return '選択・変形';
  if (tool.kind === 'blur') return `${tool.size}px`;
  return `${tool.size}px・${tool.color === 'transparent' ? '透明' : tool.color}`;
}

function ManageToolsDialog({ onClose }: { onClose: () => void }) {
  const tools = useStore(state => state.tools);
  const stacks = useStore(state => state.toolStacks);
  const layout = useStore(state => state.toolLayout);
  const activeId = useStore(state => state.activeToolId);
  const [addOpen, setAddOpen] = useState(false);
  const [openStackId, setOpenStackId] = useState<string | null>(null);
  const [floatingCard, setFloatingCard] = useState<{ x: number; y: number; width: number; height: number; name: string; icons: ReactNode[] } | null>(null);
  const lifted = useRef<{ dx: number; dy: number; width: number; height: number; name: string; icons: ReactNode[] } | null>(null);
  const stackSurfaces = useRef(new Map<string, HTMLElement>());
  const [editing, setEditing] = useState<{ type: 'tool' | 'stack'; id: string } | null>(null);
  const [menu, setMenu] = useState<{ type: 'tool' | 'stack'; id: string; anchor: HTMLElement } | null>(null);
  const pendingRename = useRef<{ type: 'tool' | 'stack'; id: string } | null>(null);
  const [drag, setDrag] = useState<{ toolId?: string; layoutIndex?: number; stackId?: string; stackIndex?: number; active: boolean } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ layoutIndex?: number; stackId?: string; stackIndex?: number; targetToolId?: string; side: 'before' | 'after' | 'pending' | 'center' } | null>(null);
  const cardElements = useRef(new Map<string, HTMLElement>());
  const beforeMove = useRef<Map<string, DOMRect> | null>(null);
  const press = useRef<{ pointerId: number; x: number; y: number; source: NonNullable<typeof drag> } | null>(null);
  const dwell = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const suppressClick = useRef(false);
  const targetKey = useRef('');
  const motions = useRef(new Map<string, Animation>());
  const layoutRects = useRef(new Map<string, DOMRect>());
  const dropSlots = useRef<{ node: HTMLElement; rect: DOMRect }[]>([]);
  useEffect(() => {
    if (!openStackId) return;
    const outside = (event: PointerEvent) => {
      if (press.current || menu || editing) return;
      if (!stackSurfaces.current.get(openStackId)?.contains(event.target as Node)) setOpenStackId(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [openStackId, menu, editing]);
  const previewLayout = useMemo(() => {
    const entries = layout.map((item, originalIndex) => ({ item, originalIndex }));
    if (!drag?.active || drag.layoutIndex === undefined || dropTarget?.layoutIndex === undefined || dropTarget.side === 'center' || dropTarget.side === 'pending' || drag.layoutIndex === dropTarget.layoutIndex) return entries;
    const sourceIndex = entries.findIndex(entry => entry.originalIndex === drag.layoutIndex);
    if (sourceIndex < 0) return entries;
    const [source] = entries.splice(sourceIndex, 1);
    let targetIndex = entries.findIndex(entry => entry.originalIndex === dropTarget.layoutIndex);
    if (targetIndex < 0) return entries;
    if (dropTarget.side === 'after') targetIndex++;
    entries.splice(targetIndex, 0, source);
    return entries;
  }, [layout, drag, dropTarget]);
  const previewSignature = previewLayout.map(entry => entry.item.type === 'tool' ? `t:${entry.item.toolId}` : `s:${entry.item.stackId}`).join('|');

  useLayoutEffect(() => {
    const previous = beforeMove.current ?? layoutRects.current;
    beforeMove.current = null;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nextRects = new Map<string, DOMRect>();
    for (const [id, element] of cardElements.current) {
      const oldRect = previous.get(id);
      motions.current.get(id)?.cancel();
      const nextRect = element.getBoundingClientRect();
      nextRects.set(id, nextRect);
      if (reduced) continue;
      if (!oldRect) {
        if (previous.size) motions.current.set(id, element.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }));
        continue;
      }
      const dx = oldRect.left - nextRect.left;
      const dy = oldRect.top - nextRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      motions.current.set(id, element.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
      ));
    }
    layoutRects.current = nextRects;
  }, [layout, stacks, tools, previewSignature]);

  const clearDwell = () => { if (dwell.current) clearTimeout(dwell.current.timer); dwell.current = null; };
  const finishDrag = () => { rememberRects(); clearDwell(); press.current = null; lifted.current = null; setFloatingCard(null); targetKey.current = ''; setDrag(null); setDropTarget(null); };
  const rememberRects = () => { beforeMove.current = new Map([...cardElements.current].map(([id, element]) => [id, element.getBoundingClientRect()])); };
  const beginPress = (event: React.PointerEvent, source: NonNullable<typeof drag>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,input')) return;
    dropSlots.current = [...cardElements.current.values()].filter(node => node.hasAttribute('data-layout-index')).map(node => ({ node, rect: node.getBoundingClientRect() }));
    press.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, source };
    const rect = event.currentTarget.getBoundingClientRect();
    const tool = tools.find(tool => tool.id === source.toolId);
    const entry = source.layoutIndex === undefined ? undefined : layout[source.layoutIndex];
    const stack = entry?.type === 'stack' ? stacks.find(stack => stack.id === entry.stackId) : undefined;
    lifted.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, width: rect.width, height: rect.height,
      name: tool?.name ?? stack?.name ?? '', icons: tool ? [TOOL_ICONS[tool.kind]] : (stack?.toolIds ?? []).slice(0, 4).flatMap(id => { const member = tools.find(t => t.id === id); return member ? [TOOL_ICONS[member.kind]] : []; }) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const updateDrag = (event: React.PointerEvent) => {
    const pending = press.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (!drag?.active && distance < 8) return;
    if (!drag?.active) setDrag({ ...pending.source, active: true });
    if (lifted.current) setFloatingCard({ ...lifted.current, x: event.clientX - lifted.current.dx, y: event.clientY - lifted.current.dy });
    const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const inner = hit?.closest<HTMLElement>('[data-stack-tool]');
    // Hit-test stable slots, not cards moving under the pointer during FLIP.
    const slot = dropSlots.current.find(({ rect }) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    const card = slot?.node;
    let next: NonNullable<typeof dropTarget> | null = null;
    if (inner) {
      const rect = inner.getBoundingClientRect();
      next = { stackId: inner.dataset.stackId!, stackIndex: Number(inner.dataset.stackIndex), targetToolId: inner.dataset.toolId, side: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after' };
    } else if (hit?.closest('.manage-stack-overlay')) {
      // Empty space inside the open group is not a root-level drop surface.
      next = null;
    } else if (card) {
      const rect = slot!.rect;
      const rx = (event.clientX - rect.left) / rect.width;
      const ry = (event.clientY - rect.top) / rect.height;
      const center = rx > .25 && rx < .75 && ry > .2 && ry < .8;
      const ownGroup = pending.source.stackId && card.dataset.stackId === pending.source.stackId;
      next = { layoutIndex: Number(card.dataset.layoutIndex), stackId: card.dataset.stackId, targetToolId: card.dataset.toolId, side: center && pending.source.toolId && !ownGroup ? 'pending' : rx < .5 ? 'before' : 'after' };
    } else if (pending.source.stackId && hit?.closest('.manage-tools-content')) {
      // The grid's gaps and unused area must accept tools dragged out of a group.
      next = { layoutIndex: layout.length, side: 'before' };
    }
    const key = next?.side === 'pending' ? `${next.stackId ?? next.targetToolId}` : '';
    if (key && dwell.current?.key !== key) {
      clearDwell();
      const timer = setTimeout(() => {
        rememberRects();
        setDropTarget(current => current?.side === 'pending' ? { ...current, side: 'center' } : current);
      }, 450);
      dwell.current = { key, timer };
    } else if (!key) clearDwell();
    const nextKey = next ? `${next.layoutIndex ?? ''}:${next.stackId ?? ''}:${next.stackIndex ?? ''}:${next.targetToolId ?? ''}:${next.side}` : '';
    if (nextKey !== targetKey.current) {
      rememberRects();
      targetKey.current = nextKey;
    }
    setDropTarget(current => key && dwell.current?.key === key && current?.side === 'center' ? { ...next!, side: 'center' } : next);
  };
  const applyDrop = () => {
    const source = press.current?.source ?? drag;
    const target = dropTarget;
    if (!source?.active && !drag?.active) return finishDrag();
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 0);
    if (!source || !target) return finishDrag();
    rememberRects();
    if (target.side === 'center' && source.toolId) {
      if (target.stackId) {
        if (source.stackId === target.stackId && source.stackIndex !== undefined) return finishDrag();
        engine.moveToolToStack(source.toolId, target.stackId);
        setOpenStackId(target.stackId);
      } else if (target.targetToolId && target.targetToolId !== source.toolId) {
        if (source.stackId) engine.unstackTool(source.toolId);
        engine.createToolStack(source.toolId, target.targetToolId);
      }
    } else if (target.stackId && target.stackIndex !== undefined && source.toolId) {
      const index = target.stackIndex + (target.side === 'after' ? 1 : 0);
      if (source.stackId === target.stackId && source.stackIndex !== undefined) engine.reorderStackTools(target.stackId, source.stackIndex, source.stackIndex < index ? index - 1 : index);
      else engine.moveToolToStack(source.toolId, target.stackId, index);
    } else if (target.layoutIndex !== undefined) {
      const slot = target.layoutIndex + (target.side === 'after' ? 1 : 0);
      if (source.stackId && source.toolId) engine.unstackTool(source.toolId, slot);
      else if (source.layoutIndex !== undefined) engine.reorderToolLayout(source.layoutIndex, source.layoutIndex < slot ? slot - 1 : slot);
    }
    finishDrag();
  };

  return (
    <>
      <Dialog open onClose={() => { if (drag?.active) finishDrag(); else if (openStackId) setOpenStackId(null); else onClose(); }} maxWidth="md" fullWidth slotProps={{ paper: { sx: { borderRadius: 2.5, height: 'min(720px, calc(100vh - 48px))' } } }}>
        <DialogTitle sx={{ px: 2.5, py: 1.75, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="h6" component="div" sx={{ fontSize: 17 }}>ツールを管理</Typography>
                <Chip size="small" label={`${tools.length}件`} />
              </Stack>
              <Typography variant="caption" color="text.secondary">重ねてグループ化、間へ移動して並べ替え</Typography>
            </Box>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>ツールを追加</Button>
            <IconButton onClick={onClose} aria-label="ツール管理を閉じる"><CloseIcon /></IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent className="manage-tools-content" onPointerMove={updateDrag} onPointerUp={applyDrop} onPointerCancel={finishDrag}>
          <Box className="manage-tool-card-grid">
            {previewLayout.map(({ item, originalIndex: index }) => {
              if (item.type === 'tool') {
                const tool = tools.find(value => value.id === item.toolId); if (!tool) return null;
                const isEditing = editing?.type === 'tool' && editing.id === tool.id;
                return <Box key={tool.id} data-layout-index={index} data-tool-id={tool.id} ref={(node: HTMLElement | null) => { if (node) cardElements.current.set(tool.id, node); else cardElements.current.delete(tool.id); }}
                  className={`manage-tool-card${activeId === tool.id ? ' active' : ''}${drag?.toolId === tool.id && drag.active ? ' is-dragging' : ''}${dropTarget?.layoutIndex === index ? ` drop-${dropTarget.side}` : ''}`}
                  onPointerDown={event => beginPress(event, { toolId: tool.id, layoutIndex: index, active: false })} onClick={() => { if (!suppressClick.current && !isEditing) engine.selectToolInstance(tool.id); }}>
                  <Box className="manage-tool-card-top"><Box className="manage-tool-icon">{TOOL_ICONS[tool.kind]}</Box><Box sx={{ flex: 1, minWidth: 0 }}>
                    {!isEditing && <Typography variant="body2" noWrap sx={{ fontWeight: 650 }}>{tool.name}</Typography>}
                    <NameEditor size="small" variant="standard" value={tool.name} editing={isEditing} onCommit={name => engine.renameToolInstance(tool.id, name)} onCancel={() => setEditing(null)} onEditingChange={() => setEditing(null)} />
                    <Typography variant="caption" color="text.secondary" noWrap>{toolSummary(tool)}</Typography>
                  </Box>{activeId === tool.id && <Chip label="使用中" color="primary" size="small" sx={{ height: 20, fontSize: 10 }} />}</Box>
                  <Box className="manage-tool-card-actions"><Typography variant="caption" color="text.secondary">{TOOL_KIND_LABELS[tool.kind]}</Typography><IconButton size="small" onClick={event => { event.stopPropagation(); setMenu({ type: 'tool', id: tool.id, anchor: event.currentTarget }); }}><MoreVertIcon fontSize="small" /></IconButton></Box>
                </Box>;
              }
              const stack = stacks.find(value => value.id === item.stackId); if (!stack) return null;
              const members = stack.toolIds.map(id => tools.find(tool => tool.id === id)).filter((tool): tool is ToolInstance => !!tool);
              const isEditing = editing?.type === 'stack' && editing.id === stack.id;
              return <Box key={stack.id} className="manage-stack-slot" ref={(node: HTMLElement | null) => { if (node) stackSurfaces.current.set(stack.id, node); else stackSurfaces.current.delete(stack.id); }}>
                <Box data-layout-index={index} data-stack-id={stack.id} ref={(node: HTMLElement | null) => { if (node) cardElements.current.set(stack.id, node); else cardElements.current.delete(stack.id); }}
                  className={`manage-tool-card manage-stack-tile${members.some(tool => tool.id === activeId) ? ' active' : ''}${drag?.layoutIndex === index && drag.active ? ' is-dragging' : ''}${dropTarget?.layoutIndex === index ? ` drop-${dropTarget.side}` : ''}`}
                  onPointerDown={event => beginPress(event, { layoutIndex: index, active: false })} onClick={() => { if (!suppressClick.current && !isEditing) setOpenStackId(value => value === stack.id ? null : stack.id); }}>
                  <Box className="manage-tool-card-top"><Box className="manage-stack-preview">{members.slice(0, 4).map(tool => <Box key={tool.id}>{TOOL_ICONS[tool.kind]}</Box>)}</Box><Box sx={{ flex: 1, minWidth: 0 }}>
                    {!isEditing && <Typography variant="body2" noWrap sx={{ fontWeight: 650 }}>{stack.name}</Typography>}
                    <NameEditor size="small" variant="standard" value={stack.name} editing={isEditing} onCommit={name => engine.renameToolStack(stack.id, name)} onCancel={() => setEditing(null)} onEditingChange={() => setEditing(null)} />
                    <Typography variant="caption" color="text.secondary">{members.length}個のツール</Typography>
                  </Box></Box>
                  <Box className="manage-tool-card-actions"><Typography variant="caption" color="text.secondary">グループ</Typography><IconButton size="small" onClick={event => { event.stopPropagation(); setMenu({ type: 'stack', id: stack.id, anchor: event.currentTarget }); }}><MoreVertIcon fontSize="small" /></IconButton></Box>
                </Box>
                <Collapse in={openStackId === stack.id} timeout={220} unmountOnExit className="manage-stack-overlay"><Box className="manage-stack-expanded"><Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}><Typography variant="subtitle2">{stack.name}</Typography><IconButton size="small" aria-label="グループを閉じる" onClick={() => setOpenStackId(null)}><CloseIcon fontSize="small" /></IconButton></Stack><Box className="manage-stack-tool-grid">{members.map((tool, memberIndex) => { const memberEditing = editing?.type === 'tool' && editing.id === tool.id; return <Box key={tool.id} data-stack-tool data-stack-id={stack.id} data-stack-index={memberIndex} data-tool-id={tool.id}
                  className={`manage-tool-card compact${activeId === tool.id ? ' active' : ''}${drag?.toolId === tool.id && drag.active ? ' is-dragging' : ''}`}
                  onPointerDown={event => beginPress(event, { toolId: tool.id, stackId: stack.id, stackIndex: memberIndex, active: false })} onClick={() => { if (!suppressClick.current && !memberEditing) engine.selectToolInstance(tool.id); }}>
                  <Box className="manage-tool-card-top"><Box className="manage-tool-icon">{TOOL_ICONS[tool.kind]}</Box><Box sx={{ minWidth: 0, flex: 1 }}>{!memberEditing && <Typography variant="body2" noWrap>{tool.name}</Typography>}<NameEditor size="small" variant="standard" value={tool.name} editing={memberEditing} onCommit={name => engine.renameToolInstance(tool.id, name)} onCancel={() => setEditing(null)} onEditingChange={() => setEditing(null)} /><Typography variant="caption" color="text.secondary" noWrap>{toolSummary(tool)}</Typography></Box><IconButton size="small" onClick={event => { event.stopPropagation(); setMenu({ type: 'tool', id: tool.id, anchor: event.currentTarget }); }}><MoreVertIcon fontSize="small" /></IconButton></Box>
                </Box>; })}</Box></Box></Collapse>
              </Box>;
            })}
          </Box>
          {drag?.stackId && dropTarget?.layoutIndex === layout.length && <Box className="tool-unstack-drop-guide">ここに配置</Box>}
        </DialogContent>
        <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)} disableRestoreFocus slotProps={{ transition: { onExited: () => {
          if (pendingRename.current) { setEditing(pendingRename.current); pendingRename.current = null; }
        } } }}>
          <MenuItem onClick={() => { if (menu) pendingRename.current = { type: menu.type, id: menu.id }; setMenu(null); }}>名称変更</MenuItem>
          {menu?.type === 'tool' && <MenuItem sx={{ color: 'error.main' }} onClick={() => { engine.removeToolInstance(menu.id); setMenu(null); }}>削除</MenuItem>}
          {menu?.type === 'stack' && <MenuItem onClick={() => { engine.dissolveToolStack(menu.id); setMenu(null); }}>グループを解除</MenuItem>}
        </Menu>
      </Dialog>
      {floatingCard && createPortal(<div aria-hidden="true" className="manage-tool-floating" style={{ left: floatingCard.x, top: floatingCard.y, width: floatingCard.width, height: floatingCard.height }}>
        <div className="manage-tool-card-top"><div className="manage-tool-icon">{floatingCard.icons.map((icon, index) => <span key={index}>{icon}</span>)}</div><Typography variant="body2" noWrap>{floatingCard.name}</Typography></div>
      </div>, document.body)}
      {addOpen && <AddToolDialog onClose={() => setAddOpen(false)} />}
    </>
  );
}

export function ToolPicker() {
  const tools = useStore(state => state.tools);
  const layout = useStore(state => state.toolLayout);
  const stacks = useStore(state => state.toolStacks);
  const activeId = useStore(state => state.activeToolId);
  const multi = useStore(state => state.multiSelectMode);
  const [manageOpen, setManageOpen] = useState(false);
  const [stackOpen, setStackOpen] = useState<{ id: string; anchor: HTMLElement; reason: 'hover' | 'click' } | null>(null);
  const hoverClose = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const cancelHoverClose = () => { if (hoverClose.current) clearTimeout(hoverClose.current); hoverClose.current = null; };
  const scheduleHoverClose = () => {
    if (stackOpen?.reason !== 'hover') return;
    cancelHoverClose();
    hoverClose.current = setTimeout(() => setStackOpen(current => current?.reason === 'hover' ? null : current), 120);
  };
  useEffect(() => () => cancelHoverClose(), []);
  useEffect(() => {
    if (!stackOpen) return;
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!stackOpen.anchor.contains(node) && !popup.current?.contains(node)) setStackOpen(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setStackOpen(null); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [stackOpen]);

  return (
    <Box className="tool-rail">
      <Box className="tool-rail-heading">
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, letterSpacing: 0.5 }}>ツール</Typography>
        <Tooltip title="ツールを管理">
          <IconButton onClick={() => setManageOpen(true)} aria-label="ツールを管理"><SettingsIcon sx={{ fontSize: 18 }} /></IconButton>
        </Tooltip>
      </Box>
      <Box className="tool-rail-scroll">
        {layout.map(item => {
          if (item.type === 'stack') {
            const stack = stacks.find(value => value.id === item.stackId);
            if (!stack) return null;
            const members = stack.toolIds.map(id => tools.find(tool => tool.id === id)).filter((tool): tool is ToolInstance => !!tool);
            const active = members.some(tool => tool.id === activeId);
            return <Button key={stack.id} onClick={event => { cancelHoverClose(); setStackOpen(current => current?.id === stack.id && current.reason === 'click' ? null : { id: stack.id, anchor: event.currentTarget, reason: 'click' }); }} onMouseEnter={event => { cancelHoverClose(); setStackOpen(current => current?.reason === 'click' ? current : { id: stack.id, anchor: event.currentTarget, reason: 'hover' }); }} onMouseLeave={scheduleHoverClose} title={stack.name} variant={active ? 'contained' : 'text'} color={active ? 'primary' : 'inherit'} className="tool-rail-button tool-stack-button">
              <Box className="tool-stack-icons">{members.slice(0, 4).map((tool, index) => <Box key={tool.id} sx={{ transform: `translate(${index * 3}px, ${index * -2}px)` }}>{TOOL_ICONS[tool.kind]}</Box>)}</Box>
              <Typography variant="caption" noWrap>{stack.name}</Typography>
            </Button>;
          }
          const tool = tools.find(value => value.id === item.toolId);
          if (!tool) return null;
          const active = activeId === tool.id;
          return (
            <Button
              key={tool.id}
              disabled={multi && tool.kind !== 'lasso'}
              onClick={() => engine.selectToolInstance(tool.id)}
              title={tool.name}
              variant={active ? 'contained' : 'text'}
              color={active ? 'primary' : 'inherit'}
              className="tool-rail-button"
            >
              {tool.kind !== 'lasso' && tool.kind !== 'blur' && (
                <Box className="tool-color-dot" sx={{ background: tool.color === 'transparent' ? 'repeating-conic-gradient(#aaa 0% 25%, #fff 0% 50%) 0 0 / 5px 5px' : tool.color }} />
              )}
              {TOOL_ICONS[tool.kind]}
              <Typography variant="caption" noWrap>{tool.name}</Typography>
            </Button>
          );
        })}
      </Box>
      <Popper open={!!stackOpen} anchorEl={stackOpen?.anchor} placement="right-start" sx={{ zIndex: 1300 }} modifiers={[{ name: 'offset', options: { offset: [0, 6] } }]}>
        <Paper ref={popup} className="tool-stack-popover" elevation={8} onMouseEnter={cancelHoverClose} onMouseLeave={scheduleHoverClose}>
        <Box className="tool-stack-popover-grid">
          {stacks.find(stack => stack.id === stackOpen?.id)?.toolIds.map(id => { const tool = tools.find(value => value.id === id); if (!tool) return null; const active = activeId === id; return <Button key={id} disabled={multi && tool.kind !== 'lasso'} variant={active ? 'contained' : 'text'} color={active ? 'primary' : 'inherit'} className="tool-rail-button tool-stack-popover-tool" onClick={() => { engine.selectToolInstance(id); setStackOpen(null); }}>
            {tool.kind !== 'lasso' && tool.kind !== 'blur' && <Box className="tool-color-dot" sx={{ background: tool.color === 'transparent' ? 'repeating-conic-gradient(#aaa 0% 25%, #fff 0% 50%) 0 0 / 5px 5px' : tool.color }} />}
            {TOOL_ICONS[tool.kind]}<Typography variant="caption" noWrap>{tool.name}</Typography>
          </Button>; })}
        </Box>
        </Paper>
      </Popper>
      {manageOpen && <ManageToolsDialog onClose={() => setManageOpen(false)} />}
    </Box>
  );
}
