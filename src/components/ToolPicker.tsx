import type { ReactNode } from 'react';
import { engine } from '../engine/PaintEngine';
import { useStore } from '../state/store';
import type { ToolKind } from '../types';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const TOOL_ICONS: Record<ToolKind, ReactNode> = {
  pen: (
    <Icon>
      <path d="M4 20l1.2-4.2L15 6l3 3-9.8 9.8L4 20z" />
      <path d="M13.5 7.5l3 3" />
    </Icon>
  ),
  line: (
    <Icon>
      <path d="M4 20L20 4" />
    </Icon>
  ),
  rect: (
    <Icon>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </Icon>
  ),
  ellipse: (
    <Icon>
      <ellipse cx="12" cy="12" rx="8" ry="6" />
    </Icon>
  ),
  lasso: (
    <Icon>
      <ellipse cx="12" cy="9" rx="8" ry="5" strokeDasharray="3 2.4" />
      <path d="M7.5 13c-2 2-2.8 4.2-2 7" />
    </Icon>
  ),
  blur: (
    <Icon>
      <path d="M12 3.5c3.2 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 2.8-6.5 6-10.5z" />
      <path d="M9.5 14.5a2.8 2.8 0 0 0 2 2.6" />
    </Icon>
  ),
};

export function ToolPicker() {
  const tools = useStore((s) => s.tools);
  const activeId = useStore((s) => s.activeToolId);
  return (
    <div className="section">
      <div className="section-title">ツール</div>
      <div className="tool-grid">
        {tools.map((t) => (
          <div key={t.id} className="tool-cell">
            <button
              className={`tool-btn${activeId === t.id ? ' active' : ''}`}
              onClick={() => engine.selectToolInstance(t.id)}
              title={t.name}
            >
              {t.kind === 'lasso' ? null : (
                <span
                  className="tool-color-dot"
                  style={{
                    background:
                      t.color === 'transparent'
                        ? 'repeating-conic-gradient(#c9c9c9 0% 25%, #ffffff 0% 50%) 0 0 / 6px 6px'
                        : t.color,
                  }}
                />
              )}
              {TOOL_ICONS[t.kind]}
              <span>{t.name}</span>
            </button>
            {tools.length > 1 && (
              <button
                className="tool-remove"
                title={`${t.name} を削除`}
                onClick={() => engine.removeToolInstance(t.id)}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="hint">メニューの「ツールを追加」から増やせます</div>
    </div>
  );
}
