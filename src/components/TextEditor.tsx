import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useEngine } from './EngineContext';
import { populateText, styleTextRoot } from '../engine/text/render';
import { replaceText, resizeTextBox, styleAt, textEditorFrameOrigin, type TextResizeCorner } from '../engine/text/model';
import { editorSelection, plainEditorText, restoreEditorSelection, useTextSession } from '../engine/text/session';
import { useStore } from '../state/store';
import type { TextParams } from '../types';
import { collectSnapLines, rotatedRectBounds, snapAngleToRightAngles, snapTranslation, type SnapLines } from '../engine/shapes/snap';

// Frame changes only need CSS layout; glyph nodes and the selection can stay intact.
function textDomKey(text: TextParams, ppi: number): string {
  return JSON.stringify([text.content, text.style, text.ranges, text.ruby, ppi]);
}

export function TextEditor({ fitScale }: { fitScale: number }) {
  const engine = useEngine();
  const layers = useStore(s => s.layers);
  const activeId = useStore(s => s.activeLayerId);
  const editingId = useStore(s => s.textEditingId);
  const gizmosEnabled = useStore(s => !s.tool);
  const ppi = useStore(s => s.pageSpec.ppi);
  const viewScale = useStore(s => s.viewScale);
  const found = layers.find(l => l.id === activeId);
  const layer = found?.type === 'text' ? found : undefined;
  const [resizePreview, setResizePreview] = useState<{ id: string; text: TextParams } | null>(null);
  const text = resizePreview?.id === activeId ? resizePreview.text : layer?.state.text;
  const releasePreview = useRef<(() => void) | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const before = useRef<TextParams | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rendered = useRef('');
  const renderedEditor = useRef<HTMLDivElement | null>(null);
  const inputFrame = useRef(0);
  const pendingInput = useRef<{ id: string; before: TextParams; after: TextParams } | null>(null);
  const flushInput = () => {
    if (inputFrame.current) cancelAnimationFrame(inputFrame.current);
    inputFrame.current = 0;
    const pending = pendingInput.current;
    pendingInput.current = null;
    if (pending) engine.updateText(pending.id, pending.before, pending.after, true);
  };
  const moveFrame = useRef(0);
  const pendingMove = useRef<(() => void) | null>(null);
  const flushMove = () => {
    if (moveFrame.current) cancelAnimationFrame(moveFrame.current);
    moveFrame.current = 0;
    const apply = pendingMove.current;
    pendingMove.current = null;
    apply?.();
  };
  const currentId = useRef(activeId);
  currentId.current = activeId;
  const [natural, setNatural] = useState({ id: '', width: 0, height: 0 });
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const drag = useRef<{
    id: string;
    pointerId: number;
    mode: 'move' | 'resize' | 'rotate';
    corner?: TextResizeCorner;
    x: number;
    y: number;
    width: number;
    height: number;
    before: TextParams;
    after?: TextParams;
    capture: HTMLElement;
    snapLines?: SnapLines;
  } | null>(null);
  const editing = editingId === activeId && !!text;

  const commit = () => {
    flushInput();
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
    const current = pendingInput.current?.after ?? engine.getText(activeId);
    if (!current) return;
    const moved = session.id !== activeId || session.start !== selection.start || session.end !== selection.end;
    session.set({ id: activeId, ...selection, ...(moved && selection.start === selection.end ? { typingStyle: styleAt(current, Math.max(0, selection.start - 1)) } : {}) });
  };
  const input = (rebuild = false) => {
    const el = editor.current;
    const old = pendingInput.current?.after ?? engine.getText(activeId);
    if (!el || !old) return;
    const content = plainEditorText(el);
    before.current ??= old;
    const typingStyle = useTextSession.getState().typingStyle;
    const next = replaceText(old, content, typingStyle);
    const selection = editorSelection(el);
    if (selection) useTextSession.getState().set({ id: activeId, ...selection });
    const uniform = [old.style, ...old.ranges].every(style =>
      style.fontId === typingStyle.fontId && style.sizePt === typingStyle.sizePt && style.color === typingStyle.color);
    // Native input already updated these nodes. Preserve them on the common typing path.
    rendered.current = composing.current || (!rebuild && rendered.current !== '' && uniform && !old.ruby.length)
      ? textDomKey(next, ppi) : '';
    pendingInput.current = { id: activeId, before: pendingInput.current?.before ?? old, after: next };
    if (!inputFrame.current) inputFrame.current = requestAnimationFrame(flushInput);
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
    input(true);
  };

  const handlers = useRef<{ commit: () => void; captureSelection: () => void; finishDrag?: () => void }>({ commit, captureSelection });
  handlers.current = { commit, captureSelection };

  useEffect(() => {
    const flush = () => { handlers.current.commit(); handlers.current.finishDrag?.(); };
    const selection = () => handlers.current.captureSelection();
    engine.events.on('textCommitRequest', flush);
    document.addEventListener('selectionchange', selection);
    return () => {
      engine.events.off('textCommitRequest', flush);
      document.removeEventListener('selectionchange', selection);
      if (timer.current) clearTimeout(timer.current);
      flushInput();
      handlers.current.finishDrag?.();
      if (moveFrame.current) cancelAnimationFrame(moveFrame.current);
      moveFrame.current = 0;
      pendingMove.current = null;
      releasePreview.current?.();
      releasePreview.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    if (!editing && !resizePreview) { rendered.current = ''; return; }
    if (!editor.current || !text || composing.current) return;
    if (renderedEditor.current !== editor.current) {
      renderedEditor.current = editor.current;
      rendered.current = '';
    }
    // Resize leaves glyphs and formatting untouched; update only the frame's CSS.
    if (drag.current?.mode === 'resize' && rendered.current) {
      editor.current.style.width = text.width === null ? 'max-content' : `${text.width}px`;
      editor.current.style.height = text.height === null ? 'max-content' : `${text.height}px`;
      editor.current.style.overflow = text.width === null && text.height === null ? 'visible' : 'hidden';
      return;
    }
    styleTextRoot(editor.current, text, ppi);
    const measure = () => {
      const nextNatural = { id: activeId, width: text.width ?? editor.current!.offsetWidth, height: text.height ?? editor.current!.offsetHeight };
      setNatural(current => current.id === nextNatural.id && current.width === nextNatural.width && current.height === nextNatural.height ? current : nextNatural);
    };
    const key = textDomKey(text, ppi);
    if (key === rendered.current) { measure(); return; }
    const session = useTextSession.getState();
    const starting = session.id !== activeId;
    const selection = starting ? { start: text.content.length, end: text.content.length } : session;
    populateText(editor.current, text, ppi);
    rendered.current = key;
    measure();
    if (!editing) return;
    if (starting) session.set({ id: activeId, start: selection.start, end: selection.end, typingStyle: styleAt(text, Math.max(0, selection.start - 1)), composing: false });
    if (starting || document.activeElement === editor.current) {
      editor.current.focus({ preventScroll: true });
      restoreEditorSelection(editor.current, selection.start, selection.end);
    }
  }, [text, ppi, editing, activeId, !!resizePreview]);
  useEffect(() => {
    if (!editing) useTextSession.getState().set({ id: null, composing: false });
  }, [editing, activeId]);

  if (!text || !layer?.visible) return null;
  const canvas = engine.getLayerCanvas(activeId);
  const measured = natural.id === activeId ? natural : { width: 0, height: 0 };
  const width = text.width ?? Math.max(30, measured.width || Number(canvas?.dataset.textWidth ?? 100));
  const height = text.height ?? Math.max(30, measured.height || Number(canvas?.dataset.textHeight ?? 60));
  const displayScale = Math.max(0.0001, fitScale * viewScale);
  const frameOrigin = textEditorFrameOrigin(text.x, text.y, width, height, fitScale);
  const begin = (event: ReactPointerEvent<HTMLDivElement>, mode: 'move' | 'resize' | 'rotate', corner?: TextResizeCorner) => {
    if (!gizmosEnabled || composing.current) return;
    if (event.button !== 0) return;
    commit();
    event.preventDefault(); event.stopPropagation();
    const point = engine.view.clientToArt(event.clientX, event.clientY);
    const capture = event.currentTarget;
    drag.current = {
      id: activeId, pointerId: event.pointerId, mode, corner, x: point.x, y: point.y, width, height,
      before: structuredClone(text), capture,
      snapLines: mode === 'move' && layer.state.snapEnabled !== false
        ? collectSnapLines(engine.artboard, engine.visibleObjectBounds(activeId))
        : undefined,
    };
    releasePreview.current?.();
    releasePreview.current = null;
    if (mode === 'resize') {
      releasePreview.current = engine.beginTextPreview(activeId);
      setResizePreview({ id: activeId, text });
    } else setResizePreview(null);
    setSnapGuides({ x: null, y: null });
    capture.setPointerCapture(event.pointerId);
  };
  const applyMove = (pointerId: number, clientX: number, clientY: number) => {
    const d = drag.current;
    if (!d || d.pointerId !== pointerId) return;
    const p = engine.view.clientToArt(clientX, clientY);
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
    if (d.mode === 'resize') {
      d.after = next;
      setResizePreview({ id: activeId, text: next });
    } else engine.updateText(activeId, d.before, next, true);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const { pointerId, clientX, clientY } = event;
    pendingMove.current = () => applyMove(pointerId, clientX, clientY);
    if (!moveFrame.current) moveFrame.current = requestAnimationFrame(flushMove);
  };
  const finishDrag = () => {
    const d = drag.current;
    if (!d) return;
    flushMove();
    drag.current = null;
    setSnapGuides({ x: null, y: null });
    const next = d.after ?? engine.getText(d.id);
    if (next) engine.updateText(d.id, d.before, next);
    if (d.mode === 'resize') {
      const release = releasePreview.current;
      const clear = () => {
        release?.();
        if (releasePreview.current !== release) return;
        releasePreview.current = null;
        setResizePreview(null);
      };
      // The editor remains visible when editing. Otherwise keep the final DOM
      // frame until the committed bitmap is ready, without flashing the old size.
      if (editing) clear();
      else void engine.readyToRender().catch(() => {
        useStore.getState().set({ toolNotice: '文字の描画に失敗しました。フォントまたは文字枠を確認してください。' });
      }).finally(clear);
    }
    if (d.capture.hasPointerCapture(d.pointerId)) d.capture.releasePointerCapture(d.pointerId);
  };
  handlers.current.finishDrag = finishDrag;
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) finishDrag();
  };
  const resizeHandles: TextResizeCorner[] = ['nw', 'ne', 'sw', 'se'];
  return (
    <>
      {snapGuides.x !== null && <div className="text-snap-guide vertical" style={{ left: snapGuides.x * fitScale }} />}
      {snapGuides.y !== null && <div className="text-snap-guide horizontal" style={{ top: snapGuides.y * fitScale }} />}
      <div
      data-canvas-ui
      className={`text-frame${editing ? ' editing' : ''}${gizmosEnabled ? '' : ' gizmo-locked'}`}
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
        if (!gizmosEnabled || editing || (event.target as HTMLElement).closest('.text-resize-handle, .text-move-edge')) return;
        begin(event, 'move');
      }}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={event => { event.stopPropagation(); engine.editTextLayer(activeId); }}
    >
      {(editing || resizePreview?.id === activeId) && <div ref={editor} className="text-editor" aria-hidden={!editing} contentEditable={editing} suppressContentEditableWarning spellCheck={false} role="textbox" aria-label="文字を編集" aria-multiline
        onInput={() => input()} onPointerUp={captureSelection} onKeyUp={captureSelection}
        onCompositionStart={() => { composing.current = true; useTextSession.getState().set({ composing: true }); if (timer.current) clearTimeout(timer.current); }}
        onCompositionEnd={() => { composing.current = false; useTextSession.getState().set({ composing: false }); input(true); commit(); }}
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
      {gizmosEnabled && editing && ['top', 'right', 'bottom', 'left'].map(edge => (
        <div key={edge} className={`text-move-edge ${edge}`} title="文字枠を移動" onPointerDown={event => begin(event, 'move')} />
      ))}
      {gizmosEnabled && resizeHandles.map(corner => (
        <div key={corner} className={`text-resize-handle ${corner}`} title="文字枠のサイズを変更" onPointerDown={event => begin(event, 'resize', corner)} />
      ))}
      {gizmosEnabled && !editing && <div className="text-rotate-stem"><div className="text-rotate-handle" title="文字を回転" onPointerDown={event => begin(event, 'rotate')} /></div>}
      </div>
    </>
  );
}
