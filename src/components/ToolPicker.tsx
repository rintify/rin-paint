import BlurOnIcon from '@mui/icons-material/BlurOn';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import GestureIcon from '@mui/icons-material/Gesture';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { engine } from '../engine/PaintEngine';
import { useStore } from '../state/store';
import { TOOL_KIND_LABELS, type ToolKind } from '../types';

const iconSx = { fontSize: 20 };

export const TOOL_ICONS: Record<ToolKind, ReactNode> = {
  pen: <EditOutlinedIcon sx={iconSx} />,
  line: <HorizontalRuleIcon sx={{ ...iconSx, transform: 'rotate(-45deg)' }} />,
  rect: <CropSquareIcon sx={iconSx} />,
  ellipse: <CircleOutlinedIcon sx={iconSx} />,
  lasso: <GestureIcon sx={iconSx} />,
  blur: <BlurOnIcon sx={iconSx} />,
};

function AddToolDialog({ onClose }: { onClose: () => void }) {
  const [shapePage, setShapePage] = useState(false);
  const add = (kind: ToolKind) => {
    engine.addToolInstance(kind);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>ツールを追加</DialogTitle>
      <DialogContent sx={{ overflow: 'hidden', px: 2 }}>
        <Box
          sx={{
            width: '200%',
            display: 'flex',
            transform: shapePage ? 'translateX(-50%)' : 'translateX(0)',
            transition: 'transform .24s cubic-bezier(.2,.8,.2,1)',
          }}
        >
          <Stack spacing={0.75} sx={{ width: '50%', pr: 0.25 }}>
            <Button fullWidth onClick={() => add('pen')} startIcon={TOOL_ICONS.pen} sx={{ justifyContent: 'flex-start', minHeight: 42 }}>
              ペン
            </Button>
            <Button
              fullWidth
              onClick={() => setShapePage(true)}
              startIcon={TOOL_ICONS.rect}
              endIcon={<ChevronRightIcon />}
              sx={{ justifyContent: 'flex-start', minHeight: 42, '& .MuiButton-endIcon': { ml: 'auto' } }}
            >
              図形
            </Button>
            <Button fullWidth onClick={() => add('lasso')} startIcon={TOOL_ICONS.lasso} sx={{ justifyContent: 'flex-start', minHeight: 42 }}>
              選択
            </Button>
            <Button fullWidth onClick={() => add('blur')} startIcon={TOOL_ICONS.blur} sx={{ justifyContent: 'flex-start', minHeight: 42 }}>
              ぼかし
            </Button>
          </Stack>
          <Stack spacing={0.75} sx={{ width: '50%', pl: 0.25 }}>
            <Button fullWidth onClick={() => setShapePage(false)} sx={{ justifyContent: 'flex-start' }}>
              ‹ 戻る
            </Button>
            {(['line', 'rect', 'ellipse'] as ToolKind[]).map((kind) => (
              <Button key={kind} fullWidth onClick={() => add(kind)} startIcon={TOOL_ICONS[kind]} sx={{ justifyContent: 'flex-start', minHeight: 42 }}>
                {TOOL_KIND_LABELS[kind]}
              </Button>
            ))}
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
      </DialogActions>
    </Dialog>
  );
}

