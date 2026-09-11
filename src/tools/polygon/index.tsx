import PentagonOutlinedIcon from '@mui/icons-material/PentagonOutlined';
import type { ToolDescriptor } from '../types';
import { PolygonSettingsPanel } from './Panel';
import {
  DEFAULT_SHAPE_TOOL_SETTINGS,
  normalizeShapeToolSettings,
  type ShapeToolSettings,
} from '../shape/settings';
import { PolygonTool } from './tool';

export const polygonTool: ToolDescriptor<ShapeToolSettings> = {
  kind: 'polygon',
  label: '多角形',
  description: '自由な頂点の多角形を作成',
  icon: <PentagonOutlinedIcon sx={{ fontSize: 20 }} />,
  category: 'shape',
  capabilities: { color: true, size: true, multiSelect: false },
  sizeLabel: '線の太さ',
  settings: {
    default: () => ({ ...DEFAULT_SHAPE_TOOL_SETTINGS }),
    normalize: normalizeShapeToolSettings,
    Panel: PolygonSettingsPanel,
  },
  create: (engine) => new PolygonTool(engine),
};
