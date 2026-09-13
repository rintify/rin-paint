import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditIcon from '@mui/icons-material/Edit';
import { Box, Button, IconButton, Paper, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { useStore } from '../state/store';
import { useEngine } from './EngineContext';
import { appAlert, appConfirm } from './AppDialogs';

/** Modeless by design: the hierarchy remains a live drag source and drop target. */
export function BinPanel({ onClose }: { onClose: () => void }) {
  const engine = useEngine();
  const items = useStore(state => state.binItems);
  const editing = useStore(state => state.editingDocument);
  const [dragActive, setDragActive] = useState(false);
  return (
    <Paper
      role="dialog"
      aria-label="ビン"
      data-canvas-ui
      elevation={12}
      onDragOver={event => {
        if (event.dataTransfer.types.includes('text/plain')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDragActive(true);
        }
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={event => {
        event.preventDefault();
        setDragActive(false);
        const layerId = event.dataTransfer.getData('text/plain');
        if (layerId) void engine.putLayerInBin(layerId).catch(error => appAlert(String(error)));
      }}
      sx={{
        position: 'fixed', left: 420, top: 72, width: 330, maxHeight: '70vh', zIndex: 1300,
        border: 1, borderColor: dragActive ? 'primary.main' : 'divider', overflow: 'hidden',
      }}
    >
      <Stack direction="row" sx={{ px: 1.5, py: 1, alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}>
        <Box>
          <Typography variant="subtitle2">ビン</Typography>
          <Typography variant="caption" color="text.secondary">ヒエラルキーから直接ドロップして保管</Typography>
        </Box>
        <IconButton size="small" aria-label="ビンを閉じる" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Stack>
      <Box sx={{ p: 1, overflowY: 'auto', maxHeight: 'calc(70vh - 62px)' }}>
        {!items.length && <Typography color="text.secondary" variant="body2" sx={{ p: 2, textAlign: 'center' }}>保管中のレイヤーはありません</Typography>}
        {items.map(item => (
          <Stack
            key={item.id}
            direction="row"
            draggable
            onDragStart={event => {
              event.dataTransfer.effectAllowed = 'copy';
              event.dataTransfer.setData('application/x-rin-bin-item', item.id);
              event.dataTransfer.setData('text/plain', `rin-bin:${item.id}`);
            }}
            onClick={() => void engine.openBinItem(item.id).catch(error => appAlert(String(error)))}
            sx={{ alignItems: 'center', gap: 1, px: 1, py: .75, borderRadius: 1, cursor: 'pointer', bgcolor: editing.kind === 'bin' && editing.id === item.id ? 'action.selected' : undefined, '&:hover': { bgcolor: 'action.hover' } }}
          >
            <EditIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            <Typography variant="body2" noWrap sx={{ flex: 1 }}>{item.name}</Typography>
            <Button
              size="small"
              disabled={editing.kind !== 'page'}
              onClick={event => {
                event.stopPropagation();
                void engine.placeBinItem(item.id).catch(error => appAlert(String(error)));
              }}
            >ページへ配置</Button>
            <IconButton size="small" aria-label={`${item.name}を編集`}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
            <IconButton
              size="small"
              aria-label={`${item.name}をビンから削除`}
              onClick={event => {
                event.stopPropagation();
                void (async () => {
                  if (!await appConfirm(`「${item.name}」をビンから削除します。\nページなどのリンク先は現在の内容で実体化されます。`)) return;
                  await engine.deleteBinItem(item.id);
                })().catch(error => appAlert(String(error)));
              }}
            ><DeleteOutlineIcon sx={{ fontSize: 17 }} /></IconButton>
          </Stack>
        ))}
      </Box>
    </Paper>
  );
}
