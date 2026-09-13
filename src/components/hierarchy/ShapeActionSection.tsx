import { Button, Typography } from '@mui/material';
import type { LayerMeta } from '../../model';
import { useEngine } from '../EngineContext';
import { shapePanelNote } from '../../engine/shapes';

export function ShapeActionSection({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const note = meta.type === 'shape' ? shapePanelNote(meta.state.shape) : null;
  return (
    <>
      <Typography variant="caption" color="text.secondary">
        移動の端・中央、90°回転、多角形の頂点
      </Typography>
      {note && <Typography variant="caption" color="text.secondary">{note}</Typography>}
      <Button fullWidth onClick={() => engine.transferShapeLayer()} disabled={!meta.canTransferShape}>親へ転写</Button>
    </>
  );
}
