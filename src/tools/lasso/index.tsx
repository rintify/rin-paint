import GestureIcon from '@mui/icons-material/Gesture';
import type { ToolDescriptor } from '../types';
import { LassoTool } from './tool';

export const lassoTool: ToolDescriptor = {
  kind: 'lasso',
  label: '選択',
  description: '選択して変形',
  icon: <GestureIcon sx={{ fontSize: 20 }} />,
  category: 'root',
  capabilities: { color: false, size: false, multiSelect: true },
  compatibleLayerTypes: ['raster', 'shape', 'text', 'image'],
  summary: () => '選択・変形',
  create: (engine) => new LassoTool(engine),
};
