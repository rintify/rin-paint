import type { LayerMeta } from '../../model';

export function linkedParameterColor(meta: LayerMeta, semanticId: string): 'secondary' | 'warning' | 'text.secondary' {
  if (!meta.parameterLink?.linkedParameterIds.includes(semanticId)) return 'text.secondary';
  return meta.linkSource?.missing ? 'warning' : 'secondary';
}
