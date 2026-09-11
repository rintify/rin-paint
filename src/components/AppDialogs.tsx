import { create } from 'zustand';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

type AlertRequest = {
  kind: 'alert';
  message: string;
  resolve: () => void;
};

type ConfirmRequest = {
  kind: 'confirm';
  message: string;
  resolve: (ok: boolean) => void;
};

type Request = AlertRequest | ConfirmRequest;

interface DialogState {
  queue: Request[];
  enqueue: (req: Request) => void;
  shift: () => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  queue: [],
  enqueue: (req) => set((s) => ({ queue: [...s.queue, req] })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

export function appAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    useDialogStore.getState().enqueue({ kind: 'alert', message, resolve });
  });
}

export function appConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().enqueue({ kind: 'confirm', message, resolve });
  });
}

/** MUI ベースの alert / confirm。ネイティブダイアログは使わない。 */
export function AppDialogs() {
  const queue = useDialogStore((s) => s.queue);
  const current = queue[0] ?? null;

  const close = (ok: boolean) => {
    if (!current) return;
    if (current.kind === 'alert') current.resolve();
    else current.resolve(ok);
    useDialogStore.getState().shift();
  };

  return (
    <Dialog
      open={!!current}
      onClose={() => close(false)}
      aria-labelledby="app-dialog-title"
    >
      {current && (
        <>
          <DialogTitle id="app-dialog-title">
            {current.kind === 'confirm' ? '確認' : 'お知らせ'}
          </DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ whiteSpace: 'pre-wrap' }}>
              {current.message}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            {current.kind === 'confirm' && (
              <Button onClick={() => close(false)}>キャンセル</Button>
            )}
            <Button variant="contained" onClick={() => close(true)} autoFocus>
              {current.kind === 'confirm' ? 'OK' : '閉じる'}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
