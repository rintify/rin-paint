import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { engine } from '../engine/PaintEngine';
import { exportTimelapse } from '../engine/timelapse/exporter';
import { importReferenceImage } from '../referenceImage';
import { useStore } from '../state/store';
import { MAX_ART_SIZE, MIN_ART_SIZE } from '../types';
import { appAlert, appConfirm } from './AppDialogs';

async function startTimelapse(): Promise<void> {
  const set = useStore.getState().set;
  if (useStore.getState().exportProgress !== null) return;
  set({ exportProgress: 0 });
  try {
    const ok = await exportTimelapse((f) => set({ exportProgress: f }));
    if (!ok) await appAlert('まだタイムラプスのフレームがありません');
  } catch {
    await appAlert('タイムラプスの書き出しに失敗しました');
  } finally {
    set({ exportProgress: null });
  }
}

function CanvasSizeDialog({ onClose }: { onClose: () => void }) {
  const canvasW = useStore((s) => s.canvasW);
  const canvasH = useStore((s) => s.canvasH);
  const [w, setW] = useState(String(canvasW));
  const [h, setH] = useState(String(canvasH));

  const apply = async () => {
    const nw = Number(w);
    const nh = Number(h);
    if (
      !Number.isFinite(nw) ||
      !Number.isFinite(nh) ||
      nw < MIN_ART_SIZE ||
      nh < MIN_ART_SIZE ||
      nw > MAX_ART_SIZE ||
      nh > MAX_ART_SIZE
    ) {
      await appAlert(`${MIN_ART_SIZE}〜${MAX_ART_SIZE} の範囲で指定してください`);
      return;
    }
    if (Math.round(nw) === canvasW && Math.round(nh) === canvasH) {
      onClose();
      return;
    }
    engine.resizeCanvas(nw, nh);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>キャンバスサイズ</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
        <TextField
          label="幅"
          type="number"
          value={w}
          onChange={(e) => setW(e.target.value)}
          slotProps={{
            htmlInput: { min: MIN_ART_SIZE, max: MAX_ART_SIZE },
            input: { endAdornment: <Typography variant="caption">px</Typography> },
          }}
        />
        <TextField
          label="高さ"
          type="number"
          value={h}
          onChange={(e) => setH(e.target.value)}
          slotProps={{
            htmlInput: { min: MIN_ART_SIZE, max: MAX_ART_SIZE },
            input: { endAdornment: <Typography variant="caption">px</Typography> },
          }}
        />
        <Typography variant="caption" color="text.secondary">
          内容は左上基準で保持されます。取り消し履歴はリセットされます。
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" onClick={() => void apply()}>
          変更
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** 入出力やツール追加などをまとめたドロップダウンメニュー */
export function MainMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [sizeOpen, setSizeOpen] = useState(false);
  const progress = useStore((s) => s.exportProgress);
  const timelapseEnabled = useStore((s) => s.timelapseEnabled);
  const historyPrunableCount = useStore((s) => s.historyPrunableCount);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const close = () => setAnchor(null);

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ok = await appConfirm(
      '現在のキャンバスを読み込んだプロジェクトで置き換えます。よろしいですか？',
    );
    if (!ok) return;
    try {
      await engine.importProject(file);
    } catch {
      await appAlert('プロジェクトの読み込みに失敗しました');
    }
  };

  const onImportImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!importReferenceImage(file)) await appAlert('画像ファイルを選択してください');
  };

  const openMenu = (e: MouseEvent<HTMLElement>) => {
    setAnchor(e.currentTarget);
  };

  return (
    <Box>
      <Tooltip title="メニュー">
        <IconButton
          size="small"
          onClick={openMenu}
          color={anchor ? 'primary' : 'default'}
          aria-label="メニュー"
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            setSizeOpen(true);
            close();
          }}
        >
          キャンバスサイズ…
        </MenuItem>
        <MenuItem
          onClick={() => {
            imageRef.current?.click();
            close();
          }}
        >
          画像をインポート…
        </MenuItem>
        <MenuItem
          onClick={() => {
            engine.exportPNG();
            close();
          }}
        >
          PNG を保存
        </MenuItem>
        <MenuItem
          onClick={() => {
            void engine.exportProject();
            close();
          }}
        >
          プロジェクトをダウンロード
        </MenuItem>
        <MenuItem
          onClick={() => {
            fileRef.current?.click();
            close();
          }}
        >
          プロジェクトを読み込み…
        </MenuItem>
        <Divider />
        <MenuItem
          disabled={progress !== null}
          onClick={() => {
            close();
            void startTimelapse();
          }}
        >
          タイムラプスを書き出し
        </MenuItem>
        <MenuItem
          onClick={() => {
            engine.setTimelapseEnabled(!timelapseEnabled);
            close();
          }}
        >
          <ListItemText>タイムラプスを記録</ListItemText>
          <Typography
            variant="caption"
            color={timelapseEnabled ? 'primary' : 'text.secondary'}
            sx={{ ml: 2 }}
          >
            {timelapseEnabled ? 'オン' : 'オフ'}
          </Typography>
        </MenuItem>
        <Divider />
        <MenuItem
          disabled={historyPrunableCount === 0}
          onClick={() => {
            const count = historyPrunableCount;
            close();
            void (async () => {
              const ok = await appConfirm(
                `${count}件の履歴を削除します。\n` +
                  '現在位置より先のやり直し履歴と、ほかの分岐も削除されます。よろしいですか？',
              );
              if (ok) engine.pruneHistory(10);
            })();
          }}
        >
          履歴を直近10件に整理…
        </MenuItem>
      </Menu>
      {sizeOpen && <CanvasSizeDialog onClose={() => setSizeOpen(false)} />}
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => void onImportImage(e)}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".rinpaint,application/json"
        style={{ display: 'none' }}
        onChange={(e) => void onImportFile(e)}
      />
    </Box>
  );
}
