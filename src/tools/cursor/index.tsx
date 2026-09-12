import NearMeIcon from '@mui/icons-material/NearMe';
import type { ToolDescriptor } from '../types';
import { CursorTool } from './tool';

export {
  DEFAULT_CURSOR_TOOL_SETTINGS,
  normalizeCursorToolSettings,
  resolveCursorToolSettings,
  type CursorToolSettings,
} from './settings';

export const cursorTool: ToolDescriptor = {
  kind: 'cursor',
  label: 'カーソル',
  description: '見えているレイヤーを選択',
  icon: <NearMeIcon sx={{ fontSize: 20, transform: 'rotate(-30deg)' }} />,
  category: 'root',
  capabilities: { color: false, size: false, multiSelect: true },
  summary: () => 'レイヤーを選択',
  create: (engine) => new CursorTool(engine),
};
