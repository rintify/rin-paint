import { RasterTransferSection } from './RasterTransferSection';
import { Button, Stack } from '@mui/material';
import type { LayerMeta } from '../../model';
import { useEngine } from '../EngineContext';
import { pickFile } from '../hooks/pickFile';
import { canvasFromImageFile } from '../../engine/image/load';
import { appAlert } from '../AppDialogs';

export function ImageActionSection({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  return (
    <Stack spacing={1}>
      <Button
        fullWidth
        onClick={() => {
          void pickFile('image/*').then(async file => {
            if (!file) return;
            const canvas = await canvasFromImageFile(file);
            if (!canvas) {
              await appAlert('画像ファイルを選択してください');
              return;
            }
            engine.replaceImageContent(meta.id, canvas);
          });
        }}
      >
        画像を差し替え
      </Button>
      <RasterTransferSection meta={meta} />
    </Stack>
  );
}
