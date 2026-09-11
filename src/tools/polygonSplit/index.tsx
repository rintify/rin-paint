import CallSplitIcon from '@mui/icons-material/CallSplit';
import type { ToolDescriptor } from '../types';
import { PolygonSplitSettingsPanel } from './Panel';
import {
  DEFAULT_POLYGON_SPLIT_TOOL_SETTINGS,
  normalizePolygonSplitToolSettings,
  type PolygonSplitToolSettings,
} from './settings';
import { PolygonSplitTool } from './tool';

export type { PolygonSplitToolSettings };
export { DEFAULT_POLYGON_SPLIT_TOOL_SETTINGS, normalizePolygonSplitToolSettings };

export const polygonSplitTool: ToolDescriptor<PolygonSplitToolSettings> = {
  kind: 'polygonSplit',
  label: '多角形分断',
  description: '図形を延長した直線で分断',
  icon: <CallSplitIcon sx={{ fontSize: 20, transform: 'rotate(90deg)' }} />,
  category: 'root',
  capabilities: { color: false, size: false, multiSelect: true },
  settings: {
    default: () => ({ ...DEFAULT_POLYGON_SPLIT_TOOL_SETTINGS }),
    normalize: normalizePolygonSplitToolSettings,
    Panel: PolygonSplitSettingsPanel,
  },
  create: (engine) => new PolygonSplitTool(engine),
};
