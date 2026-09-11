import BlurOnIcon from '@mui/icons-material/BlurOn';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import GestureIcon from '@mui/icons-material/Gesture';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import type { ReactNode } from 'react';
import { TOOL_KIND_LABELS, type ToolKind } from '../../types';

const iconSx = { fontSize: 20 };

export const TOOL_ICONS: Record<ToolKind, ReactNode> = {
  text: <TextFieldsIcon sx={iconSx} />,
  pen: <EditOutlinedIcon sx={iconSx} />,
  line: <HorizontalRuleIcon sx={{ ...iconSx, transform: 'rotate(-45deg)' }} />,
  rect: <CropSquareIcon sx={iconSx} />,
  ellipse: <CircleOutlinedIcon sx={iconSx} />,
  lasso: <GestureIcon sx={iconSx} />,
  blur: <BlurOnIcon sx={iconSx} />,
};

export const TOOL_DESCRIPTIONS: Record<ToolKind, string> = {
  pen: '筆圧対応の描画',
  text: '部分書式と縦書き',
  line: '直線を作成',
  rect: '四角形を作成',
  ellipse: '楕円を作成',
  lasso: '選択して変形',
  blur: 'なぞってぼかす',
};

export const SHAPE_KINDS: ToolKind[] = ['line', 'rect', 'ellipse'];
export const ROOT_KINDS: ToolKind[] = ['pen', 'text', 'lasso', 'blur'];

export function toolCatalogLabel(kind: ToolKind): string {
  return TOOL_KIND_LABELS[kind];
}

export function toolSearchHaystack(kind: ToolKind): string {
  return `${TOOL_KIND_LABELS[kind]} ${TOOL_DESCRIPTIONS[kind]} ${SHAPE_KINDS.includes(kind) ? '図形' : ''}`;
}
