import { Stack, Typography } from '@mui/material';
import type { LayerMeta } from '../../model';
import { MaskControls } from './MaskControls';

export function ClipControls({ meta }: { meta: LayerMeta }) {
  return (
    <Stack spacing={1.5}>
      <MaskControls meta={meta} mode="clip" />
      <Typography variant="caption" color="text.secondary">
        不透明度0%では無効、100%では対象範囲のアルファをマスクと乗算します。
      </Typography>
    </Stack>
  );
}
