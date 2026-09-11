import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { useEngine } from '../EngineContext';
import { useStore } from '../../state/store';
import type { LayerMeta } from '../../model';
import { maskCandidateRows } from './maskCandidates';
import { Thumb } from './Thumb';

export function MaskControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const layers = useStore(s => s.layers);
  const rootLayerIds = useStore(s => s.rootLayerIds);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string[]>(meta.maskLayerIds ?? []);
  const byId = useMemo(() => new Map(layers.map(layer => [layer.id, layer])), [layers]);
  const candidates = maskCandidateRows(rootLayerIds, layers, meta.id, query);
  const show = () => {
    setDraft([...(meta.maskLayerIds ?? [])]);
    setQuery('');
    setOpen(true);
  };
  const typeLabel = (layer: LayerMeta) =>
    layer.type === 'raster' ? 'ラスター' : layer.type === 'shape' ? '図形' : '文字';
  return (
    <>
      <Stack spacing={1} className="mask-controls">
        <Stack direction="row" sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">マスク</Typography>
            <Typography variant="body2">
              {meta.maskLayerIds?.length
                ? `選択した${meta.maskLayerIds.length}レイヤーのアルファをOR合成`
                : '全面を補正'}
            </Typography>
          </Box>
          <Button size="small" variant="outlined" onClick={show}>編集</Button>
        </Stack>
        {!!meta.maskLayerIds?.length && (
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
            {meta.maskLayerIds.map(id => (
              <Chip
                key={id}
                size="small"
                label={byId.get(id)?.name ?? '削除済み'}
                onDelete={() =>
                  engine.commitLayerProps(
                    meta.id,
                    { maskLayerIds: meta.maskLayerIds },
                    { maskLayerIds: meta.maskLayerIds!.filter(value => value !== id) },
                    'マスクを解除',
                  )}
              />
            ))}
          </Stack>
        )}
      </Stack>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { className: 'mask-dialog' } }}
      >
        <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" sx={{ alignItems: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" component="div">マスク元レイヤー</Typography>
              <Typography variant="caption" color="text.secondary">
                アルファをOR合成して補正範囲を作成
              </Typography>
            </Box>
            <Chip size="small" label={`${draft.length}件選択`} />
          </Stack>
        </DialogTitle>
        <DialogContent className="mask-dialog-content">
          <TextField
            fullWidth
            placeholder="レイヤー名を検索"
            value={query}
            onChange={event => setQuery(event.target.value)}
            sx={{ my: 1.5 }}
          />
          {!!draft.length && (
            <Box className="mask-selected-summary">
              <Typography variant="caption" color="text.secondary">選択中</Typography>
              <Stack direction="row" sx={{ mt: 0.5, gap: 0.5, flexWrap: 'wrap' }}>
                {draft.map(id => (
                  <Chip
                    key={id}
                    size="small"
                    label={byId.get(id)?.name ?? '削除済み'}
                    onDelete={() => setDraft(current => current.filter(value => value !== id))}
                  />
                ))}
              </Stack>
            </Box>
          )}
          <Stack spacing={0.5} className="mask-layer-list">
            {candidates.map(({ layer, depth }) => {
              const selected = draft.includes(layer.id);
              return (
                <Box
                  key={layer.id}
                  className={`mask-layer-card${selected ? ' selected' : ''}`}
                  sx={{ ml: `${depth * 16}px` }}
                  onClick={() =>
                    setDraft(current =>
                      current.includes(layer.id)
                        ? current.filter(id => id !== layer.id)
                        : [...current, layer.id])}
                >
                  <Checkbox checked={selected} tabIndex={-1} />
                  <Thumb meta={layer} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>{layer.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {typeLabel(layer)}・{layer.visible ? '表示' : '非表示'}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Stack>
          {candidates.length === 0 && (
            <Box className="mask-empty">
              <Typography color="text.secondary">一致するレイヤーがありません</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>キャンセル</Button>
          <Button
            variant="contained"
            onClick={() => {
              engine.commitLayerProps(
                meta.id,
                { maskLayerIds: meta.maskLayerIds ?? [] },
                { maskLayerIds: draft },
                'マスクを変更',
              );
              setOpen(false);
            }}
          >
            適用
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
