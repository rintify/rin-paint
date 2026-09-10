import { useStore } from '../state/store';
import { TRANSPARENT } from '../types';

export function ColorControls() {
  const penColor = useStore((s) => s.penColor);
  const colorHistory = useStore((s) => s.colorHistory);
  const kind = useStore((s) => s.tool);
  const set = useStore((s) => s.setPenColor);
  if (kind === 'lasso' || kind === 'blur') return null;
  const transparent = penColor === TRANSPARENT;
  return (
    <div className="section">
      <div className="section-title">色</div>
      <div className="color-row">
        <input
          type="color"
          className={transparent ? 'inactive' : ''}
          value={transparent ? '#ffffff' : penColor}
          onChange={(e) => set(e.target.value)}
        />
        <button
          className={`transparent-btn checker${transparent ? ' active' : ''}`}
          title="透明 (描いた場所を消す)"
          onClick={() => set(TRANSPARENT)}
        />
        <span className="color-hex">{transparent ? '透明' : penColor}</span>
      </div>
      <div className="swatches">
        {colorHistory.map((c) => (
          <button
            key={c}
            className={`swatch${c === penColor ? ' active' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => set(c)}
          />
        ))}
      </div>
      <div className="hint">
        同じ位置付近を0.5秒長押しでスポイト (アクティブレイヤーの色を拾います)
      </div>
    </div>
  );
}
