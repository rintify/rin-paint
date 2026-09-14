import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { isToolShortcut, shortcutFromEvent, shortcutLabel, toolShortcutConflicts, toolShortcutKeys } from '../../shortcuts';
import { useStore } from '../../state/store';

export function ToolShortcutDialog({ toolId, onClose }: { toolId: string; onClose: () => void }) {
  const tools = useStore(state => state.tools);
  const shortcuts = useStore(state => state.shortcuts);
  const tool = tools.find(item => item.id === toolId);
  const [binding, setBinding] = useState(tool?.shortcut ?? '');
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!tool) return null;
  const conflicts = toolShortcutConflicts(tools, shortcuts, toolId, binding);
  const save = () => {
    useStore.getState().assignToolShortcut(toolId, binding);
    onClose();
  };
  return (
    <>
      <Dialog open onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="tool-shortcut-title">
        <DialogTitle id="tool-shortcut-title">ショートカット割り当て</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">{tool.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              アルファベット・数字・記号キーを1つ選択、またはキー欄で入力してください。同時押しは使えません。
            </Typography>
            <TextField
              select
              label="キー"
              value={binding}
              onChange={event => { setBinding(event.target.value); setError(false); }}
              slotProps={{ select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } } }}
              onKeyDown={event => {
                if (event.key === 'Escape' || event.key === 'Tab' || event.key.startsWith('Arrow') || event.key === 'Enter' || event.key === ' ') return;
                event.preventDefault();
                event.stopPropagation();
                const next = shortcutFromEvent(event.nativeEvent);
                if (event.nativeEvent.isComposing || !next || !isToolShortcut(next)) {
                  setError(true);
                  return;
                }
                setBinding(next);
                setError(false);
              }}
            >
              <MenuItem value="">未割り当て</MenuItem>
              {toolShortcutKeys.map(key => <MenuItem key={key.code} value={key.code}>{key.label}</MenuItem>)}
            </TextField>
            {error && <Alert severity="warning">修飾キーなしのアルファベット・数字・記号キーを1つ指定してください。</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={!binding} onClick={() => { setBinding(''); setError(false); }}>割り当てを解除</Button>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="contained" onClick={() => conflicts.length ? setConfirming(true) : save()}>保存</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={confirming} onClose={() => setConfirming(false)} maxWidth="xs" fullWidth aria-labelledby="tool-shortcut-conflict-title">
        <DialogTitle id="tool-shortcut-conflict-title">割り当てを上書きしますか？</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            「{shortcutLabel(binding)}」は「{conflicts.join('」「')}」に割り当てられています。元の割り当てを解除し、「{tool.name}」に割り当てます。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>キャンセル</Button>
          <Button variant="contained" onClick={save}>上書きする</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
