import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getToolDescriptor } from '../../tools/registry';
import { useStore } from '../../state/store';
import type { ToolInstance } from '../../types';
import { useEngine } from '../EngineContext';
import { useFlipAnimation } from '../hooks/useFlipAnimation';
import { useOutsideClick } from '../hooks/useOutsideClick';
import { NameEditor } from '../NameEditor';
import { AddToolDialog } from './AddToolDialog';

function toolSummary(tool: ToolInstance): string {
  return getToolDescriptor(tool.kind)?.summary?.(tool)
    ?? `${tool.sizeMm.toFixed(2)}mm・${tool.color === 'transparent' ? '透明' : tool.color}`;
}

export function ManageToolsDialog({ onClose }: { onClose: () => void }) {
  const engine = useEngine();
  const tools = useStore(state => state.tools);
  const stacks = useStore(state => state.toolStacks);
  const layout = useStore(state => state.toolLayout);
  const activeId = useStore(state => state.activeToolId);
  const [addOpen, setAddOpen] = useState(false);
  const [openStackId, setOpenStackId] = useState<string | null>(null);
  const [floatingCard, setFloatingCard] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    name: string;
    icons: ReactNode[];
  } | null>(null);
  const lifted = useRef<{
    dx: number;
    dy: number;
    width: number;
    height: number;
    name: string;
    icons: ReactNode[];
  } | null>(null);
  const stackSurfaces = useRef(new Map<string, HTMLElement>());
  const openStackRef = useRef<HTMLElement | null>(null);
  openStackRef.current = openStackId ? stackSurfaces.current.get(openStackId) ?? null : null;
  const [editing, setEditing] = useState<{ type: 'tool' | 'stack'; id: string } | null>(null);
  const [menu, setMenu] = useState<{ type: 'tool' | 'stack'; id: string; anchor: HTMLElement } | null>(null);
  const pendingRename = useRef<{ type: 'tool' | 'stack'; id: string } | null>(null);
  const [drag, setDrag] = useState<{
    toolId?: string;
    layoutIndex?: number;
    stackId?: string;
    stackIndex?: number;
    active: boolean;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    layoutIndex?: number;
    stackId?: string;
    stackIndex?: number;
    targetToolId?: string;
    side: 'before' | 'after' | 'pending' | 'center';
  } | null>(null);
  const press = useRef<{
    pointerId: number;
    x: number;
    y: number;
    source: NonNullable<typeof drag>;
  } | null>(null);
  const dwell = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const suppressClick = useRef(false);
  const targetKey = useRef('');
  const dropSlots = useRef<{ node: HTMLElement; rect: DOMRect }[]>([]);
  const previewLayout = useMemo(() => {
    const entries = layout.map((item, originalIndex) => ({ item, originalIndex }));
    if (
      !drag?.active
      || drag.layoutIndex === undefined
      || dropTarget?.layoutIndex === undefined
      || dropTarget.side === 'center'
      || dropTarget.side === 'pending'
      || drag.layoutIndex === dropTarget.layoutIndex
    ) {
      return entries;
    }
    const sourceIndex = entries.findIndex(entry => entry.originalIndex === drag.layoutIndex);
    if (sourceIndex < 0) return entries;
    const [source] = entries.splice(sourceIndex, 1);
    let targetIndex = entries.findIndex(entry => entry.originalIndex === dropTarget.layoutIndex);
    if (targetIndex < 0) return entries;
    if (dropTarget.side === 'after') targetIndex++;
    entries.splice(targetIndex, 0, source);
    return entries;
  }, [layout, drag, dropTarget]);
  const previewSignature = previewLayout
    .map(entry => (entry.item.type === 'tool' ? `t:${entry.item.toolId}` : `s:${entry.item.stackId}`))
    .join('|');
  const flip = useFlipAnimation([layout, stacks, tools, previewSignature]);

  useOutsideClick(
    openStackRef,
    () => {
      if (press.current || menu || editing) return;
      setOpenStackId(null);
    },
    !!openStackId,
  );

  const clearDwell = () => {
    if (dwell.current) clearTimeout(dwell.current.timer);
    dwell.current = null;
  };
  const finishDrag = () => {
    flip.remember();
    clearDwell();
    press.current = null;
    lifted.current = null;
    setFloatingCard(null);
    targetKey.current = '';
    setDrag(null);
    setDropTarget(null);
  };
  const beginPress = (event: React.PointerEvent, source: NonNullable<typeof drag>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,input')) return;
    dropSlots.current = [...flip.elements.current.values()]
      .filter(node => node.hasAttribute('data-layout-index'))
      .map(node => ({ node, rect: node.getBoundingClientRect() }));
    press.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, source };
    const rect = event.currentTarget.getBoundingClientRect();
    const tool = tools.find(t => t.id === source.toolId);
    const entry = source.layoutIndex === undefined ? undefined : layout[source.layoutIndex];
    const stack = entry?.type === 'stack' ? stacks.find(s => s.id === entry.stackId) : undefined;
    lifted.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      name: tool?.name ?? stack?.name ?? '',
      icons: tool
        ? [getToolDescriptor(tool.kind)?.icon].filter(Boolean)
        : (stack?.toolIds ?? []).slice(0, 4).flatMap(id => {
            const member = tools.find(t => t.id === id);
            const icon = member ? getToolDescriptor(member.kind)?.icon : undefined;
            return icon ? [icon] : [];
          }),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const updateDrag = (event: React.PointerEvent) => {
    const pending = press.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (!drag?.active && distance < 8) return;
    if (!drag?.active) setDrag({ ...pending.source, active: true });
    if (lifted.current) {
      setFloatingCard({
        ...lifted.current,
        x: event.clientX - lifted.current.dx,
        y: event.clientY - lifted.current.dy,
      });
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const inner = hit?.closest<HTMLElement>('[data-stack-tool]');
    const slot = dropSlots.current.find(({ rect }) =>
      event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom);
    const card = slot?.node;
    let next: NonNullable<typeof dropTarget> | null = null;
    if (inner) {
      const rect = inner.getBoundingClientRect();
      next = {
        stackId: inner.dataset.stackId!,
        stackIndex: Number(inner.dataset.stackIndex),
        targetToolId: inner.dataset.toolId,
        side: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after',
      };
    } else if (hit?.closest('.manage-stack-overlay')) {
      next = null;
    } else if (card) {
      const rect = slot!.rect;
      const rx = (event.clientX - rect.left) / rect.width;
      const ry = (event.clientY - rect.top) / rect.height;
      const center = rx > 0.25 && rx < 0.75 && ry > 0.2 && ry < 0.8;
      const ownGroup = pending.source.stackId && card.dataset.stackId === pending.source.stackId;
      next = {
        layoutIndex: Number(card.dataset.layoutIndex),
        stackId: card.dataset.stackId,
        targetToolId: card.dataset.toolId,
        side: center && pending.source.toolId && !ownGroup ? 'pending' : rx < 0.5 ? 'before' : 'after',
      };
    } else if (pending.source.stackId && hit?.closest('.manage-tools-content')) {
      next = { layoutIndex: layout.length, side: 'before' };
    }
    const key = next?.side === 'pending' ? `${next.stackId ?? next.targetToolId}` : '';
    if (key && dwell.current?.key !== key) {
      clearDwell();
      const timer = setTimeout(() => {
        flip.remember();
        setDropTarget(current => (current?.side === 'pending' ? { ...current, side: 'center' } : current));
      }, 450);
      dwell.current = { key, timer };
    } else if (!key) {
      clearDwell();
    }
    const nextKey = next
      ? `${next.layoutIndex ?? ''}:${next.stackId ?? ''}:${next.stackIndex ?? ''}:${next.targetToolId ?? ''}:${next.side}`
      : '';
    if (nextKey !== targetKey.current) {
      flip.remember();
      targetKey.current = nextKey;
    }
    setDropTarget(current =>
      (key && dwell.current?.key === key && current?.side === 'center' ? { ...next!, side: 'center' } : next));
  };
  const applyDrop = () => {
    const source = press.current?.source ?? drag;
    const target = dropTarget;
    if (!source?.active && !drag?.active) return finishDrag();
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (!source || !target) return finishDrag();
    flip.remember();
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
      if (source.stackId === target.stackId && source.stackIndex !== undefined) {
        engine.reorderStackTools(
          target.stackId,
          source.stackIndex,
          source.stackIndex < index ? index - 1 : index,
        );
      } else {
        engine.moveToolToStack(source.toolId, target.stackId, index);
      }
    } else if (target.layoutIndex !== undefined) {
      const slot = target.layoutIndex + (target.side === 'after' ? 1 : 0);
      if (source.stackId && source.toolId) engine.unstackTool(source.toolId, slot);
      else if (source.layoutIndex !== undefined) {
        engine.reorderToolLayout(source.layoutIndex, source.layoutIndex < slot ? slot - 1 : slot);
      }
    }
    finishDrag();
  };

  return (
    <>
      <Dialog
        open
        onClose={() => {
          if (drag?.active) finishDrag();
          else if (openStackId) setOpenStackId(null);
          else onClose();
        }}
        maxWidth="md"
        fullWidth
        slotProps={{
          paper: { sx: { borderRadius: 2.5, height: 'min(720px, calc(100vh - 48px))' } },
        }}
      >
        <DialogTitle sx={{ px: 2.5, py: 1.75, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="h6" component="div" sx={{ fontSize: 17 }}>ツールを管理</Typography>
                <Chip size="small" label={`${tools.length}件`} />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                重ねてグループ化、間へ移動して並べ替え
              </Typography>
            </Box>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
              ツールを追加
            </Button>
            <IconButton onClick={onClose} aria-label="ツール管理を閉じる"><CloseIcon /></IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent
          className="manage-tools-content"
          onPointerMove={updateDrag}
          onPointerUp={applyDrop}
          onPointerCancel={finishDrag}
        >
          <Box className="manage-tool-card-grid">
            {previewLayout.map(({ item, originalIndex: index }) => {
              if (item.type === 'tool') {
                const tool = tools.find(value => value.id === item.toolId);
                if (!tool) return null;
                const isEditing = editing?.type === 'tool' && editing.id === tool.id;
                const descriptor = getToolDescriptor(tool.kind);
                return (
                  <Box
                    key={tool.id}
                    data-layout-index={index}
                    data-tool-id={tool.id}
                    ref={(node: HTMLElement | null) => flip.setElement(tool.id, node)}
                    className={
                      `manage-tool-card${activeId === tool.id ? ' active' : ''}`
                      + `${drag?.toolId === tool.id && drag.active ? ' is-dragging' : ''}`
                      + `${dropTarget?.layoutIndex === index ? ` drop-${dropTarget.side}` : ''}`
                    }
                    onPointerDown={event => beginPress(event, { toolId: tool.id, layoutIndex: index, active: false })}
                    onClick={() => {
                      if (!suppressClick.current && !isEditing) engine.selectToolInstance(tool.id);
                    }}
                  >
                    <Box className="manage-tool-card-top">
                      <Box className="manage-tool-icon">{descriptor?.icon}</Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        {!isEditing && (
                          <Typography variant="body2" noWrap sx={{ fontWeight: 650 }}>{tool.name}</Typography>
                        )}
                        <NameEditor
                          size="small"
                          variant="standard"
                          value={tool.name}
                          editing={isEditing}
                          onCommit={name => engine.renameToolInstance(tool.id, name)}
                          onCancel={() => setEditing(null)}
                          onEditingChange={() => setEditing(null)}
                        />
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {toolSummary(tool)}
                        </Typography>
                      </Box>
                      {activeId === tool.id && (
                        <Chip label="使用中" color="primary" size="small" sx={{ height: 20, fontSize: 10 }} />
                      )}
                    </Box>
                    <Box className="manage-tool-card-actions">
                      <Typography variant="caption" color="text.secondary">
                        {descriptor?.label ?? tool.kind}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={event => {
                          event.stopPropagation();
                          setMenu({ type: 'tool', id: tool.id, anchor: event.currentTarget });
                        }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>
                );
              }
              const stack = stacks.find(value => value.id === item.stackId);
              if (!stack) return null;
              const members = stack.toolIds
                .map(id => tools.find(tool => tool.id === id))
                .filter((tool): tool is ToolInstance => !!tool);
              const isEditing = editing?.type === 'stack' && editing.id === stack.id;
              return (
                <Box
                  key={stack.id}
                  className="manage-stack-slot"
                  ref={(node: HTMLElement | null) => {
                    if (node) stackSurfaces.current.set(stack.id, node);
                    else stackSurfaces.current.delete(stack.id);
                  }}
                >
                  <Box
                    data-layout-index={index}
                    data-stack-id={stack.id}
                    ref={(node: HTMLElement | null) => flip.setElement(stack.id, node)}
                    className={
                      `manage-tool-card manage-stack-tile${members.some(tool => tool.id === activeId) ? ' active' : ''}`
                      + `${drag?.layoutIndex === index && drag.active ? ' is-dragging' : ''}`
                      + `${dropTarget?.layoutIndex === index ? ` drop-${dropTarget.side}` : ''}`
                    }
                    onPointerDown={event => beginPress(event, { layoutIndex: index, active: false })}
                    onClick={() => {
                      if (!suppressClick.current && !isEditing) {
                        setOpenStackId(value => (value === stack.id ? null : stack.id));
                      }
                    }}
                  >
                    <Box className="manage-tool-card-top">
                      <Box className="manage-stack-preview">
                        {members.slice(0, 4).map(tool => (
                          <Box key={tool.id}>{getToolDescriptor(tool.kind)?.icon}</Box>
                        ))}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        {!isEditing && (
                          <Typography variant="body2" noWrap sx={{ fontWeight: 650 }}>{stack.name}</Typography>
                        )}
                        <NameEditor
                          size="small"
                          variant="standard"
                          value={stack.name}
                          editing={isEditing}
                          onCommit={name => engine.renameToolStack(stack.id, name)}
                          onCancel={() => setEditing(null)}
                          onEditingChange={() => setEditing(null)}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {members.length}個のツール
                        </Typography>
                      </Box>
                    </Box>
                    <Box className="manage-tool-card-actions">
                      <Typography variant="caption" color="text.secondary">グループ</Typography>
                      <IconButton
                        size="small"
                        onClick={event => {
                          event.stopPropagation();
                          setMenu({ type: 'stack', id: stack.id, anchor: event.currentTarget });
                        }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>
                  <Collapse
                    in={openStackId === stack.id}
                    timeout={220}
                    unmountOnExit
                    className="manage-stack-overlay"
                  >
                    <Box className="manage-stack-expanded">
                      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="subtitle2">{stack.name}</Typography>
                        <IconButton size="small" aria-label="グループを閉じる" onClick={() => setOpenStackId(null)}>
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                      <Box className="manage-stack-tool-grid">
                        {members.map((tool, memberIndex) => {
                          const memberEditing = editing?.type === 'tool' && editing.id === tool.id;
                          return (
                            <Box
                              key={tool.id}
                              data-stack-tool
                              data-stack-id={stack.id}
                              data-stack-index={memberIndex}
                              data-tool-id={tool.id}
                              className={
                                `manage-tool-card compact${activeId === tool.id ? ' active' : ''}`
                                + `${drag?.toolId === tool.id && drag.active ? ' is-dragging' : ''}`
                              }
                              onPointerDown={event =>
                                beginPress(event, {
                                  toolId: tool.id,
                                  stackId: stack.id,
                                  stackIndex: memberIndex,
                                  active: false,
                                })}
                              onClick={() => {
                                if (!suppressClick.current && !memberEditing) {
                                  engine.selectToolInstance(tool.id);
                                }
                              }}
                            >
                              <Box className="manage-tool-card-top">
                                <Box className="manage-tool-icon">{getToolDescriptor(tool.kind)?.icon}</Box>
                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                  {!memberEditing && (
                                    <Typography variant="body2" noWrap>{tool.name}</Typography>
                                  )}
                                  <NameEditor
                                    size="small"
                                    variant="standard"
                                    value={tool.name}
                                    editing={memberEditing}
                                    onCommit={name => engine.renameToolInstance(tool.id, name)}
                                    onCancel={() => setEditing(null)}
                                    onEditingChange={() => setEditing(null)}
                                  />
                                  <Typography variant="caption" color="text.secondary" noWrap>
                                    {toolSummary(tool)}
                                  </Typography>
                                </Box>
                                <IconButton
                                  size="small"
                                  onClick={event => {
                                    event.stopPropagation();
                                    setMenu({ type: 'tool', id: tool.id, anchor: event.currentTarget });
                                  }}
                                >
                                  <MoreVertIcon fontSize="small" />
                                </IconButton>
                              </Box>
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>
                  </Collapse>
                </Box>
              );
            })}
          </Box>
          {drag?.stackId && dropTarget?.layoutIndex === layout.length && (
            <Box className="tool-unstack-drop-guide">ここに配置</Box>
          )}
        </DialogContent>
        <Menu
          anchorEl={menu?.anchor}
          open={!!menu}
          onClose={() => setMenu(null)}
          disableRestoreFocus
          slotProps={{
            transition: {
              onExited: () => {
                if (pendingRename.current) {
                  setEditing(pendingRename.current);
                  pendingRename.current = null;
                }
              },
            },
          }}
        >
          <MenuItem
            onClick={() => {
              if (menu) pendingRename.current = { type: menu.type, id: menu.id };
              setMenu(null);
            }}
          >
            名称変更
          </MenuItem>
          {menu?.type === 'tool' && (
            <MenuItem
              sx={{ color: 'error.main' }}
              onClick={() => {
                engine.removeToolInstance(menu.id);
                setMenu(null);
              }}
            >
              削除
            </MenuItem>
          )}
          {menu?.type === 'stack' && (
            <MenuItem
              onClick={() => {
                engine.dissolveToolStack(menu.id);
                setMenu(null);
              }}
            >
              グループを解除
            </MenuItem>
          )}
        </Menu>
      </Dialog>
      {floatingCard && createPortal(
        <div
          aria-hidden="true"
          className="manage-tool-floating"
          style={{
            left: floatingCard.x,
            top: floatingCard.y,
            width: floatingCard.width,
            height: floatingCard.height,
          }}
        >
          <div className="manage-tool-card-top">
            <div className="manage-tool-icon">
              {floatingCard.icons.map((icon, index) => <span key={index}>{icon}</span>)}
            </div>
            <Typography variant="body2" noWrap>{floatingCard.name}</Typography>
          </div>
        </div>,
        document.body,
      )}
      {addOpen && <AddToolDialog onClose={() => setAddOpen(false)} />}
    </>
  );
}
