import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import type { ToolDescriptor } from '../types';
import { EllipseSettingsPanel } from './Panel';
import {
  DEFAULT_SHAPE_TOOL_SETTINGS,
  normalizeShapeToolSettings,
  type ShapeToolSettings,
} from '../shape/settings';
import { ShapeTool } from '../shape/tool';

export const ellipseTool: ToolDescriptor<ShapeToolSettings> = {
  kind: 'ellipse',
  label: '楕円',
  description: '楕円を作成',
  icon: <CircleOutlinedIcon sx={{ fontSize: 20 }} />,
  category: 'shape',
  capabilities: { color: true, size: true, multiSelect: false },
  sizeLabel: '線の太さ',
  settings: {
    default: () => ({ ...DEFAULT_SHAPE_TOOL_SETTINGS }),
    normalize: normalizeShapeToolSettings,
    Panel: EllipseSettingsPanel,
  },
  create: (engine) => new ShapeTool(engine, 'ellipse'),
};
