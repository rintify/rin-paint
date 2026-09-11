import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import type { ToolDescriptor } from '../types';
import { PenSettingsPanel } from './Panel';
import { DEFAULT_PEN_DETAIL_SETTINGS, normalizePenDetailSettings, type PenDetailSettings } from './settings';
import { PenTool } from './tool';

export type { PenDetailSettings };
export { DEFAULT_PEN_DETAIL_SETTINGS, normalizePenDetailSettings };

export const penTool: ToolDescriptor<PenDetailSettings> = {
  kind: 'pen',
  label: 'ペン',
  description: '筆圧対応の描画',
  icon: <EditOutlinedIcon sx={{ fontSize: 20 }} />,
  category: 'root',
  capabilities: { color: true, size: true, multiSelect: false },
  sizeLabel: 'ペンの太さ',
  settings: {
    default: () => ({ ...DEFAULT_PEN_DETAIL_SETTINGS }),
    normalize: normalizePenDetailSettings,
    Panel: PenSettingsPanel,
  },
  create: (engine) => new PenTool(engine),
};
