import { useRef, useState, type ChangeEvent } from 'react';
import { engine } from '../engine/PaintEngine';
import { exportTimelapse } from '../engine/timelapse/exporter';
import { useStore } from '../state/store';
import {
  MAX_ART_SIZE,
  MIN_ART_SIZE,
  TOOL_KIND_LABELS,
  type ToolKind,
} from '../types';
import { importReferenceImage } from '../referenceImage';

async function startTimelapse(): Promise<void> {
  const set = useStore.getState().set;
  if (useStore.getState().exportProgress !== null) return;
  set({ exportProgress: 0 });
  try {
    const ok = await exportTimelapse((f) => set({ exportProgress: f }));
    if (!ok) alert('まだタイムラプスのフレームがありません');
  } catch {
    alert('タイムラプスの書き出しに失敗しました');
  } finally {
    set({ exportProgress: null });
  }
}

const TOOL_KINDS: ToolKind[] = ['pen', 'line', 'rect', 'ellipse', 'lasso', 'blur'];

function CanvasSizeDialog({ onClose }: { onClose: () => void }) {
  const canvasW = useStore((s) => s.canvasW);
  const canvasH = useStore((s) => s.canvasH);
  const [w, setW] = useState(String(canvasW));
  const [h, setH] = useState(String(canvasH));

  const apply = () => {
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
      alert(`${MIN_ART_SIZE}〜${MAX_ART_SIZE} の範囲で指定してください`);
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
    <>
      <div className="dialog-backdrop" onClick={onClose} />
      <div className="dialog">
        <div className="dialog-title">キャンバスサイズ</div>
        <label className="ctl-row">
          <span>幅</span>
          <input
            type="number"
            min={MIN_ART_SIZE}
            max={MAX_ART_SIZE}
            value={w}
            onChange={(e) => setW(e.target.value)}
          />
          <span className="num">px</span>
        </label>
        <label className="ctl-row">
          <span>高さ</span>
          <input
            type="number"
            min={MIN_ART_SIZE}
            max={MAX_ART_SIZE}
            value={h}
            onChange={(e) => setH(e.target.value)}
          />
          <span className="num">px</span>
        </label>
        <div className="hint">
          内容は左上基準で保持されます。取り消し履歴はリセットされます。
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" onClick={apply}>
            変更
          </button>
        </div>
      </div>
    </>
  );
}

/** 入出力やツール追加などをまとめたドロップダウンメニュー */
export function MainMenu() {
  const [open, setOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const progress = useStore((s) => s.exportProgress);
  const timelapseEnabled = useStore((s) => s.timelapseEnabled);
  const historyPrunableCount = useStore((s) => s.historyPrunableCount);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setToolsOpen(false);
  };

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm('現在のキャンバスを読み込んだプロジェクトで置き換えます。よろしいですか？')) {
      return;
    }
    try {
      await engine.importProject(file);
    } catch {
      alert('プロジェクトの読み込みに失敗しました');
    }
  };

  const onImportImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!importReferenceImage(file)) alert('画像ファイルを選択してください');
  };

  return (
    <div className="menu-wrap">
      <button
        className={`menu-btn${open ? ' active' : ''}`}
        title="メニュー"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <circle cx="12" cy="5" r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="12" cy="19" r="1.9" />
        </svg>
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={close} />
          <div className="menu-pop">
            <button onClick={() => setToolsOpen((o) => !o)}>
              ツールを追加 {toolsOpen ? '▾' : '▸'}
            </button>
            {toolsOpen && (
              <div className="menu-sub">
                {TOOL_KINDS.map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      engine.addToolInstance(k);
                      close();
                    }}
                  >
                    {TOOL_KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                setSizeOpen(true);
                close();
              }}
            >
              キャンバスサイズ…
            </button>
            <button
              onClick={() => {
                imageRef.current?.click();
                close();
              }}
            >
              画像をインポート…
            </button>
            <button
              onClick={() => {
                engine.exportPNG();
                close();
              }}
            >
              PNG を保存
            </button>
            <button
              onClick={() => {
                void engine.exportProject();
                close();
              }}
            >
              プロジェクトをダウンロード
            </button>
            <button
              onClick={() => {
                fileRef.current?.click();
                close();
              }}
            >
              プロジェクトを読み込み…
            </button>
            <button
              disabled={progress !== null}
              onClick={() => {
                close();
                void startTimelapse();
              }}
            >
              タイムラプスを書き出し
            </button>
            <button
              className="menu-toggle"
              aria-pressed={timelapseEnabled}
              onClick={() => {
                engine.setTimelapseEnabled(!timelapseEnabled);
                close();
              }}
            >
              <span>タイムラプスを記録</span>
              <span className={timelapseEnabled ? 'on' : ''}>
                {timelapseEnabled ? 'オン' : 'オフ'}
              </span>
            </button>
            <button
              disabled={historyPrunableCount === 0}
              onClick={() => {
                const ok = confirm(
                  `${historyPrunableCount}件の履歴を削除します。\n` +
                  '現在位置より先のやり直し履歴と、ほかの分岐も削除されます。よろしいですか？',
                );
                if (ok) engine.pruneHistory(10);
                close();
              }}
            >
              履歴を直近10件に整理…
            </button>
          </div>
        </>
      )}
      {sizeOpen && <CanvasSizeDialog onClose={() => setSizeOpen(false)} />}
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onImportImage}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".rinpaint,application/json"
        style={{ display: 'none' }}
        onChange={(e) => void onImportFile(e)}
      />
    </div>
  );
}
