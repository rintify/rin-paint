import { TransformLayerControls } from './TransformLayerControls';
import { Box, Button, Chip, LinearProgress, Paper, Snackbar, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useEngine } from './EngineContext';
import { canTransformObjectType } from '../engine/layer-types/registry';
import { useStore } from '../state/store';
import { appAlert } from './AppDialogs';
import { TextEditor } from './TextEditor';

function ViewChip() {
  const engine = useEngine();
  const scale = useStore((s) => s.viewScale);
  const rot = useStore((s) => s.viewRot);
  const deg = Math.round((rot * 180) / Math.PI);
  const isDefault = Math.abs(scale - 1) < 0.005 && deg === 0;
  return (
    <Chip
      label={`${Math.round(scale * 100)}%${deg !== 0 ? ` / ${deg}°` : ''}`}
      onClick={() => engine.resetView()}
      disabled={isDefault}
      size="small"
      sx={{
        position: 'absolute',
        right: 14,
        bottom: 14,
        zIndex: 5,
        fontVariantNumeric: 'tabular-nums',
        bgcolor: 'background.paper',
        opacity: isDefault ? 0.55 : 0.92,
      }}
      title="クリックで表示をリセット。2本指でパン/回転/拡縮、ホイールでパン、⌘+ホイールでズーム、Shift+ホイールで回転、Space+ドラッグでパン"
    />
  );
}

