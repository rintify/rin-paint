import { useEffect, useState, type ReactNode } from 'react';
import { engine } from '../engine/PaintEngine';
import { useStore } from '../state/store';
import { TOOL_KIND_LABELS, type ToolKind } from '../types';

function Icon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

export const TOOL_ICONS: Record<ToolKind, ReactNode> = {
  pen: <Icon><path d="M4 20l1.2-4.2L15 6l3 3-9.8 9.8L4 20z" /><path d="M13.5 7.5l3 3" /></Icon>,
  line: <Icon><path d="M4 20L20 4" /></Icon>,
  rect: <Icon><rect x="4" y="6" width="16" height="12" rx="1" /></Icon>,
  ellipse: <Icon><ellipse cx="12" cy="12" rx="8" ry="6" /></Icon>,
  lasso: <Icon><ellipse cx="12" cy="9" rx="8" ry="5" strokeDasharray="3 2.4" /><path d="M7.5 13c-2 2-2.8 4.2-2 7" /></Icon>,
  blur: <Icon><path d="M12 3.5c3.2 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 2.8-6.5 6-10.5z" /><path d="M9.5 14.5a2.8 2.8 0 0 0 2 2.6" /></Icon>,
};

function AddToolDialog({ onClose }: { onClose: () => void }) {
  const [shapePage, setShapePage] = useState(false);
  const add = (kind: ToolKind) => { engine.addToolInstance(kind); onClose(); };
  return <><div className="dialog-backdrop dialog-backdrop-top" onClick={onClose} /><div className="dialog tool-add-dialog" role="dialog" aria-modal="true" aria-label="ツールを追加">
    <div className="dialog-title">ツールを追加</div>
    <div className={`tool-add-slider${shapePage ? ' shape-page' : ''}`}>
      <div className="tool-add-page">
        <button onClick={() => add('pen')}>{TOOL_ICONS.pen}<span>ペン</span></button>
        <button onClick={() => setShapePage(true)}>{TOOL_ICONS.rect}<span>図形</span><b>›</b></button>
        <button onClick={() => add('lasso')}>{TOOL_ICONS.lasso}<span>選択</span></button>
        <button onClick={() => add('blur')}>{TOOL_ICONS.blur}<span>ぼかし</span></button>
      </div>
      <div className="tool-add-page">
        <button className="tool-add-back" onClick={() => setShapePage(false)}>‹ 戻る</button>
        {(['line', 'rect', 'ellipse'] as ToolKind[]).map((kind) => <button key={kind} onClick={() => add(kind)}>{TOOL_ICONS[kind]}<span>{TOOL_KIND_LABELS[kind]}</span></button>)}
      </div>
    </div>
    <div className="dialog-actions"><button onClick={onClose}>キャンセル</button></div>
  </div></>;
}

function ManageToolsDialog({ onClose }: { onClose: () => void }) {
  const tools = useStore((s) => s.tools);
  const [addOpen, setAddOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') addOpen ? setAddOpen(false) : onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [addOpen, onClose]);
  return <><div className="dialog-backdrop" onClick={onClose} /><div className="dialog tool-manage-dialog" role="dialog" aria-modal="true" aria-label="ツールを管理">
    <div className="dialog-title">ツールを管理</div>
    <div className="tool-manage-list">{tools.map((tool, index) => <div className="tool-manage-row" key={tool.id} draggable onDragStart={() => setDragIndex(index)} onDragEnd={() => setDragIndex(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) engine.reorderToolInstance(dragIndex, index); setDragIndex(null); }}>
      <span className="drag-grip">⠿</span>{TOOL_ICONS[tool.kind]}<span>{tool.name}</span><button className="tool-trash" disabled={tools.length <= 1} title={`${tool.name}を削除`} onClick={() => engine.removeToolInstance(tool.id)}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></button>
    </div>)}</div>
    <button onClick={() => setAddOpen(true)}>＋ ツールを追加…</button>
    <div className="dialog-actions"><button className="primary" onClick={onClose}>完了</button></div>
  </div>{addOpen && <AddToolDialog onClose={() => setAddOpen(false)} />}</>;
}

export function ToolPicker() {
  const tools = useStore((s) => s.tools);
  const activeId = useStore((s) => s.activeToolId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  return <div className="section">
    <div className="section-title-row tool-title-row"><div className="section-title">ツール</div><div className="tool-settings-wrap"><button className="compact-icon-btn" title="ツール設定" onClick={() => setMenuOpen(!menuOpen)}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.6-.7-1.7 1-1.8-2.1-2.1-1.8 1-1.7-.7L10.5 2h-3l-.6 2-1.7.7-1.8-1-2.1 2.1 1 1.8-.7 1.7-2 .6v3l2 .6.7 1.7-1 1.8 2.1 2.1 1.8-1 1.7.7.6 2h3l.6-2 1.7-.7 1.8 1 2.1-2.1-1-1.8.7-1.7z" transform="translate(2.5 0) scale(.8 1)" /></svg></button>
      {menuOpen && <><div className="menu-backdrop" onClick={() => setMenuOpen(false)} /><div className="tool-settings-pop"><button onClick={() => { setMenuOpen(false); setManageOpen(true); }}>ツールを管理…</button></div></>}
    </div></div>
    <div className="tool-grid">{tools.map((tool) => <div key={tool.id} className="tool-cell"><button className={`tool-btn${activeId === tool.id ? ' active' : ''}`} onClick={() => engine.selectToolInstance(tool.id)} title={tool.name}>{tool.kind === 'lasso' ? null : <span className="tool-color-dot" style={{ background: tool.color === 'transparent' ? 'repeating-conic-gradient(#c9c9c9 0% 25%, #fff 0% 50%) 0 0 / 6px 6px' : tool.color }} />}{TOOL_ICONS[tool.kind]}<span>{tool.name}</span></button></div>)}</div>
    {manageOpen && <ManageToolsDialog onClose={() => setManageOpen(false)} />}
  </div>;
}
