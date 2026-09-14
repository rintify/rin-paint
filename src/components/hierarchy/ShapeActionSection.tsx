import { RasterTransferSection } from './RasterTransferSection';
import { Typography } from '@mui/material';
import type { LayerMeta } from '../../model';
import { shapePanelNote } from '../../engine/shapes';

export function ShapeActionSection({ meta }: { meta: LayerMeta }) {
  const note = meta.type === 'shape' ? shapePanelNote(meta.state.shape) : null;
  return (
    <>
      <Typography variant="caption" color="text.secondary">
        移動の端・中央、90°回転、多角形の頂点
      </Typography>
      {note && <Typography variant="caption" color="text.secondary">{note}</Typography>}
      <RasterTransferSection meta={meta} />
    </>
  );
}
