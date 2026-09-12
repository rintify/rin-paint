import type { ComponentType } from 'react';
import type { LayerMeta, LayerType } from '../../model';
import { layerMaskIds } from '../../engine/layer-types/definition';
import { MaskControls } from './MaskControls';
import { TextFormatSection } from './TextFormatSection';
import { ImageActionSection } from './ImageActionSection';
import { ShapeActionSection } from './ShapeActionSection';
import { Stack, Typography } from '@mui/material';

export type InspectorSection = ComponentType<{ meta: LayerMeta }>;

export interface InspectorConfig {
  sections?: InspectorSection[];
}

function AdjustMaskSection({ meta }: { meta: LayerMeta }) {
  return <MaskControls meta={meta} />;
}

function ClipMaskSection({ meta }: { meta: LayerMeta }) {
  return (
    <Stack spacing={1.5}>
      <MaskControls meta={meta} mode="clip" />
      <Typography variant="caption" color="text.secondary">
        不透明度0%では無効、100%では対象範囲のアルファをマスクと乗算します。
      </Typography>
    </Stack>
  );
}

const REGISTRY: Partial<Record<LayerType, InspectorConfig>> = {
  adjust: { sections: [AdjustMaskSection] },
  clip: { sections: [ClipMaskSection] },
  text: { sections: [TextFormatSection] },
  image: { sections: [ImageActionSection] },
  shape: { sections: [ShapeActionSection] },
};

export function inspectorConfig(type: LayerType): InspectorConfig | undefined {
  return REGISTRY[type];
}

export function metaMaskIds(meta: LayerMeta): string[] {
  return layerMaskIds(meta.state);
}
