import FormatColorFillIcon from '@mui/icons-material/FormatColorFill';
import type { ToolDescriptor } from '../types';
import { FillSettingsPanel } from './Panel';
import {
  DEFAULT_FILL_TOOL_SETTINGS,
  normalizeFillToolSettings,
  type FillToolSettings,
} from './settings';
import { FillTool } from './tool';

export type { FillToolSettings };
export { DEFAULT_FILL_TOOL_SETTINGS, normalizeFillToolSettings };

export const fillTool: ToolDescriptor<FillToolSettings> = {
  kind: 'fill',
  label: '塗りつぶし',
  description: 'ラスターの領域を塗りつぶす',
  icon: <FormatColorFillIcon sx={{ fontSize: 20 }} />,
  category: 'root',
  capabilities: { color: true, size: false, multiSelect: true },
  compatibleLayerTypes: ['raster'],
  settings: {
    default: () => ({ ...DEFAULT_FILL_TOOL_SETTINGS }),
    normalize: normalizeFillToolSettings,
    Panel: FillSettingsPanel,
  },
  create: (engine) => new FillTool(engine),
};
