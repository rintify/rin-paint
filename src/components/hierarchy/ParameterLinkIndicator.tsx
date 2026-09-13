import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { IconButton, Tooltip } from '@mui/material';
import type { LayerMeta } from '../../model';
import { useEngine } from '../EngineContext';

const iconSx = {
  width: 28,
  height: 28,
  p: 0.25,
  '&:hover': { bgcolor: 'action.hover' },
} as const;

/** A parameter-local link status. Detached compatible values can be relinked here. */
export function ParameterLinkIndicator({ meta, semanticId }: { meta: LayerMeta; semanticId: string }) {
  const engine = useEngine();
  const link = meta.parameterLink;
  if (!link) return null;
  const linked = link.linkedParameterIds.includes(semanticId);
  if (meta.linkSource?.missing && linked) return (
    <Tooltip title="リンク元が見つかりません">
      <span>
        <IconButton disabled disableRipple aria-label="リンク元が見つかりません" sx={{ ...iconSx, '&.Mui-disabled': { color: 'warning.main' } }}>
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
        sx={{ ...iconSx, color: 'secondary.main' }}
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
        sx={{ ...iconSx, color: 'text.secondary', opacity: 0.55 }}
      >
        <LinkOffIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Tooltip>
  );
}
