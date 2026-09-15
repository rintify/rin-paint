import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState, type MouseEvent } from 'react';
import { exportTimelapse } from '../engine/timelapse/exporter';
import { useStore } from '../state/store';
import { pagePixels, validatePageSpec } from '../engine/pageSpec';
import {
  matchingPaperTemplate,
  PAPER_SIZE_TEMPLATES,
  paperSizeDimensions,
} from '../model/page';
import { appAlert, appConfirm } from './AppDialogs';
import { useEngine } from './EngineContext';
import { pickFile } from './hooks/pickFile';
import { ShortcutSettingsDialog } from './ShortcutSettingsDialog';
import { PreferencesDialog } from './PreferencesDialog';
import {
  importProjectWithConfirmation,
  importSettingsWithConfirmation,
} from './FileActions';

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

function formatMm(value: number): string {
  return String(Number(value.toFixed(3)));
}

function PageSizeDialog({ onClose }: { onClose: () => void }) {
  const engine = useEngine();
  const spec = useStore((s) => s.pageSpec);
  const initialW = String(Number(spec.widthMm.toFixed(3)));
  const initialH = String(Number(spec.heightMm.toFixed(3)));
  const [w, setW] = useState(initialW);
  const [h, setH] = useState(initialH);
  const [ppi, setPpi] = useState(String(spec.ppi));
  const [applying, setApplying] = useState(false);
  const next = { widthMm: w === initialW ? spec.widthMm : Number(w), heightMm: h === initialH ? spec.heightMm : Number(h), ppi: Number(ppi) };
  const error = validatePageSpec(next);
  const pixels = pagePixels(next);
  const matched = matchingPaperTemplate(next.widthMm, next.heightMm);
  const landscape = next.widthMm > next.heightMm;

  const applyPaper = (id: string, nextLandscape: boolean) => {
    const template = PAPER_SIZE_TEMPLATES.find(item => item.id === id);
    if (!template) return;
    const size = paperSizeDimensions(template, nextLandscape);
    setW(formatMm(size.widthMm));
    setH(formatMm(size.heightMm));
  };

  const apply = async () => {
    if (error || applying) return;
    setApplying(true);
    try { await engine.resizePage(next); onClose(); }
    catch (err) { await appAlert(err instanceof Error ? err.message : 'サイズを変更できませんでした'); }
    finally { setApplying(false); }
  };

  return (
    <Dialog open onClose={applying ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>ページサイズ</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        <FormControl size="small" fullWidth>
          <InputLabel id="paper-template-label">用紙サイズ</InputLabel>
          <Select
            labelId="paper-template-label"
            label="用紙サイズ"
            value={matched?.id ?? 'custom'}
            onChange={event => {
              const id = String(event.target.value);
              if (id === 'custom') return;
              applyPaper(id, landscape);
            }}
          >
            <MenuItem value="custom">カスタム</MenuItem>
            {PAPER_SIZE_TEMPLATES.map(template => (
              <MenuItem key={template.id} value={template.id}>
                {template.label}（{template.widthMm} × {template.heightMm} mm）
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="幅 (mm)"
          type="text"
          inputMode="decimal"
          value={w}
          onChange={(e) => setW(e.target.value)}
          slotProps={{
            htmlInput: { min: 0.01, step: 0.1 },
          }}
        />
        <TextField
          label="高さ (mm)"
          type="text"
          inputMode="decimal"
          value={h}
          onChange={(e) => setH(e.target.value)}
          slotProps={{
            htmlInput: { min: 0.01, step: 0.1 },
          }}
        />
        <Button
          onClick={() => {
            setW(h);
            setH(w);
          }}
        >
          縦横を入れ替え
        </Button>
        <TextField label="解像度 (ppi)" type="text" inputMode="decimal" value={ppi} onChange={e => setPpi(e.target.value)} />
        <Typography variant="body2" color={error ? 'error' : 'text.secondary'}>{error ?? `${pixels.width} × ${pixels.height} px`}</Typography>
        <Typography variant="caption" color="text.secondary">
          幅・高さは左上基準で変更します。解像度の変更は、実寸を保って画像を補間します。変更は取り消せます。
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={applying}>キャンセル</Button>
        <Button variant="contained" disabled={!!error || applying} onClick={() => void apply()}>
          {applying ? '変更中…' : '変更'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** 入出力やツール追加などをまとめたドロップダウンメニュー */
export function MainMenu() {
  const engine = useEngine();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const progress = useStore((s) => s.exportProgress);
  const timelapseEnabled = useStore((s) => s.timelapseEnabled);
  const historyPrunableCount = useStore((s) => s.historyPrunableCount);
  const projectOpenMode = useStore((s) => s.projectOpenMode);
  const saveFailed = useStore((s) => s.saveFailed);

  const close = () => setAnchor(null);

  const onImportFile = async () => {
    const file = await pickFile('.rinpaint,application/json');
    if (!file) return;
    await importProjectWithConfirmation(engine, file);
  };

  const onImportSettings = async () => {
    const file = await pickFile('.rinsettings,application/json');
    if (!file) return;
    await importSettingsWithConfirmation(engine, file);
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
        <MenuItem onClick={() => { setNewOpen(true); close(); }}>新規プロジェクト…</MenuItem>
        <MenuItem
          onClick={() => {
            setSizeOpen(true);
            close();
          }}
        >
          ページサイズ…
        </MenuItem>
        <MenuItem
          onClick={() => {
            void engine.exportPNG().catch(error => appAlert(error instanceof Error ? error.message : 'PNGの保存に失敗しました'));
            close();
          }}
        >
          PNG を保存
        </MenuItem>
        <MenuItem
          onClick={() => {
            void engine.exportProject().catch(error => appAlert(error instanceof Error ? error.message : '保存に失敗しました'));
            close();
          }}
        >
          プロジェクトをダウンロード
        </MenuItem>
        {projectOpenMode === 'view-only' && (
          <MenuItem
            onClick={() => {
              void engine.exportOriginal().catch(error => appAlert(error instanceof Error ? error.message : '保存に失敗しました'));
              close();
            }}
          >
            元のまま保存
          </MenuItem>
        )}
        {saveFailed && (
          <MenuItem
            onClick={() => {
              void engine.retrySave().catch(error => appAlert(error instanceof Error ? error.message : '保存に失敗しました'));
              close();
            }}
          >
            保存を再試行
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            close();
            void onImportFile();
          }}
        >
          プロジェクトを読み込み…
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { setPreferencesOpen(true); close(); }}>
          環境設定…
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            void engine.exportSettings().catch(error => appAlert(error instanceof Error ? error.message : '設定の保存に失敗しました'));
          }}
        >
          設定をエクスポート
        </MenuItem>
        <MenuItem onClick={() => { close(); void onImportSettings(); }}>
          設定をインポート…
        </MenuItem>
        <MenuItem onClick={() => { setShortcutsOpen(true); close(); }}>
          ショートカット管理…
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
      {sizeOpen && <PageSizeDialog onClose={() => setSizeOpen(false)} />}
      {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
      {shortcutsOpen && <ShortcutSettingsDialog onClose={() => setShortcutsOpen(false)} />}
      <Dialog open={newOpen} onClose={creating ? undefined : () => setNewOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>新規プロジェクトを作成しますか？</DialogTitle>
        <DialogContent>
          <Typography>現在の描画内容、すべての履歴、タイムラプス、追加フォントを消去します。この操作は取り消せません。</Typography>
          <Typography color="text.secondary" sx={{ mt: 1.5 }}>ページのサイズ・解像度と登録ツールは引き継ぎます。</Typography>
        </DialogContent>
        <DialogActions>
          <Button autoFocus disabled={creating} onClick={() => setNewOpen(false)}>キャンセル</Button>
          <Button variant="contained" color="error" disabled={creating} onClick={() => {
            setCreating(true);
            void engine.newProject().then(() => setNewOpen(false)).catch(error => appAlert(error instanceof Error ? error.message : '新規作成に失敗しました')).finally(() => setCreating(false));
          }}>{creating ? '作成中…' : '新規作成'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
