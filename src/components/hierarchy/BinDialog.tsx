import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { useStore } from '../../state/store';
import { useEngine } from '../EngineContext';
import { appAlert, appConfirm } from '../AppDialogs';
import { beginLayerPointerDrag, consumeLayerDragClick } from './layerPointerDrag';

export function BinDialog({open, onClose}: {open: boolean; onClose(): void}) {
  const engine = useEngine();
  const items = useStore(state => state.binItems);
  const activeBinId = useStore(state => state.activeBinId);
  const activeLayerId = useStore(state => state.activeLayerId);
  const run = (action: Promise<unknown>) => void action.catch(error => appAlert(String(error)));
  return <Dialog open={open} onClose={onClose} disableEnforceFocus
    sx={{pointerEvents: 'none'}} slotProps={{backdrop: {sx: {pointerEvents: 'none'}}, paper: {sx: {pointerEvents: 'auto', minWidth: 340}}}}>
    <DialogTitle>ビン</DialogTitle>
    <DialogContent data-bin-drop="true">
      <Typography variant="body2" color="text.secondary" sx={{mb: 2}}>個別レイヤーをドラッグして登録できます。素材をクリックすると編集します。</Typography>
      <Stack spacing={1}>
        {items.map(item => <Box key={item.id} sx={{display: 'flex', gap: 1}}>
          <Button variant="outlined" sx={{flex: 1, touchAction: 'none'}}
            onPointerDown={event => beginLayerPointerDrag(engine, event, {kind: 'bin', id: item.id})}
            onClick={() => {if (consumeLayerDragClick()) return; onClose(); run(engine.bins.open(item.id));}}>{item.name}</Button>
          <Button onClick={() => run(engine.bins.addToPage(item.id))}>ページにリンクを追加</Button>
          <Button color="error" onClick={() => run((async()=>{
            if(await appConfirm(`「${item.name}」をビンから削除しますか？ 参照側は現在の内容で独立します。`))await engine.bins.remove(item.id);
          })())}>削除</Button>
        </Box>)}
        {!items.length && <Typography variant="body2">素材はまだありません。</Typography>}
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button disabled={!!activeBinId || !activeLayerId} onClick={() => run(engine.bins.register(activeLayerId))}>選択レイヤーをビンへ登録</Button>
      <Button onClick={onClose}>閉じる</Button>
    </DialogActions>
  </Dialog>;
}
