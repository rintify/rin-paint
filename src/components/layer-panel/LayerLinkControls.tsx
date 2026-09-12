import CloseIcon from '@mui/icons-material/Close';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import type { LayerMeta } from '../../model';
import { useEngine } from '../EngineContext';
import { layerParameterDescriptors, parameterSemanticId } from '../../engine/layerParameters';

export function LayerLinkControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const candidates = useMemo(
    () => dialogOpen ? engine.linkCandidates(meta.id) : [],
    [dialogOpen, engine, meta.id, meta.version],
  );
  const filtered = candidates.filter(candidate => candidate.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const link = meta.parameterLink;
  const source = meta.linkSource;
  const targets = meta.directLinkTargets ?? [];
  const labels = new Map(layerParameterDescriptors(meta).map(descriptor => [parameterSemanticId(descriptor), descriptor.label]));
  return (
    <>
      <Stack spacing={1} sx={{ mb: 1.25 }}>
        {!link && (
          <Button size="small" startIcon={<LinkIcon />} onClick={() => setDialogOpen(true)}>リンク元を設定</Button>
        )}
        {link && (
          <Card variant="outlined" sx={{ p: 1, borderColor: source?.missing ? 'warning.main' : 'primary.main' }}>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              {source?.missing ? <LinkOffIcon color="warning" fontSize="small" /> : <LinkIcon color="primary" fontSize="small" />}
              <Button
                size="small"
                color={source?.missing ? 'warning' : 'primary'}
                sx={{ minWidth: 0, justifyContent: 'flex-start', flex: 1, textTransform: 'none' }}
                onClick={() => void engine.focusLayerReference(link.source)}
              >
                ページ {(source?.pageIndex ?? link.sourcePageIndexHint) + 1} / {source?.name ?? link.sourceNameHint}
              </Button>
              <Button size="small" onClick={() => setDialogOpen(true)}>変更</Button>
              <Tooltip title="現在値を残してリンク元を削除">
                <IconButton size="small" aria-label="リンク元を削除" onClick={() => engine.removeLayerLink(meta.id)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <IconButton size="small" aria-label="リンク操作" onClick={event => setMenuAnchor(event.currentTarget)}>
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {link.linkedParameterIds.length} / {(meta.compatibleLinkParameterIds ?? []).length}項目をリンク中
            </Typography>
            {!source?.missing && (
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
                {(meta.compatibleLinkParameterIds ?? []).map(id => link.linkedParameterIds.includes(id) ? (
                  <Chip key={id} size="small" color="primary" icon={<LinkIcon />} label={labels.get(id) ?? id} />
                ) : (
                  <Tooltip key={id} title={`${labels.get(id) ?? id}をリンク元の現在値で上書き`}>
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={<LinkOffIcon />}
                      label={labels.get(id) ?? id}
                      clickable
                      aria-label={`${labels.get(id) ?? id}を再リンク`}
                      onClick={() => void engine.relinkLayerParameter(meta.id, id)}
                    />
                  </Tooltip>
                ))}
              </Stack>
            )}
            {source?.missing && <Alert severity="warning" sx={{ mt: 0.75, py: 0 }}>リンク元が見つかりません</Alert>}
          </Card>
        )}
        {!!targets.length && (
          <Card variant="outlined" sx={{ p: 1 }}>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>このレイヤーはリンク元になっています（{targets.length}件）</Typography>
            {targets.slice(0, 4).map(target => (
              <Button
                key={`${target.address.pageId}:${target.address.layerId}`}
                fullWidth
                size="small"
                sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                onClick={() => void engine.focusLayerReference(target.address)}
              >
                ページ {target.pageIndex + 1} / {target.name}（{target.linkedCount}項目）
              </Button>
            ))}
            {targets.length > 4 && <Button size="small" onClick={() => setTargetsOpen(true)}>すべて表示（{targets.length}件）</Button>}
          </Card>
        )}
      </Stack>
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => { setMenuAnchor(null); void engine.relinkAllLayerParameters(meta.id); }}>
          互換項目をすべて再リンク
        </MenuItem>
      </Menu>
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>リンク元レイヤーを変更</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="レイヤー名で検索"
            value={query}
            onChange={event => setQuery(event.target.value)}
            sx={{ mt: 0.5, mb: 1 }}
          />
          <List dense sx={{ maxHeight: 420, overflow: 'auto' }}>
            {filtered.map(candidate => (
              <ListItemButton
                key={`${candidate.address.pageId}:${candidate.address.layerId}`}
                disabled={!!candidate.disabledReason}
                onClick={() => {
                  void engine.changeLayerLinkSource(meta.id, candidate.address);
                  setDialogOpen(false);
                }}
              >
                <ListItemText
                  primary={`ページ ${candidate.pageIndex + 1} / ${candidate.name}`}
                  secondary={candidate.disabledReason ?? `${candidate.equalCount}件一致 / ${candidate.compatibleCount}件互換`}
                />
              </ListItemButton>
            ))}
            {!filtered.length && <Box sx={{ p: 2 }}><Typography color="text.secondary">候補がありません</Typography></Box>}
          </List>
        </DialogContent>
        <DialogActions><Button onClick={() => setDialogOpen(false)}>閉じる</Button></DialogActions>
      </Dialog>
      <Dialog open={targetsOpen} onClose={() => setTargetsOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>直接リンクしているレイヤー</DialogTitle>
        <DialogContent>
          <List dense>
            {targets.map(target => (
              <ListItemButton
                key={`${target.address.pageId}:${target.address.layerId}`}
                onClick={() => { setTargetsOpen(false); void engine.focusLayerReference(target.address); }}
              >
                <ListItemText primary={`ページ ${target.pageIndex + 1} / ${target.name}`} secondary={`${target.linkedCount}項目をリンク中`} />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions><Button onClick={() => setTargetsOpen(false)}>閉じる</Button></DialogActions>
      </Dialog>
    </>
  );
}
