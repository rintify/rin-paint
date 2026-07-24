import { useStore } from '../state/store';
import { TRANSPARENT } from '../types';

export function PenSettings() {
  const penSize = useStore((s) => s.penSize);
  const penColor = useStore((s) => s.penColor);
  const kind = useStore((s) => s.tool);
  if (kind === 'lasso') return null;
  const d = Math.min(penSize, 32);
  const transparent = penColor === TRANSPARENT;
  return (
    <div className="section">
      <div className="section-title">{kind === 'blur' ? 'ぼかしの太さ' : 'ペンの太さ'}</div>
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
  );
}
