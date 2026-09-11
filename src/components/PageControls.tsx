import AddIcon from '@mui/icons-material/Add';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ViewCarouselOutlinedIcon from '@mui/icons-material/ViewCarouselOutlined';
import { Box, Button, Dialog, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { engine } from '../engine/PaintEngine';
import { loadPageThumbnail } from '../engine/persistence/db';
import { useStore } from '../state/store';
import { appAlert, appConfirm } from './AppDialogs';

function Thumbnail({ id, version }: { id: string; version: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    let objectUrl = '';
    void loadPageThumbnail(id).then(blob => {
      if (!alive || !blob) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, version]);
  return url ? <Box component="img" src={url} alt="" className="page-thumbnail" /> : <Box className="page-thumbnail page-thumbnail-empty" />;
}

function PageManager({ onClose }: { onClose: () => void }) {
  const pages = useStore(s => s.pages);
  const active = useStore(s => s.activePageId);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  return <Dialog open onClose={onClose} maxWidth="md" fullWidth slotProps={{ paper: { sx: { borderRadius: 3, height: 'min(720px, calc(100vh - 48px))' } } }}>
    <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box sx={{ flex: 1 }}><Typography variant="h6">ページ管理</Typography><Typography variant="caption" color="text.secondary">クリックで移動、ドラッグで並べ替え</Typography></Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => void engine.addPage().catch(error => appAlert(String(error)))}>ページを追加</Button>
        <IconButton onClick={onClose} aria-label="閉じる"><CloseIcon /></IconButton>
      </Stack>
    </DialogTitle>
    <DialogContent sx={{ p: 2.5 }}>
      <Box className="page-card-grid">
        {pages.map((page, index) => <Box key={page.id} draggable className={`page-card${page.id === active ? ' active' : ''}${over === index ? ' drop-before' : ''}`}
          onDragStart={() => setDrag(index)} onDragEnd={() => { setDrag(null); setOver(null); }}
          onDragOver={event => { event.preventDefault(); setOver(index); }}
          onDrop={event => { event.preventDefault(); if (drag !== null) void engine.reorderPages(drag, index); setDrag(null); setOver(null); }}
          onClick={() => void engine.switchPage(page.id).catch(error => appAlert(String(error)))}>
          <Thumbnail id={page.id} version={page.thumbnailVersion} />
          <Stack direction="row" sx={{ alignItems: 'center', px: 1, py: .75 }}>
            <Typography variant="body2" sx={{ flex: 1, fontWeight: page.id === active ? 700 : 500 }}>ページ {index + 1}</Typography>
            <IconButton size="small" aria-label={`ページ${index + 1}のメニュー`} onClick={event => { event.stopPropagation(); setMenu({ id: page.id, anchor: event.currentTarget }); }}><MoreVertIcon fontSize="small" /></IconButton>
          </Stack>
        </Box>)}
      </Box>
      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem disabled={pages.length <= 1} sx={{ color: 'error.main' }} onClick={async () => {
          const id = menu?.id; setMenu(null); if (!id) return;
          if (await appConfirm('このページのレイヤー・履歴・参照画像・タイムラプスを削除します。よろしいですか？')) await engine.deletePage(id);
        }}><DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} />削除</MenuItem>
      </Menu>
    </DialogContent>
  </Dialog>;
}

export function PageControls({ compact = false }: { compact?: boolean }) {
  const pages = useStore(s => s.pages);
  const active = useStore(s => s.activePageId);
  const busy = useStore(s => s.pageBusy);
  const [open, setOpen] = useState(false);
  const index = Math.max(0, pages.findIndex(page => page.id === active));
  if (compact) return <>
    <Tooltip title="ページ管理"><IconButton size="small" onClick={() => setOpen(true)} aria-label="ページ管理"><ViewCarouselOutlinedIcon fontSize="small" /></IconButton></Tooltip>
    {open && <PageManager onClose={() => setOpen(false)} />}
  </>;
  if (pages.length < 2) return null;
  return <Stack direction="row" className="page-stepper" sx={{ alignItems: 'center' }}>
    <IconButton size="small" disabled={busy || index === 0} onClick={() => void engine.switchPage(pages[index - 1].id)} aria-label="前のページ"><ChevronLeftIcon fontSize="small" /></IconButton>
    <Typography variant="caption" sx={{ minWidth: 42, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{index + 1} / {pages.length}</Typography>
    <IconButton size="small" disabled={busy || index === pages.length - 1} onClick={() => void engine.switchPage(pages[index + 1].id)} aria-label="次のページ"><ChevronRightIcon fontSize="small" /></IconButton>
  </Stack>;
}
