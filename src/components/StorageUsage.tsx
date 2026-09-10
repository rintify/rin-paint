import { useState } from 'react';
import { useStore } from '../state/store';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024;
    unit = units[i];
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${unit}`;
}

export function StorageUsage() {
  const [open, setOpen] = useState(false);
  const usage = useStore((s) => s.storageUsage);
  const historyCount = useStore((s) => s.historyCount);

  return (
    <div className="storage-wrap">
      <button
        className="storage-summary"
        onClick={() => setOpen((value) => !value)}
        title="データ使用量の内訳を表示"
        aria-expanded={open}
      >
        使用量（概算） {formatBytes(usage.total)}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="storage-pop">
            <div className="storage-title">使用量の内訳</div>
            <dl>
              <div>
                <dt>履歴（{historyCount}件）</dt>
                <dd>{formatBytes(usage.history)}</dd>
              </div>
              <div>
                <dt>自動保存プロジェクト</dt>
                <dd>{formatBytes(usage.project)}</dd>
              </div>
              <div>
                <dt>タイムラプス</dt>
                <dd>{formatBytes(usage.timelapse)}</dd>
              </div>
              <div>
                <dt>その他</dt>
                <dd>{formatBytes(usage.other)}</dd>
              </div>
              <div className="storage-total">
                <dt>合計</dt>
                <dd>{formatBytes(usage.total)}</dd>
              </div>
            </dl>
            <p>履歴はメモリ上の保持データ、ほかはブラウザ保存領域の概算です。</p>
          </div>
        </>
      )}
    </div>
  );
}
