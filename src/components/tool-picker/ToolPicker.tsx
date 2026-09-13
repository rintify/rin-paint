import SettingsIcon from '@mui/icons-material/Settings';
import {
  Box,
  Button,
  IconButton,
  Paper,
  Popper,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { getToolDescriptor } from '../../tools/registry';
import { useStore } from '../../state/store';
import type { ToolInstance } from '../../types';
import { useEngine } from '../EngineContext';
import { useOutsideClick } from '../hooks/useOutsideClick';
import { ManageToolsDialog } from './ManageToolsDialog';

export function ToolPicker() {
  const engine = useEngine();
  const tools = useStore(state => state.tools);
  const layout = useStore(state => state.toolLayout);
  const stacks = useStore(state => state.toolStacks);
  const activeId = useStore(state => state.activeToolId);
  const multi = useStore(state => state.multiSelectMode);
  const [manageOpen, setManageOpen] = useState(false);
  const [stackOpen, setStackOpen] = useState<{
    id: string;
    anchor: HTMLElement;
    reason: 'hover' | 'click';
  } | null>(null);
  const hoverClose = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  anchorRef.current = stackOpen?.anchor ?? null;
  const cancelHoverClose = () => {
    if (hoverClose.current) clearTimeout(hoverClose.current);
    hoverClose.current = null;
  };
  const scheduleHoverClose = () => {
    if (stackOpen?.reason !== 'hover') return;
    cancelHoverClose();
    hoverClose.current = setTimeout(
      () => setStackOpen(current => (current?.reason === 'hover' ? null : current)),
      120,
    );
  };
  useEffect(() => () => cancelHoverClose(), []);
  useOutsideClick(popup, () => setStackOpen(null), !!stackOpen, [anchorRef]);
  useEffect(() => {
    if (!stackOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStackOpen(null);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [stackOpen]);

  return (
    <Box className="tool-rail">
      <Box className="tool-rail-heading">
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, letterSpacing: 0.5 }}>
          ツール
        </Typography>
        <Tooltip title="ツールを管理">
          <IconButton onClick={() => setManageOpen(true)} aria-label="ツールを管理">
            <SettingsIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box className="tool-rail-scroll">
        {layout.map(item => {
          if (item.type === 'stack') {
            const stack = stacks.find(value => value.id === item.stackId);
            if (!stack) return null;
            const members = stack.toolIds
              .map(id => tools.find(tool => tool.id === id))
              .filter((tool): tool is ToolInstance => !!tool);
            const active = members.some(tool => tool.id === activeId);
            return (
              <Button
                key={stack.id}
                onClick={event => {
                  cancelHoverClose();
                  setStackOpen(current =>
                    (current?.id === stack.id && current.reason === 'click'
                      ? null
                      : { id: stack.id, anchor: event.currentTarget, reason: 'click' }));
                }}
                onMouseEnter={event => {
                  cancelHoverClose();
                  setStackOpen(current =>
                    (current?.reason === 'click'
                      ? current
                      : { id: stack.id, anchor: event.currentTarget, reason: 'hover' }));
                }}
                onMouseLeave={scheduleHoverClose}
                title={stack.name}
                variant={active ? 'contained' : 'outlined'}
                color={active ? 'primary' : 'inherit'}
                className="tool-rail-button tool-stack-button"
              >
                <Box className="tool-stack-icons">
                  {members.slice(0, 4).map((tool, index) => (
                    <Box key={tool.id} sx={{ transform: `translate(${index * 3}px, ${index * -2}px)` }}>
                      {getToolDescriptor(tool.kind)?.icon}
                    </Box>
                  ))}
                </Box>
                <Typography variant="caption" noWrap>{stack.name}</Typography>
              </Button>
            );
          }
          const tool = tools.find(value => value.id === item.toolId);
          if (!tool) return null;
          const active = activeId === tool.id;
          const descriptor = getToolDescriptor(tool.kind);
          return (
            <Button
              key={tool.id}
              disabled={multi && !descriptor?.capabilities.multiSelect}
              onClick={() => engine.selectToolInstance(tool.id)}
              title={tool.name}
              variant={active ? 'contained' : 'outlined'}
              color={active ? 'primary' : 'inherit'}
              className="tool-rail-button"
            >
              {descriptor?.capabilities.color && (
                <Box
                  className="tool-color-dot"
                  sx={{
                    background: tool.color === 'transparent'
                      ? 'repeating-conic-gradient(#aaa 0% 25%, #fff 0% 50%) 0 0 / 5px 5px'
                      : tool.color,
                  }}
                />
              )}
              {descriptor?.icon}
              <Typography variant="caption" noWrap>{tool.name}</Typography>
            </Button>
          );
        })}
      </Box>
      <Popper
        open={!!stackOpen}
        anchorEl={stackOpen?.anchor}
        placement="right-start"
        sx={{ zIndex: 1300 }}
        modifiers={[{ name: 'offset', options: { offset: [0, 6] } }]}
      >
        <Paper
          ref={popup}
          className="tool-stack-popover"
          elevation={8}
          onMouseEnter={cancelHoverClose}
          onMouseLeave={scheduleHoverClose}
        >
          <Box className="tool-stack-popover-grid">
            {stacks.find(stack => stack.id === stackOpen?.id)?.toolIds.map(id => {
              const tool = tools.find(value => value.id === id);
              if (!tool) return null;
              const active = activeId === id;
              const descriptor = getToolDescriptor(tool.kind);
              return (
                <Button
                  key={id}
                  disabled={multi && !descriptor?.capabilities.multiSelect}
                  variant={active ? 'contained' : 'outlined'}
                  color={active ? 'primary' : 'inherit'}
                  className="tool-rail-button tool-stack-popover-tool"
                  onClick={() => {
                    engine.selectToolInstance(id);
                    setStackOpen(null);
                  }}
                >
                  {descriptor?.capabilities.color && (
                    <Box
                      className="tool-color-dot"
                      sx={{
                        background: tool.color === 'transparent'
                          ? 'repeating-conic-gradient(#aaa 0% 25%, #fff 0% 50%) 0 0 / 5px 5px'
                          : tool.color,
                      }}
                    />
                  )}
                  {descriptor?.icon}
                  <Typography variant="caption" noWrap>{tool.name}</Typography>
                </Button>
              );
            })}
          </Box>
        </Paper>
      </Popper>
      {manageOpen && <ManageToolsDialog onClose={() => setManageOpen(false)} />}
    </Box>
  );
}