export function PageView() {
  const engine = useEngine();
  const areaRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dropActive, setDropActive] = useState(false);
  const selectionActive = useStore((s) => s.selectionActive);
  const freeTransform = useStore((s) => s.freeTransform);
  const objectSelected = useStore((s) => s.selectedLayerIds.some(id => { const layer = s.layers.find(item => item.id === id); return !!layer && canTransformObjectType(layer.type); }));
  const pageW = useStore((s) => s.pageW);
  const pageH = useStore((s) => s.pageH);
  const polygonDraftActive = useStore((s) => s.polygonDraftActive);
  const polygonDraftPointCount = useStore((s) => s.polygonDraftPointCount);
  const bubbleDraftActive = useStore((s) => s.bubbleDraftActive);
  const shapeHandleSelected = useStore((s) => s.shapeHandleSelected);
  const shapeHandleCanDelete = useStore((s) => s.shapeHandleCanDelete);
  const shapeHandleIsVertex = useStore((s) => s.shapeHandleIsVertex);
  const shapeHandleEdgeConstrained = useStore((s) => s.shapeHandleEdgeConstrained);
  const fillProgress = useStore((s) => s.fillProgress);
  const toolNotice = useStore((s) => s.toolNotice);

  useEffect(() => {
    const el = areaRef.current!;
    const refit = () => {
      const pad = 24;
      const bw = el.clientWidth - pad * 2;
      const bh = el.clientHeight - pad * 2;
      const scale = Math.max(0.01, Math.min(bw / pageW, bh / pageH));
      const w = Math.round(pageW * scale);
      setSize({ w, h: Math.round(pageH * scale) });
      engine.setFitWidth(w);
    };
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    refit();
    return () => ro.disconnect();
  }, [pageW, pageH]);

  useEffect(() => {
    engine.attach(mainRef.current!, overlayRef.current!, wrapRef.current!, areaRef.current!);
    return () => engine.detach();
  }, []);

  useEffect(() => {
    engine.requestRender();
  }, [pageW, pageH]);

  useEffect(() => {
    engine.requestOverlayRender();
  }, [size.w, size.h]);

  return (
    <Box
      className={`canvas-area${dropActive ? ' image-drop-active' : ''}`}
      ref={areaRef}
      onDragEnter={(event) => {
        if ([...event.dataTransfer.items].some((item) => item.kind === 'file')) {
          event.preventDefault();
          setDropActive(true);
        }
      }}
      onDragOver={(event) => {
        if ([...event.dataTransfer.items].some((item) => item.kind === 'file')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
        const file = [...event.dataTransfer.files].find(item => !item.type || item.type.startsWith('image/'));
        void (async () => {
          if (!file || !await engine.placeDroppedImage(file, event.clientX, event.clientY)) {
            await appAlert('画像ファイルをドロップしてください');
          }
        })();
      }}
    >
      <Box
        className="artboard"
        ref={wrapRef}
        style={{ width: size.w, height: size.h }}
      >
        <canvas ref={mainRef} width={pageW} height={pageH} />
        <TextEditor fitScale={size.w / pageW} />
      </Box>
      <canvas ref={overlayRef} className="canvas-overlay" aria-hidden="true" />
      {selectionActive && (
        <Paper
          elevation={6}
          sx={{
            position: 'absolute',
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 1,
            p: 1,
            borderRadius: 1.5,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            zIndex: 6,
          }}
        >
          <Button
            variant={freeTransform ? 'contained' : 'outlined'}
            disabled={objectSelected}
            title={objectSelected ? '図形・文字を含む選択では自由変形を使用できません' : '角を個別に動かして変形'}
            onClick={() => engine.setSelectionFreeTransform(!freeTransform)}
          >
            自由変形
          </Button>
          <Button onClick={() => engine.duplicateFloatSelection()}>複製</Button>
          <Button variant="contained" onClick={() => engine.commitFloatSelection()}>
            確定
          </Button>
          <Button onClick={() => engine.cancelFloatSelection()}>キャンセル</Button>
        </Paper>
      )}
      <TransformLayerControls />
      {polygonDraftActive && (
        <Paper elevation={6} data-canvas-ui sx={{ position: 'absolute', bottom: 22, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 1, p: 1, zIndex: 6 }}>
          <Button disabled={polygonDraftPointCount === 0} onClick={() => engine.polygonUndoPoint()}>1点戻す</Button>
          <Button variant="contained" disabled={polygonDraftPointCount < 3} onClick={() => engine.polygonCommit()}>確定</Button>
          <Button onClick={() => engine.polygonCancel()}>キャンセル</Button>
        </Paper>
      )}
      {bubbleDraftActive && (
        <Paper elevation={6} data-canvas-ui sx={{ position: 'absolute', bottom: 22, left: '50%', transform: 'translateX(-50%)', p: 1, display: 'flex', alignItems: 'center', gap: 1, zIndex: 6 }}>
          <Typography variant="caption">しっぽの先端をクリック</Typography>
          <Button onClick={() => engine.cancelSessions()}>キャンセル</Button>
        </Paper>
      )}
      {!polygonDraftActive && shapeHandleSelected && (
        <Paper elevation={6} data-canvas-ui sx={{ position: 'absolute', bottom: 22, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 1, p: 1, zIndex: 6 }}>
          <Button
            aria-pressed={shapeHandleEdgeConstrained}
            variant={shapeHandleEdgeConstrained ? 'contained' : 'outlined'}
            onClick={() => engine.setShapeHandleEdgeConstrained(!shapeHandleEdgeConstrained)}
          >
            辺に沿う
          </Button>
          {shapeHandleIsVertex && <Button disabled={!shapeHandleCanDelete} onClick={() => engine.deleteSelectedShapeVertex()}>頂点を削除</Button>}
        </Paper>
      )}
      {fillProgress !== null && (
        <Paper elevation={6} data-canvas-ui sx={{ position: 'absolute', bottom: 22, left: '50%', transform: 'translateX(-50%)', width: 260, p: 1.25, zIndex: 7 }}>
          <Typography variant="caption">塗り範囲を計算中…</Typography>
          <LinearProgress variant="determinate" value={fillProgress * 100} sx={{ my: .75 }} />
          <Button size="small" onClick={() => engine.cancelFill()}>キャンセル</Button>
        </Paper>
      )}
      {dropActive && <Box className="image-drop-hint">画像を配置</Box>}
      <ViewChip />
      <Snackbar
        open={!!toolNotice}
        message={toolNotice ?? ''}
        autoHideDuration={3500}
        onClose={() => useStore.getState().set({ toolNotice: null })}
      />
    </Box>
  );
}
