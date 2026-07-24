import { useState } from 'react';
import { engine } from '../engine/PaintEngine';
import { useStore } from '../state/store';

export function HistoryControls() {
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const branches = useStore((s) => s.redoBranches);
  const [pickerOpen, setPickerOpen] = useState(false);

  const onRedo = () => {
    // 分岐点では押した時にだけどちらへ進むか聞く
    if (branches.length > 1) {
      setPickerOpen((o) => !o);
      return;
    }
    void engine.redo();
  };

  return (
    <div className="history-controls">
      <button
        disabled={!canUndo}
        onClick={() => {
          setPickerOpen(false);
          void engine.undo();
        }}
        title="戻る (Cmd+Z)"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
        </svg>
      </button>
      <button
        disabled={!canRedo}
        onClick={onRedo}
        className={branches.length > 1 ? 'has-branches' : ''}
        title={branches.length > 1 ? '進む (分岐あり)' : '進む (Cmd+Shift+Z)'}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 14l5-5-5-5" />
          <path d="M20 9H10a6 6 0 0 0 0 12h3" />
        </svg>
        {branches.length > 1 && <span className="branch-dot" />}
      </button>
      {pickerOpen && branches.length > 1 && (
        <>
          <div className="menu-backdrop" onClick={() => setPickerOpen(false)} />
          <div className="branch-picker" title="やり直しの分岐">
            <div className="branch-picker-title">どちらへ進む？</div>
            {branches.map((b) => (
              <button
                key={b.index}
                onClick={() => {
                  setPickerOpen(false);
                  void engine.redo(b.index);
                }}
              >
                {b.index + 1}. {b.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
