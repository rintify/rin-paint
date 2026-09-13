import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useEngine } from './EngineContext';
import { populateText } from '../engine/text/render';
import { replaceText, resizeTextBox, styleAt, textEditorFrameOrigin, type TextResizeCorner } from '../engine/text/model';
import { editorSelection, plainEditorText, restoreEditorSelection, useTextSession } from '../engine/text/session';
import { useStore } from '../state/store';
import type { TextParams } from '../types';
import { collectSnapLines, rotatedRectBounds, snapAngleToRightAngles, snapTranslation, type SnapLines } from '../engine/shapes/snap';

export function TextEditor({ fitScale }: { fitScale: number }) {
  const engine = useEngine();
  const layers = useStore(s => s.layers);
  const activeId = useStore(s => s.activeLayerId);
  const editingId = useStore(s => s.textEditingId);
  const ppi = useStore(s => s.pageSpec.ppi);
  const viewScale = useStore(s => s.viewScale);
  const found = layers.find(l => l.id === activeId);
  const layer = found?.type === 'text' ? found : undefined;
  const text = layer?.state.text;
  const editor = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const before = useRef<TextParams | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rendered = useRef('');
  const currentId = useRef(activeId);
  currentId.current = activeId;
  const [overflow, setOverflow] = useState(false);
  const [natural, setNatural] = useState({ id: '', width: 0, height: 0 });
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const drag = useRef<{
    pointerId: number;
    mode: 'move' | 'resize' | 'rotate';
    corner?: TextResizeCorner;
    x: number;
    y: number;
    width: number;
    height: number;
    before: TextParams;
    capture: HTMLElement;
    snapLines?: SnapLines;
  } | null>(null);
  const editing = editingId === activeId && !!text;

  const commit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const old = before.current;
    before.current = null;
    const now = engine.getText(currentId.current);
    if (old && now) engine.updateText(currentId.current, old, now);
  };
  const captureSelection = () => {
    if (!editor.current || !editing) return;
    const selection = editorSelection(editor.current);
    if (!selection) return;
    const session = useTextSession.getState();
    const current = engine.getText(activeId);
    if (!current) return;
    const moved = session.id !== activeId || session.start !== selection.start || session.end !== selection.end;
    session.set({ id: activeId, ...selection, ...(moved && selection.start === selection.end ? { typingStyle: styleAt(current, Math.max(0, selection.start - 1)) } : {}) });
  };
  const input = () => {
    const el = editor.current;
    const old = engine.getText(activeId);
    if (!el || !old) return;
    const content = plainEditorText(el);
    before.current ??= old;
    const next = replaceText(old, content, useTextSession.getState().typingStyle);
    const selection = editorSelection(el);
    if (selection) useTextSession.getState().set({ id: activeId, ...selection });
    rendered.current = composing.current ? JSON.stringify([next, ppi]) : '';
    engine.updateText(activeId, old, next, true);
    if (timer.current) clearTimeout(timer.current);
    if (!composing.current) timer.current = setTimeout(commit, 650);
  };
  const insertPlain = (value: string) => {
    if (!editor.current) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.current.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(value);
    range.insertNode(node); range.setStartAfter(node); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
    input();
  };

  const handlers = useRef({ commit, captureSelection });
  handlers.current = { commit, captureSelection };

  useEffect(() => {
    const flush = () => handlers.current.commit();
    const selection = () => handlers.current.captureSelection();
    engine.events.on('textCommitRequest', flush);
    document.addEventListener('selectionchange', selection);
    return () => {
      engine.events.off('textCommitRequest', flush);
      document.removeEventListener('selectionchange', selection);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useLayoutEffect(() => {
    // Keep the editable DOM intact while the frame is moving/resizing. Rebuilding it
    // on every pointermove caused focus jumps and visibly unstable box geometry.
    if (!editor.current || !text || !editing || composing.current || drag.current) return;
    const key = JSON.stringify([text, ppi]);
    if (key === rendered.current) return;
    const session = useTextSession.getState();
    const starting = session.id !== activeId;
    const selection = starting ? { start: text.content.length, end: text.content.length } : session;
    populateText(editor.current, text, ppi);
    rendered.current = key;
    if (starting) session.set({ id: activeId, start: selection.start, end: selection.end, typingStyle: styleAt(text, Math.max(0, selection.start - 1)), composing: false });
    if (starting || document.activeElement === editor.current) {
      editor.current.focus({ preventScroll: true });
      restoreEditorSelection(editor.current, selection.start, selection.end);
    }
    const nextNatural = { id: activeId, width: editor.current.offsetWidth, height: editor.current.offsetHeight };
    setNatural(current => current.id === nextNatural.id && current.width === nextNatural.width && current.height === nextNatural.height ? current : nextNatural);
    setOverflow(editor.current.scrollWidth > editor.current.clientWidth + 1 || editor.current.scrollHeight > editor.current.clientHeight + 1);
  }, [text, ppi, editing, activeId]);
  useEffect(() => {
    if (editing && editor.current) {
      const session = useTextSession.getState();
      rendered.current = '';
      populateText(editor.current, engine.getText(activeId)!, ppi);
      editor.current.focus({ preventScroll: true });
      restoreEditorSelection(editor.current, session.id === activeId ? session.start : text?.content.length ?? 0, session.id === activeId ? session.end : text?.content.length ?? 0);
    }
    if (!editing) useTextSession.getState().set({ id: null, composing: false });
  }, [editing, activeId]);

  if (!text || !layer?.visible) return null;
  const canvas = engine.getLayerCanvas(activeId);
  const measured = natural.id === activeId ? natural : { width: 0, height: 0 };
  const width = text.width ?? Math.max(30, measured.width || Number(canvas?.dataset.textWidth ?? 100));
  const height = text.height ?? Math.max(30, measured.height || Number(canvas?.dataset.textHeight ?? 60));
  const displayScale = Math.max(0.0001, fitScale * viewScale);
  const frameOrigin = textEditorFrameOrigin(
    text.x - engine.pageFrame.originX,
    text.y - engine.pageFrame.originY,
    width, height, fitScale,
  );
  const begin = (event: ReactPointerEvent<HTMLDivElement>, mode: 'move' | 'resize' | 'rotate', corner?: TextResizeCorner) => {
    if (composing.current) return;
    if (event.button !== 0) return;
    commit();
    event.preventDefault(); event.stopPropagation();
    const point = engine.view.clientToArt(event.clientX, event.clientY);
    const capture = event.currentTarget;
    drag.current = {
      pointerId: event.pointerId, mode, corner, x: point.x, y: point.y, width, height,
      before: structuredClone(text), capture,
      snapLines: mode === 'move' && layer.state.snapEnabled !== false
        ? collectSnapLines(engine.pageFrame, engine.visibleObjectBounds(activeId))
        : undefined,
    };
    setSnapGuides({ x: null, y: null });
    capture.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const p = engine.view.clientToArt(event.clientX, event.clientY);
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    let next: TextParams;
    if (d.mode === 'move') {
      if (d.snapLines) {
        const bounds = rotatedRectBounds({ x: d.before.x, y: d.before.y, w: d.width, h: d.height }, d.before.rotation ?? 0);
        const snapped = snapTranslation(bounds, dx, dy, d.snapLines, 8 * engine.uiScale());
        next = { ...d.before, x: d.before.x + snapped.dx, y: d.before.y + snapped.dy };
        setSnapGuides({ x: snapped.xGuide, y: snapped.yGuide });
      } else next = { ...d.before, x: d.before.x + dx, y: d.before.y + dy };
    } else if (d.mode === 'rotate') {
      const angle = Math.atan2(p.y - (d.before.y + d.height / 2), p.x - (d.before.x + d.width / 2)) + Math.PI / 2;
      next = { ...d.before, rotation: layer.state.snapEnabled !== false ? snapAngleToRightAngles(angle).angle : angle };
    } else {
      next = resizeTextBox(d.before, d.width, d.height, d.corner!, dx, dy);
    }
    engine.updateText(activeId, d.before, next, true);
  };
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    drag.current = null;
    setSnapGuides({ x: null, y: null });
    const next = engine.getText(activeId);
    if (next) engine.updateText(activeId, d.before, next);
    if (d.capture.hasPointerCapture(event.pointerId)) d.capture.releasePointerCapture(event.pointerId);
  };
  const resizeHandles: TextResizeCorner[] = ['nw', 'ne', 'sw', 'se'];
  return (
    <>
      {snapGuides.x !== null && <div className="text-snap-guide vertical" style={{ left: snapGuides.x * fitScale }} />}
      {snapGuides.y !== null && <div className="text-snap-guide horizontal" style={{ top: snapGuides.y * fitScale }} />}
      <div
      data-canvas-ui
      className={`text-frame${editing ? ' editing' : ''}`}
      style={{
        left: frameOrigin.left,
        top: frameOrigin.top,
        width,
        height,
        opacity: layer.opacity,
        transform: `scale(${fitScale}) rotate(${text.rotation ?? 0}rad)`,
        transformOrigin: 'center',
        '--text-handle-size': `${10 / displayScale}px`,
        '--text-hit-size': `${8 / displayScale}px`,
        '--text-outline-size': `${1.5 / displayScale}px`,
        '--text-ui-scale': 1 / displayScale,
      } as React.CSSProperties}
      onPointerDown={event => {
        if (editing || (event.target as HTMLElement).closest('.text-resize-handle, .text-move-edge')) return;
        begin(event, 'move');
      }}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={event => { event.stopPropagation(); engine.editTextLayer(activeId); }}
    >
      {editing && <div ref={editor} className="text-editor" contentEditable suppressContentEditableWarning spellCheck={false} role="textbox" aria-label="文字を編集" aria-multiline
        onInput={input} onPointerUp={captureSelection} onKeyUp={captureSelection}
        onCompositionStart={() => { composing.current = true; useTextSession.getState().set({ composing: true }); if (timer.current) clearTimeout(timer.current); }}
        onCompositionEnd={() => { composing.current = false; useTextSession.getState().set({ composing: false }); input(); commit(); }}
        onBeforeInput={event => {
          const type = (event.nativeEvent as InputEvent).inputType;
          if (type === 'insertParagraph' || type === 'insertLineBreak') { event.preventDefault(); insertPlain('\n'); }
          else if (type === 'historyUndo' || type === 'historyRedo') { event.preventDefault(); commit(); void (type === 'historyUndo' ? engine.undo() : engine.redo()).then(() => engine.editTextLayer(activeId)); }
        }}
        onPaste={event => { event.preventDefault(); insertPlain(event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')); }}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') { event.preventDefault(); insertPlain('\n'); }
          else if (event.key === 'Escape') { event.preventDefault(); engine.finishTextEditing(); }
          else if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
            event.preventDefault(); commit(); const redo = event.shiftKey || event.key.toLowerCase() === 'y';
            void (redo ? engine.redo() : engine.undo()).then(() => engine.editTextLayer(activeId));
          }
        }} />}
      {editing && ['top', 'right', 'bottom', 'left'].map(edge => (
        <div key={edge} className={`text-move-edge ${edge}`} title="文字枠を移動" onPointerDown={event => begin(event, 'move')} />
      ))}
      {resizeHandles.map(corner => (
        <div key={corner} className={`text-resize-handle ${corner}`} title="文字枠のサイズを変更" onPointerDown={event => begin(event, 'resize', corner)} />
      ))}
      {!editing && <div className="text-rotate-stem"><div className="text-rotate-handle" title="文字を回転" onPointerDown={event => begin(event, 'rotate')} /></div>}
      {overflow && editing && <div className="text-overflow-hint">枠からはみ出しています</div>}
      </div>
    </>
  );
}
