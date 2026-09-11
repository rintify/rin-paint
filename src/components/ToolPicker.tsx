import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BlurOnIcon from '@mui/icons-material/BlurOn';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import GestureIcon from '@mui/icons-material/Gesture';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import TextFieldsIcon from '@mui/icons-material/TextFields';
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
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { engine } from '../engine/PaintEngine';
import { useStore } from '../state/store';
import { normalizeTextToolSettings, TOOL_KIND_LABELS, type ToolInstance, type ToolKind } from '../types';

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

function ToolNameEditor({ tool }: { tool: ToolInstance }) {
  const [draft, setDraft] = useState(tool.name);
  useEffect(() => setDraft(tool.name), [tool.name]);
  const commit = () => { if (!engine.renameToolInstance(tool.id, draft)) setDraft(tool.name); };
  return <TextField variant="standard" value={draft} slotProps={{ htmlInput: { 'aria-label': `${tool.name}の名称` } }} onClick={event => event.stopPropagation()} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); (event.target as HTMLInputElement).blur(); } else if (event.key === 'Escape') { setDraft(tool.name); (event.target as HTMLInputElement).blur(); } }} sx={{ minWidth: 0 }} />;
}

function ManageToolsDialog({ onClose }: { onClose: () => void }) {
  const tools = useStore(state => state.tools);
  const stacks = useStore(state => state.toolStacks);
  const activeId = useStore(state => state.activeToolId);
  const [addOpen, setAddOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ anchorId: string; slot: number; side: 'before' | 'after' | 'center' } | null>(null);
  const cardElements = useRef(new Map<string, HTMLElement>());
  const beforeMove = useRef<Map<string, DOMRect> | null>(null);

  useLayoutEffect(() => {
    const previous = beforeMove.current;
    if (!previous) return;
    beforeMove.current = null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const [id, element] of cardElements.current) {
      const oldRect = previous.get(id);
      if (!oldRect) continue;
      const nextRect = element.getBoundingClientRect();
      const dx = oldRect.left - nextRect.left;
      const dy = oldRect.top - nextRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      element.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  }, [tools]);

  const finishDrag = () => { setDragId(null); setDropTarget(null); };
  const dropAt = (slot: number) => {
    if (!dragId) return finishDrag();
    const owner = useStore.getState().toolStacks.find(stack => stack.toolIds.includes(dragId));
    if (owner) useStore.getState().unstackTool(dragId, slot);
    const from = tools.findIndex(tool => tool.id === dragId);
    if (from < 0) return finishDrag();
    const to = from < slot ? slot - 1 : slot;
    if (from !== to) {
      beforeMove.current = new Map([...cardElements.current].map(([id, element]) => [id, element.getBoundingClientRect()]));
      engine.reorderToolInstance(from, to);
    }
    finishDrag();
  };

  return (
    <>
      <Dialog open onClose={onClose} maxWidth="md" fullWidth slotProps={{ paper: { sx: { borderRadius: 2.5, height: 'min(720px, calc(100vh - 48px))' } } }}>
        <DialogTitle sx={{ px: 2.5, py: 1.75, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="h6" component="div" sx={{ fontSize: 17 }}>ツールを管理</Typography>
                <Chip size="small" label={`${tools.length}件`} />
              </Stack>
              <Typography variant="caption" color="text.secondary">ドラッグで並べ替え。カードを押すと使用するツールを切り替えます。</Typography>
            </Box>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>ツールを追加</Button>
            <IconButton onClick={onClose} aria-label="ツール管理を閉じる"><CloseIcon /></IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent className="manage-tools-content">
          {stacks.length > 0 && <Box sx={{ mb: 2 }}>
            <Typography variant="overline" color="text.secondary">スタック</Typography>
            <Stack spacing={1}>{stacks.map(stack => <Box key={stack.id} className="manage-stack-card">
              <TextField size="small" value={stack.name} label="グループ名" onChange={event => { if (event.target.value.trim()) useStore.getState().renameToolStack(stack.id, event.target.value); }} />
              <Stack direction="row" spacing={.5} sx={{ flexWrap: 'wrap' }}>{stack.toolIds.map(id => { const tool = tools.find(item => item.id === id); return tool ? <Chip key={id} icon={<>{TOOL_ICONS[tool.kind]}</>} label={tool.name} onDelete={() => useStore.getState().unstackTool(id)} /> : null; })}</Stack>
            </Box>)}</Stack>
          </Box>}
          <Box className="manage-tool-card-grid">
            {tools.map((tool, index) => {
              const target = dropTarget?.anchorId === tool.id ? dropTarget : null;
              const active = tool.id === activeId;
              return (
                <Box
                  key={tool.id}
                  ref={(element: HTMLElement | null) => { if (element) cardElements.current.set(tool.id, element); else cardElements.current.delete(tool.id); }}
                  className={`manage-tool-card${target ? ` drop-${target.side}` : ''}${active ? ' active' : ''}`}
                  draggable
                  onClick={() => engine.selectToolInstance(tool.id)}
                  onDragStart={event => {
                    if ((event.target as HTMLElement).closest('button')) { event.preventDefault(); return; }
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', tool.id);
                    setDragId(tool.id);
                  }}
                  onDragEnd={finishDrag}
                  onDragOver={event => {
                    if (!dragId || dragId === tool.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    const rect = event.currentTarget.getBoundingClientRect();
                    const rx = (event.clientX - rect.left) / rect.width;
                    const ry = (event.clientY - rect.top) / rect.height;
                    const center = rx > .25 && rx < .75 && ry > .2 && ry < .8;
                    const before = rx + ry < 1;
                    setDropTarget({ anchorId: tool.id, slot: index + (before ? 0 : 1), side: center ? 'center' : before ? 'before' : 'after' });
                  }}
                  onDrop={event => { event.preventDefault(); event.stopPropagation(); if (dropTarget?.side === 'center' && dragId) {
                    beforeMove.current = new Map([...cardElements.current].map(([id, element]) => [id, element.getBoundingClientRect()]));
                    let state = useStore.getState();
                    const sourceOwner = state.toolStacks.find(stack => stack.toolIds.includes(dragId));
                    if (sourceOwner) { state.unstackTool(dragId); state = useStore.getState(); }
                    const targetOwner = state.toolStacks.find(stack => stack.toolIds.includes(tool.id));
                    if (targetOwner) state.moveToolToStack(dragId, targetOwner.id); else state.createToolStack(dragId, tool.id);
                    finishDrag();
                  } else if (dropTarget) dropAt(dropTarget.slot); }}
                  sx={{ opacity: dragId === tool.id ? 0.4 : 1 }}
                >
                  <Box className="manage-tool-card-top">
                    <Box className="manage-tool-icon">{TOOL_ICONS[tool.kind]}</Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                        <ToolNameEditor tool={tool} />
                        {active && <Chip label="使用中" color="primary" size="small" sx={{ height: 20, fontSize: 10 }} />}
                      </Stack>
                      <Typography variant="caption" color="text.secondary" noWrap>{toolSummary(tool)}</Typography>
                    </Box>
                    <DragIndicatorIcon className="manage-tool-drag-icon" sx={{ fontSize: 19 }} />
                  </Box>
                  <Box className="manage-tool-card-actions">
                    <Typography variant="caption" color="text.secondary">{TOOL_KIND_LABELS[tool.kind]}</Typography>
                    <Tooltip title="削除">
                      <span>
                        <IconButton size="small" onClick={event => { event.stopPropagation(); engine.removeToolInstance(tool.id); }} aria-label={`${tool.name}を削除`}>
                          <DeleteOutlinedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </DialogContent>
      </Dialog>
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
  const [stackOpen, setStackOpen] = useState<{ id: string; anchor: HTMLElement } | null>(null);

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
            return <Button key={stack.id} onClick={event => setStackOpen({ id: stack.id, anchor: event.currentTarget })} onMouseEnter={event => setStackOpen({ id: stack.id, anchor: event.currentTarget })} title={stack.name} variant={active ? 'contained' : 'text'} color={active ? 'primary' : 'inherit'} className="tool-rail-button tool-stack-button">
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
      <Popover open={!!stackOpen} anchorEl={stackOpen?.anchor} onClose={() => setStackOpen(null)} anchorOrigin={{ vertical: 'center', horizontal: 'right' }} transformOrigin={{ vertical: 'center', horizontal: 'left' }} disableRestoreFocus>
        <Stack sx={{ p: 1, minWidth: 180 }} spacing={.5} onMouseLeave={() => setStackOpen(null)}>
          {stacks.find(stack => stack.id === stackOpen?.id)?.toolIds.map(id => { const tool = tools.find(value => value.id === id); return tool ? <Button key={id} disabled={multi && tool.kind !== 'lasso'} startIcon={TOOL_ICONS[tool.kind]} variant={activeId === id ? 'contained' : 'text'} onClick={() => { engine.selectToolInstance(id); setStackOpen(null); }}>{tool.name}</Button> : null; })}
        </Stack>
      </Popover>
      {manageOpen && <ManageToolsDialog onClose={() => setManageOpen(false)} />}
    </Box>
  );
}
