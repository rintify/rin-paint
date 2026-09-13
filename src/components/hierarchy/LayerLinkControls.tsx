import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import type { LayerMeta } from '../../model';
import { useEngine } from '../EngineContext';
import { InfoCard } from '../inspectorLayout';

export function LayerLinkControls({
  meta,
  sourceDialogRequested = false,
  onSourceDialogOpened,
}: {
  meta: LayerMeta;
  sourceDialogRequested?: boolean;
  onSourceDialogOpened?: () => void;
}) {
  const engine = useEngine();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [targetsOpen, setTargetsOpen] = useState(false);
  const candidates = useMemo(
    () => dialogOpen ? engine.linkCandidates(meta.id) : [],
    [dialogOpen, engine, meta.id, meta.version],
  );
  const filtered = candidates.filter(candidate => candidate.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const link = meta.parameterLink;
  const source = meta.linkSource;
  const targets = meta.directLinkTargets ?? [];
  useEffect(() => {
    if (!sourceDialogRequested) return;
    setDialogOpen(true);
    onSourceDialogOpened?.();
  }, [sourceDialogRequested, onSourceDialogOpened]);
  return (
    <>
      <Stack spacing={1.5} sx={{ mb: 1.5 }}>
        {link && (
          <InfoCard tone={source?.missing ? 'warning' : 'link'}>
            <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2 }}>リンク元</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {source?.missing ? <LinkOffIcon color="warning" fontSize="small" /> : <LinkIcon color="secondary" fontSize="small" />}
              <Button
                size="small"
                fullWidth
                color={source?.missing ? 'warning' : 'secondary'}
                sx={{ justifyContent: 'flex-start' }}
                onClick={() => void engine.focusLayerReference(link.source)}
              >
                ページ {(source?.pageIndex ?? link.sourcePageIndexHint) + 1} / {source?.name ?? link.sourceNameHint}
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {link.linkedParameterIds.length} / {(meta.compatibleLinkParameterIds ?? []).length}項目をリンク中
            </Typography>
            {source?.missing && (
              <Typography variant="caption" color="warning.main">リンク元が見つかりません</Typography>
            )}
          </InfoCard>
        )}
        {!!targets.length && (
          <InfoCard tone="link">
            <Typography variant="caption" sx={{ fontWeight: 700 }}>このレイヤーはリンク元になっています（{targets.length}件）</Typography>
            {targets.slice(0, 4).map(target => (
              <Button
                key={`${target.address.pageId}:${target.address.layerId}`}
                fullWidth
                size="small"
                color="secondary"
                sx={{ justifyContent: 'flex-start' }}
                onClick={() => void engine.focusLayerReference(target.address)}
              >
                ページ {target.pageIndex + 1} / {target.name}（{target.linkedCount}項目）
              </Button>
            ))}
            {targets.length > 4 && <Button size="small" color="secondary" onClick={() => setTargetsOpen(true)}>すべて表示（{targets.length}件）</Button>}
          </InfoCard>
        )}
      </Stack>
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
            sx={{ mt: 1, mb: 1.5 }}
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
