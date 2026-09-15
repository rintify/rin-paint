import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Switch,
  Typography,
} from '@mui/material';
import { useStore } from '../state/store';

export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const autoLinkOnPaste = useStore(state => state.autoLinkOnPaste);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>環境設定</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Typography variant="overline" color="text.secondary">ペースト</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 42 }}>
          <Typography component="label" htmlFor="auto-link-on-paste" variant="body2">
            自動リンクしてペースト
          </Typography>
          <Switch
            id="auto-link-on-paste"
            size="small"
            checked={autoLinkOnPaste}
            onChange={event => useStore.getState().set({ autoLinkOnPaste: event.target.checked })}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  );
}