function ManageToolsDialog({ onClose }: { onClose: () => void }) {
  const tools = useStore((s) => s.tools);
  const activeId = useStore((s) => s.activeToolId);
  const [addOpen, setAddOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ anchorId: string; slot: number; side: 'before' | 'after' } | null>(null);
  const cardElements = useRef(new Map<string, HTMLElement>());
  const beforeMove = useRef<Map<string, DOMRect> | null>(null);
  const movedId = useRef<string | null>(null);

  useLayoutEffect(() => {
    const previous = beforeMove.current;
    if (!previous) return;
    beforeMove.current = null;
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
    const moved = movedId.current ? cardElements.current.get(movedId.current) : null;
    movedId.current = null;
    moved?.animate(
      [{ boxShadow: '0 0 0 2px rgba(79, 140, 255, .95)' }, { boxShadow: '0 0 0 0 rgba(79, 140, 255, 0)' }],
      { duration: 520, easing: 'ease-out' },
    );
  }, [tools]);

  const finishDrag = () => {
    setDragId(null);
    setDropTarget(null);
  };
  const dropAt = (slot: number) => {
    if (!dragId) return finishDrag();
    const from = tools.findIndex((tool) => tool.id === dragId);
    if (from < 0) return finishDrag();
    const to = from < slot ? slot - 1 : slot;
    if (from !== to) {
      beforeMove.current = new Map(
        [...cardElements.current].map(([id, element]) => [id, element.getBoundingClientRect()]),
      );
      movedId.current = dragId;
      engine.reorderToolInstance(from, to);
    }
    finishDrag();
  };

  return (
    <>
      <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>ツールを管理</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            カードをドラッグして表示順を変更できます。
          </Typography>
          <Box className="manage-tool-card-grid">
            {tools.map((tool, index) => {
              const target = dropTarget?.anchorId === tool.id ? dropTarget : null;
              return (
                <Box
                  key={tool.id}
                  ref={(element: HTMLElement | null) => {
                    if (element) cardElements.current.set(tool.id, element);
                    else cardElements.current.delete(tool.id);
                  }}
                  className={`manage-tool-card${target ? ` drop-${target.side}` : ''}`}
                  onDragOver={(event) => {
                    if (!dragId || dragId === tool.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    const rect = event.currentTarget.getBoundingClientRect();
                    const before = event.clientX < rect.left + rect.width / 2;
                    setDropTarget({ anchorId: tool.id, slot: index + (before ? 0 : 1), side: before ? 'before' : 'after' });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (dropTarget) dropAt(dropTarget.slot);
                  }}
                  sx={{
                    border: 1,
                    borderColor: tool.id === activeId ? 'primary.main' : 'divider',
                    bgcolor: tool.id === activeId ? 'action.selected' : 'action.hover',
                    opacity: dragId === tool.id ? 0.45 : 1,
                  }}
                >
                  <Box className="manage-tool-icon">{TOOL_ICONS[tool.kind]}</Box>
                  <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1, fontWeight: 600 }}>
                    {tool.name}
                  </Typography>
                  <Box
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', tool.id);
                      setDragId(tool.id);
                    }}
                    onDragEnd={finishDrag}
                    sx={{ display: 'grid', placeItems: 'center', cursor: 'grab' }}
                    aria-label={`${tool.name}を並べ替え`}
                  >
                    <DragIndicatorIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                  </Box>
                  <IconButton size="small" disabled={tools.length <= 1} onClick={() => engine.removeToolInstance(tool.id)} aria-label={`${tool.name}を削除`}>
                    <DeleteOutlinedIcon fontSize="small" />
                  </IconButton>
                </Box>
              );
            })}
          </Box>
          <Button fullWidth variant="outlined" sx={{ mt: 1.5, borderStyle: 'dashed' }} onClick={() => setAddOpen(true)}>
            ＋ ツールを追加…
          </Button>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="contained" onClick={onClose}>完了</Button>
        </DialogActions>
      </Dialog>
      {addOpen && <AddToolDialog onClose={() => setAddOpen(false)} />}
    </>
  );
}

export function ToolPicker() {
  const tools = useStore((s) => s.tools);
  const activeId = useStore((s) => s.activeToolId);
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <Box className="section">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>ツール</Typography>
        <Tooltip title="ツールを管理">
          <IconButton size="small" onClick={() => setManageOpen(true)} aria-label="ツールを管理">
            <SettingsIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.75 }}>
        {tools.map((tool) => {
          const active = activeId === tool.id;
          return (
            <Button
              key={tool.id}
              onClick={() => engine.selectToolInstance(tool.id)}
              title={tool.name}
              variant={active ? 'contained' : 'outlined'}
              color={active ? 'primary' : 'inherit'}
              sx={{
                position: 'relative',
                flexDirection: 'column',
                gap: 0.25,
                py: 1,
                px: 0.25,
                minWidth: 0,
                color: active ? 'primary.contrastText' : 'text.secondary',
                bgcolor: active ? 'primary.dark' : 'transparent',
                borderColor: active ? 'primary.main' : 'divider',
              }}
            >
              {tool.kind !== 'lasso' && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 5,
                    left: 5,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    border: '1px solid rgba(255,255,255,0.35)',
                    background: tool.color === 'transparent'
                      ? 'repeating-conic-gradient(#c9c9c9 0% 25%, #fff 0% 50%) 0 0 / 6px 6px'
                      : tool.color,
                  }}
                />
              )}
              {TOOL_ICONS[tool.kind]}
              <Typography variant="caption" noWrap sx={{ maxWidth: '100%', fontSize: 10.5, lineHeight: 1.2 }}>
                {tool.name}
              </Typography>
            </Button>
          );
        })}
      </Box>
      {manageOpen && <ManageToolsDialog onClose={() => setManageOpen(false)} />}
    </Box>
  );
}
