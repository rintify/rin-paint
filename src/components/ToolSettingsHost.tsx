import { Box } from '@mui/material';
import { getToolDescriptor } from '../tools/registry';
import { useStore } from '../state/store';
import { ColorControls } from './ColorControls';

/** アクティブツール記述子の Panel を描画する。色 UI は capabilities に従う。 */
export function ToolSettingsHost() {
  const kind = useStore((s) => s.tool);
  const descriptor = kind ? getToolDescriptor(kind) : undefined;
  const Panel = descriptor?.settings?.Panel ?? descriptor?.Panel;
  return (
    <Box className="tool-settings-host">
      {Panel ? <Panel /> : null}
      {descriptor?.capabilities.color ? <ColorControls /> : null}
    </Box>
  );
}
