import { useEffect, useRef, useState } from 'react';
import { engine } from '../engine/PaintEngine';
import { useStore } from '../state/store';

function ViewChip() {
  const scale = useStore((s) => s.viewScale);
  const rot = useStore((s) => s.viewRot);
  const deg = Math.round((rot * 180) / Math.PI);
  const isDefault = Math.abs(scale - 1) < 0.005 && deg === 0;
  return (
    <button
      className="view-chip"
      onClick={() => engine.resetView()}
      disabled={isDefault}
      title="クリックで表示をリセット。2本指でパン/回転/拡縮、ホイールでパン、⌘+ホイールでズーム、Shift+ホイールで回転、Space+ドラッグでパン"
    >
      {Math.round(scale * 100)}%{deg !== 0 && ` / ${deg}°`}
    </button>
  );
}

export function CanvasView() {
  const areaRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const selectionActive = useStore((s) => s.selectionActive);
  const freeTransform = useStore((s) => s.freeTransform);
  const canvasW = useStore((s) => s.canvasW);
  const canvasH = useStore((s) => s.canvasH);

  useEffect(() => {
    const el = areaRef.current!;
    const refit = () => {
      const pad = 24;
      const bw = el.clientWidth - pad * 2;
      const bh = el.clientHeight - pad * 2;
      const scale = Math.max(0.01, Math.min(bw / canvasW, bh / canvasH));
      const w = Math.round(canvasW * scale);
      setSize({ w, h: Math.round(canvasH * scale) });
      engine.setFitWidth(w);
    };
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    refit();
    return () => ro.disconnect();
  }, [canvasW, canvasH]);

  useEffect(() => {
    engine.attach(mainRef.current!, overlayRef.current!, wrapRef.current!, areaRef.current!);
    return () => engine.detach();
  }, []);

  // width/height 属性の変更でキャンバスが消えるので再合成を要求する
  useEffect(() => {
    engine.requestRender();
  }, [canvasW, canvasH]);

  return (
    <div className="canvas-area" ref={areaRef}>
      <div
        className="artboard"
        ref={wrapRef}
        style={{ width: size.w, height: size.h }}
      >
        <canvas ref={mainRef} width={canvasW} height={canvasH} />
        <canvas ref={overlayRef} width={canvasW} height={canvasH} />
      </div>
      {selectionActive && (
        <div className="selection-toolbar">
          <button
            className={freeTransform ? 'toggled' : ''}
            title="角を個別に動かして変形"
            onClick={() => engine.setSelectionFreeTransform(!freeTransform)}
          >
            自由変形
          </button>
          <button onClick={() => engine.lassoDuplicate()}>複製</button>
          <button className="primary" onClick={() => engine.lassoCommit()}>
            確定
          </button>
          <button onClick={() => engine.lassoCancel()}>キャンセル</button>
        </div>
      )}
      <ViewChip />
    </div>
  );
}
