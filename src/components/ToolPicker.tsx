import BlurOnIcon from '@mui/icons-material/BlurOn';
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
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
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
            <Button fullWidth onClick={() => setShapePage(true)} startIcon={TOOL_ICONS.rect} endIcon={<Typography component="span">›</Typography>} sx={{ justifyContent: 'flex-start', minHeight: 42 }}>
              図形
            </Button>
            <Button fullWidth onClick={() => add('lasso')} startIcon={TOOL_ICONS.lasso} sx={{ justifyContent: 'flex-start', minHeight: 42 }}>
              選択
            </Button>
            <Button fullWidth onClick={() => add('blur')} startIcon={TOOL_ICONS.blur} sx={{ justifyContent: 'flex-start', minHeight: 42 }}>
              ぼかし
            </Button>
          </Stack>
          <Stack spacing={0.75} sx={{ width: '50%', pr: 0.25 }}>
            <Button fullWidth onClick={() => setShapePage(false)} sx={{ justifyContent: 'flex-start' }}>
              ‹ 戻る
            </Button>
            {(['line', 'rect', 'ellipse'] as ToolKind[]).map((kind) => (
              <Button
                key={kind}
                fullWidth
                onClick={() => add(kind)}
                startIcon={TOOL_ICONS[kind]}
                sx={{ justifyContent: 'flex-start', minHeight: 42 }}
              >
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
  const [addOpen, setAddOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') addOpen ? setAddOpen(false) : onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [addOpen, onClose]);

  return (
    <>
      <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle>ツールを管理</DialogTitle>
        <DialogContent>
          <Stack spacing={0.75} sx={{ maxHeight: 'min(420px, 55vh)', overflowY: 'auto' }}>
            {tools.map((tool, index) => (
              <Box
                key={tool.id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) engine.reorderToolInstance(dragIndex, index);
                  setDragIndex(null);
                }}
                sx={{
                  minHeight: 43,
                  display: 'grid',
                  gridTemplateColumns: '18px 25px 1fr 34px',
                  alignItems: 'center',
                  gap: 1,
                  px: 0.75,
                  py: 0.5,
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                  cursor: 'grab',
                }}
              >
                <DragIndicatorIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                {TOOL_ICONS[tool.kind]}
                <Typography variant="body2" noWrap>
                  {tool.name}
                </Typography>
                <Tooltip title={`${tool.name}を削除`}>
                  <span>
                    <IconButton
                      size="small"
                      disabled={tools.length <= 1}
                      onClick={() => engine.removeToolInstance(tool.id)}
                      aria-label={`${tool.name}を削除`}
                    >
                      <DeleteOutlinedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            ))}
          </Stack>
          <Button fullWidth sx={{ mt: 1.5 }} onClick={() => setAddOpen(true)}>
            ＋ ツールを追加…
          </Button>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={onClose}>
            完了
          </Button>
        </DialogActions>
      </Dialog>
      {addOpen && <AddToolDialog onClose={() => setAddOpen(false)} />}
    </>
  );
}

export function ToolPicker() {
  const tools = useStore((s) => s.tools);
  const activeId = useStore((s) => s.activeToolId);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <Box className="section">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
          ツール
        </Typography>
        <Tooltip title="ツール設定">
          <IconButton
            size="small"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            aria-label="ツール設定"
          >
            <SettingsIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={menuAnchor}
          open={!!menuAnchor}
          onClose={() => setMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              setManageOpen(true);
            }}
          >
            <ListItemIcon>
              <SettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>ツールを管理…</ListItemText>
          </MenuItem>
        </Menu>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 0.75,
        }}
      >
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
                    background:
                      tool.color === 'transparent'
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
