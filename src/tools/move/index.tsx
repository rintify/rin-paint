import OpenWithIcon from '@mui/icons-material/OpenWith';
import type { ToolDescriptor } from '../types';
import { MoveTool } from './tool';

export const moveTool: ToolDescriptor = {
  kind: 'move',
  label: '移動変形',
  description: '選択レイヤーを移動・変形',
  icon: <OpenWithIcon sx={{ fontSize: 20 }} />,
  category: 'root',
  capabilities: { color: false, size: false, multiSelect: true },
  summary: () => '移動・変形',
  create: (engine) => new MoveTool(engine),
};
