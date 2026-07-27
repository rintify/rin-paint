import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import {
  normalizePenDetailSettings,
  TRANSPARENT,
  type PenDetailSettings,
} from '../types';

export function PenSettings() {
  const penSize = useStore((s) => s.penSize);
  const penColor = useStore((s) => s.penColor);
  const kind = useStore((s) => s.tool);
  const activeTool = useStore((s) =>
    s.tools.find((tool) => tool.id === s.activeToolId),
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    if (!detailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detailsOpen]);

  if (kind === 'lasso') return null;
  const d = Math.min(penSize, 32);
  const transparent = penColor === TRANSPARENT;
  const penDetails = normalizePenDetailSettings(activeTool?.penSettings);
  const setDetail = (key: keyof PenDetailSettings, value: number) =>
    useStore.getState().setPenDetail(key, value);

  return (
    <>
      <div className="section">
        <div className="section-title-row">
          <div className="section-title">
            {kind === 'blur' ? 'ぼかしの太さ' : 'ペンの太さ'}
          </div>
          {kind === 'pen' && (
            <button
              className="compact-btn"
              onClick={() => setDetailsOpen(true)}
            >
              詳細設定…
            </button>
          )}
        </div>
        <div className="pen-row">
          <div className="pen-preview">
            <span
              className={transparent && kind !== 'blur' ? 'checker' : ''}
              style={{
                width: d,
                height: d,
                background:
                  kind === 'blur' ? '#9db3d4' : transparent ? undefined : penColor,
                filter: kind === 'blur' ? 'blur(3px)' : undefined,
              }}
            />
          </div>
          <input
            type="range"
            min={1}
            max={128}
            value={penSize}
            onChange={(e) => useStore.getState().setPenSize(Number(e.target.value))}
          />
          <span className="num">{penSize}</span>
        </div>
      </div>
      {detailsOpen && kind === 'pen' && (
        <>
          <div
            className="dialog-backdrop"
            onClick={() => setDetailsOpen(false)}
          />
          <div
            className="dialog pen-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="ペンの詳細設定"
          >
            <div className="dialog-title">ペンの詳細設定</div>
            <DetailSlider
              label="筆圧ブレ補正"
              value={penDetails.pressureStabilization}
              onChange={(value) => setDetail('pressureStabilization', value)}
            />
            <div className="hint">
              値を上げるほど筆圧の急な変化をなめらかにします。
            </div>
            <DetailSlider
              label="入り"
              value={penDetails.taperIn}
              onChange={(value) => setDetail('taperIn', value)}
            />
            <DetailSlider
              label="抜き"
              value={penDetails.taperOut}
              onChange={(value) => setDetail('taperOut', value)}
            />
            <div className="hint">
              値を上げるほど線の始端・終端が長く細くなります。0で無効です。
            </div>
            <div className="dialog-actions">
              <button className="primary" onClick={() => setDetailsOpen(false)}>
                完了
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function DetailSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="detail-slider-row">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="num">{value}</span>
    </label>
  );
}
