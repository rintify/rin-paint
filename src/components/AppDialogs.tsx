import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useEffect, useState } from 'react';

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

let enqueue: ((req: Request) => void) | null = null;

export function appAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    if (!enqueue) {
      resolve();
      return;
    }
    enqueue({ kind: 'alert', message, resolve });
  });
}

export function appConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!enqueue) {
      resolve(false);
      return;
    }
    enqueue({ kind: 'confirm', message, resolve });
  });
}

/** MUI ベースの alert / confirm。ネイティブダイアログは使わない。 */
export function AppDialogs() {
  const [queue, setQueue] = useState<Request[]>([]);
  const current = queue[0] ?? null;

  useEffect(() => {
    enqueue = (req) => setQueue((q) => [...q, req]);
    return () => {
      enqueue = null;
    };
  }, []);

  const close = (ok: boolean) => {
    if (!current) return;
    if (current.kind === 'alert') current.resolve();
    else current.resolve(ok);
    setQueue((q) => q.slice(1));
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
