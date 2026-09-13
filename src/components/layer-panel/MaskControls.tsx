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
import { layerMaskIds } from '../../engine/layer-types/definition';
import { maskSourceLabel } from '../../engine/layer-types/registry';
import { canUseLayerAsMask, maskCandidateRows } from './maskCandidates';
import { focusLayerRow } from './layerPanelEvents';
import { Thumb } from './Thumb';

export function MaskControls({ meta, mode = 'adjust' }: { meta: LayerMeta; mode?: 'adjust' | 'clip' }) {
  const engine = useEngine();
  const layers = useStore(s => s.layers);
  const rootLayerIds = useStore(s => s.rootLayerIds);
  const maskIds = layerMaskIds(meta.state);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string[]>(maskIds);
  const [dropActive, setDropActive] = useState(false);
  const byId = useMemo(() => new Map(layers.map(layer => [layer.id, layer])), [layers]);
  const candidates = maskCandidateRows(rootLayerIds, layers, meta.id, query);
  const show = () => {
    setDraft([...maskIds]);
    setQuery('');
    setOpen(true);
  };
  const droppedLayerId = (event: React.DragEvent) => event.dataTransfer.getData('text/plain');
  const canDrop = (id: string) => canUseLayerAsMask(rootLayerIds, layers, meta.id, id);
  const addDroppedMask = (id: string) => {
    if (!canDrop(id) || maskIds.includes(id)) return;
    engine.commitLayerProps(
      meta.id,
      { state: { maskLayerIds: maskIds } },
      { state: { maskLayerIds: [...maskIds, id] } },
      'マスクを追加',
    );
  };
  return (
    <>
      <Stack
        spacing={1.5}
        className={`mask-controls${dropActive ? ' drop-active' : ''}`}
        onDragOver={event => {
          if (!canDrop(droppedLayerId(event))) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDropActive(true);
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false);
        }}
        onDrop={event => {
          event.preventDefault();
          event.stopPropagation();
          setDropActive(false);
          addDroppedMask(droppedLayerId(event));
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">マスク</Typography>
            <Typography variant="body2">
              {maskIds.length
                ? `選択した${maskIds.length}レイヤーのアルファをOR合成`
                : mode === 'adjust' ? '全面を補正' : 'マスク未指定のため変化なし'}
            </Typography>
          </Box>
          <Button size="small" variant="outlined" onClick={show}>編集</Button>
        </Stack>
        {!!maskIds.length && (
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
            {maskIds.map(id => (
              <Chip
                key={id}
                size="small"
                label={byId.get(id)?.name ?? '削除済み'}
                clickable
                onClick={() => focusLayerRow(id)}
                aria-label={`${byId.get(id)?.name ?? '削除済み'}をヒエラルキーで表示`}
                onDelete={event => {
                  event.stopPropagation();
                  engine.commitLayerProps(
                    meta.id,
                    { state: { maskLayerIds: maskIds } },
                    { state: { maskLayerIds: maskIds.filter(value => value !== id) } },
                    'マスクを解除',
                  );
                }}
              />
            ))}
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary">
          ヒエラルキーからここへドロップして追加できます。
        </Typography>
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
                アルファをOR合成して{mode === 'adjust' ? '補正範囲' : 'クリップ範囲'}を作成
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
                    clickable
                    onClick={() => focusLayerRow(id)}
                    aria-label={`${byId.get(id)?.name ?? '削除済み'}をヒエラルキーで表示`}
                    onDelete={event => {
                      event.stopPropagation();
                      setDraft(current => current.filter(value => value !== id));
                    }}
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
                      {maskSourceLabel(layer.type)}・{layer.visible ? '表示' : '非表示'}
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
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            選択したレイヤーは非表示でもマスクとして使用されます。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>キャンセル</Button>
          <Button
            variant="contained"
            onClick={() => {
              engine.commitLayerProps(
                meta.id,
                { state: { maskLayerIds: maskIds } },
                { state: { maskLayerIds: draft } },
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
