import RedoIcon from '@mui/icons-material/Redo';
import UndoIcon from '@mui/icons-material/Undo';
import { Badge, Box, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import { useState, type MouseEvent } from 'react';
import { useStore } from '../state/store';
import { useEngine } from './EngineContext';

export function HistoryControls() {
  const engine = useEngine();
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const branches = useStore((s) => s.redoBranches);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const onRedo = (e: MouseEvent<HTMLElement>) => {
    if (branches.length > 1) {
      setAnchor(e.currentTarget);
      return;
    }
    void engine.redo();
  };

  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
      <Tooltip title="戻る (Cmd+Z)">
        <span>
          <IconButton
            size="small"
            disabled={!canUndo}
            onClick={() => {
              setAnchor(null);
              void engine.undo();
            }}
            aria-label="戻る"
          >
            <UndoIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={branches.length > 1 ? '進む (分岐あり)' : '進む (Cmd+Shift+Z)'}>
        <span>
          <IconButton
            size="small"
            disabled={!canRedo}
            onClick={onRedo}
            aria-label="進む"
            color={branches.length > 1 ? 'primary' : 'default'}
          >
            <Badge
              variant="dot"
              color="primary"
              invisible={branches.length <= 1}
              overlap="circular"
            >
              <RedoIcon fontSize="small" />
            </Badge>
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor && branches.length > 1}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem disabled dense>
          <Typography variant="caption" color="text.secondary">
            どちらへ進む？
          </Typography>
        </MenuItem>
        {branches.map((b) => (
          <MenuItem
            key={b.index}
            onClick={() => {
              setAnchor(null);
              void engine.redo(b.index);
            }}
          >
            {b.index + 1}. {b.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
