import { Box, CircularProgress } from '@mui/material';
import { useLayoutEffect, useState } from 'react';
import { pagePixels } from '../engine/pageSpec';
import { useStore } from '../state/store';
import { useEngine } from './EngineContext';

export function fitPageSize(pageW: number, pageH: number, areaW: number, areaH: number) {
  const scale = Math.max(0.01, Math.min((areaW - 48) / pageW, (areaH - 48) / pageH));
  return { w: Math.round(pageW * scale), h: Math.round(pageH * scale) };
}

function PreviewImage({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState('');
  useLayoutEffect(() => {
    if (!blob) { setUrl(''); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? <Box component="img" src={url} alt="" sx={{ width: '100%', height: '100%', display: 'block' }} /> : null;
}

/** The destination preview covers the old page while it is still being saved. */
export function PageLoadingOverlay({ areaSize }: { areaSize: { w: number; h: number } }) {
  const busy = useStore(s => s.pageBusy);
  const page = useStore(s => s.loadingPage);
  const view = useEngine().view.snapshot();
  const pixels = page && pagePixels(page.spec);
  const size = pixels && fitPageSize(pixels.width, pixels.height, areaSize.w, areaSize.h);
  const center = { left: `calc(50% + ${view.x}px)`, top: `calc(50% + ${view.y}px)` };
  return <>
    {page && size && (
      <Box data-testid="page-loading-preview" data-page-id={page.id} aria-hidden="true"
        sx={{ position: 'absolute', inset: 0, zIndex: 8, background: 'radial-gradient(circle at 50% 40%, #22252c 0%, var(--bg) 75%)' }}>
        <Box sx={{
          position: 'absolute', ...center, width: size.w, height: size.h,
          transform: `translate(-50%, -50%) rotate(${view.rot}rad) scale(${view.scale})`,
          bgcolor: '#fff', boxShadow: '0 8px 40px rgba(0, 0, 0, 0.55)', borderRadius: '2px', overflow: 'hidden',
        }}>
          <PreviewImage key={page.id} blob={page.thumbnail} />
        </Box>
      </Box>
    )}
    <Box data-canvas-ui data-testid="page-loading-overlay" aria-hidden={!busy}
      sx={{
        position: 'absolute', inset: 0, zIndex: 10,
        bgcolor: 'rgba(0, 0, 0, 0.38)', color: '#fff',
        opacity: busy ? 1 : 0, visibility: busy ? 'visible' : 'hidden',
        pointerEvents: busy ? 'auto' : 'none',
        transition: busy ? 'none' : 'opacity 240ms ease-out, visibility 0s linear 240ms',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}>
      <Box data-testid="page-loading-center" style={{ position: 'absolute', ...center, transform: 'translate(-50%, -50%)', display: 'flex' }}>
        <CircularProgress color="inherit" aria-label="ページを読み込み中" />
      </Box>
    </Box>
  </>;
}
