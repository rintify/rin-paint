import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import type { ToolDescriptor } from '../types';
import { LineSettingsPanel } from './Panel';
import { ShapeTool } from '../shape/tool';

export const lineTool: ToolDescriptor = {
  kind: 'line',
  label: '直線',
  description: '直線を作成',
  icon: <HorizontalRuleIcon sx={{ fontSize: 20, transform: 'rotate(-45deg)' }} />,
  category: 'shape',
  capabilities: { color: true, size: true, multiSelect: false },
  sizeLabel: '線の太さ',
  Panel: LineSettingsPanel,
  create: (engine) => new ShapeTool(engine, 'line'),
};
