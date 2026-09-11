import BlurOnIcon from '@mui/icons-material/BlurOn';
import type { ToolDescriptor } from '../types';
import { BlurSettingsPanel } from './Panel';
import { BlurTool } from './tool';

export const blurTool: ToolDescriptor = {
  kind: 'blur',
  label: 'ぼかし',
  description: 'なぞってぼかす',
  icon: <BlurOnIcon sx={{ fontSize: 20 }} />,
  category: 'root',
  capabilities: { color: false, size: true, multiSelect: false },
  sizeLabel: 'ぼかしの太さ',
  summary: (tool) => `${tool.size}px`,
  Panel: BlurSettingsPanel,
  create: (engine) => new BlurTool(engine),
};
