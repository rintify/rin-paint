import { Button, Stack, Switch, Typography } from '@mui/material';
import { useEngine } from '../EngineContext';
import { CanvasMmField } from '../CanvasMmField';
import { NumericField } from '../NumericField';
import { LabeledControl } from '../inspectorLayout';
import type { LayerMeta } from '../../model';
import { layerParameterDescriptors, parameterSemanticId } from '../../engine/layerParameters';
import { ParameterLinkIndicator } from './ParameterLinkIndicator';
import { linkedParameterColor } from './parameterLinkUi';
import { pickFile } from '../hooks/pickFile';
import { canvasFromImageFile } from '../../engine/image/load';
import { appAlert } from '../AppDialogs';

export function ImageControls({ meta }: { meta: LayerMeta }) {
  const engine = useEngine();
  const descriptors = layerParameterDescriptors(meta).filter(item => !item.semanticId?.startsWith('layer.'));
  return (
    <Stack spacing={1.5} sx={{ pt: 0.5 }}>
      <Stack spacing={0.75}>
        <LabeledControl label="スナップ" color={linkedParameterColor(meta, 'interaction.snap')}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Switch
              checked={meta.snapEnabled !== false}
              onChange={event => engine.commitLayerProps(
                meta.id,
                { snapEnabled: meta.snapEnabled !== false },
                { snapEnabled: event.target.checked },
                'スナップを変更',
              )}
              slotProps={{ input: { 'aria-label': 'スナップ' } }}
            />
            <ParameterLinkIndicator meta={meta} semanticId="interaction.snap" />
          </Stack>
        </LabeledControl>
        <Typography variant="caption" color="text.secondary">移動の端・中央、90°回転</Typography>
      </Stack>
      <Stack spacing={0.75}>
        <LabeledControl label="比率を維持" color={linkedParameterColor(meta, 'transform.constrainAspect')}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Switch
              checked={meta.constrainAspect !== false}
              onChange={event => engine.commitLayerProps(
                meta.id,
                { constrainAspect: meta.constrainAspect !== false },
                { constrainAspect: event.target.checked },
                '比率の維持を変更',
              )}
              slotProps={{ input: { 'aria-label': '比率を維持' } }}
            />
            <ParameterLinkIndicator meta={meta} semanticId="transform.constrainAspect" />
          </Stack>
        </LabeledControl>
        <Typography variant="caption" color="text.secondary">拡大縮小で縦横比を保つ</Typography>
      </Stack>
      {descriptors.filter(item => item.key !== 'snapEnabled' && item.key !== 'constrainAspect').map(descriptor => {
        const semanticId = parameterSemanticId(descriptor);
        const value = descriptor.read(meta);
        if (descriptor.control === 'number' && descriptor.canvasLength) {
          return (
            <CanvasMmField
              key={descriptor.key}
              size="small"
              label={descriptor.label}
              valuePx={typeof value === 'number' ? value : null}
              minPx={descriptor.min}
              onCommitPx={next => engine.updateSelectedParameter(descriptor.key, next)}
              trailing={<ParameterLinkIndicator meta={meta} semanticId={semanticId} />}
              labelColor={linkedParameterColor(meta, semanticId)}
            />
          );
        }
        return (
          <NumericField
            key={descriptor.key}
            size="small"
            fullWidth
            label={descriptor.label}
            value={typeof value === 'number' ? value : null}
            min={descriptor.min}
            max={descriptor.max}
            onCommit={next => engine.updateSelectedParameter(descriptor.key, next)}
            trailing={<ParameterLinkIndicator meta={meta} semanticId={semanticId} />}
            labelColor={linkedParameterColor(meta, semanticId)}
          />
        );
      })}
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
      <Button fullWidth onClick={() => engine.transferShapeLayer()} disabled={!meta.canTransferShape}>親へ転写</Button>
    </Stack>
  );
}
