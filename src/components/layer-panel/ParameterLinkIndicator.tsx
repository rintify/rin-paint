import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { IconButton, Tooltip } from '@mui/material';
import type { LayerMeta } from '../../model';
import { useEngine } from '../EngineContext';

/** A parameter-local link status. Detached compatible values can be relinked here. */
export function ParameterLinkIndicator({ meta, semanticId }: { meta: LayerMeta; semanticId: string }) {
  const engine = useEngine();
  const link = meta.parameterLink;
  if (!link) return null;
  const linked = link.linkedParameterIds.includes(semanticId);
  const buttonSx = {
    width: 24,
    height: 24,
    minWidth: 24,
    p: 0,
    flex: '0 0 24px',
    boxSizing: 'border-box',
    border: '1px solid transparent',
  } as const;
  if (meta.linkSource?.missing && linked) return (
    <Tooltip title="リンク元が見つかりません">
      <span>
        <IconButton disabled disableRipple aria-label="リンク元が見つかりません" sx={{ ...buttonSx, '&.Mui-disabled': { color: 'warning.main' } }}>
          <WarningAmberIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </span>
    </Tooltip>
  );
  if (linked) return (
    <Tooltip title="リンク中。クリックしてこの項目だけ解除">
      <IconButton
        disableRipple
        aria-label="このパラメータのリンクを解除"
        onClick={() => engine.unlinkLayerParameter(meta.id, semanticId)}
        sx={{ ...buttonSx, color: 'secondary.main', '&:hover': { bgcolor: 'action.hover' } }}
      >
        <LinkIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Tooltip>
  );
  if (!(meta.compatibleLinkParameterIds ?? []).includes(semanticId)) return null;
  return (
    <Tooltip title="リンク元の現在値で再リンク">
      <IconButton
        disableRipple
        aria-label="このパラメータを再リンク"
        onClick={() => void engine.relinkLayerParameter(meta.id, semanticId)}
        sx={{ ...buttonSx, color: 'text.disabled', borderStyle: 'dashed', borderColor: 'text.disabled', '&:hover': { bgcolor: 'action.hover' } }}
      >
        <LinkOffIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
