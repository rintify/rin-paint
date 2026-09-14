import OpenWithIcon from '@mui/icons-material/OpenWith';
import type { ToolDescriptor } from '../types';
import { MoveTool } from './tool';
import { MoveSettingsPanel } from './Panel';
import { normalizeMoveToolSettings } from './settings';

export const moveTool: ToolDescriptor = {
  kind: 'move',
  label: '移動変形',
  description: '選択レイヤーを移動・変形',
  icon: <OpenWithIcon sx={{ fontSize: 20 }} />,
  category: 'root',
  capabilities: { color: false, size: false, multiSelect: true },
  compatibleLayerTypes: ['raster', 'shape', 'text', 'image'],
  settings: {
    default: () => normalizeMoveToolSettings(undefined),
    normalize: normalizeMoveToolSettings,
    Panel: MoveSettingsPanel,
  },
  summary: () => '移動・変形',
  create: (engine) => new MoveTool(engine),
};
