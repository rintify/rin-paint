import CropSquareIcon from '@mui/icons-material/CropSquare';
import type { ToolDescriptor } from '../types';
import { RectSettingsPanel } from './Panel';
import {
  DEFAULT_SHAPE_TOOL_SETTINGS,
  normalizeShapeToolSettings,
  type ShapeToolSettings,
} from '../shape/settings';
import { ShapeTool } from '../shape/tool';

export type { ShapeToolSettings };
export { DEFAULT_SHAPE_TOOL_SETTINGS, normalizeShapeToolSettings };

export const rectTool: ToolDescriptor<ShapeToolSettings> = {
  kind: 'rect',
  label: '四角',
  description: '四角形を作成',
  icon: <CropSquareIcon sx={{ fontSize: 20 }} />,
  category: 'shape',
  capabilities: { color: true, size: true, multiSelect: false },
  sizeLabel: '線の太さ',
  settings: {
    default: () => ({ ...DEFAULT_SHAPE_TOOL_SETTINGS }),
    normalize: normalizeShapeToolSettings,
    Panel: RectSettingsPanel,
  },
  create: (engine) => new ShapeTool(engine, 'rect'),
};
