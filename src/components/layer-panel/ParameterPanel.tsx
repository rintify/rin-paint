import { Accordion, AccordionDetails, AccordionSummary, Stack, TextField, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useMemo, useState } from 'react';
import type { LayerMeta } from '../../model';
import { commonParametersOf } from '../../engine/parameters/intersect';
import { hostFromLayer } from '../../engine/parameters/host';
import { kindCatalog } from '../../engine/layer-types/registry';
import { ParameterField } from './ParameterField';
import { inspectorConfig } from './inspectorRegistry';

const VIRTUALIZE_AFTER = 40;

function groupLabel(id: string, layers: LayerMeta[]): string {
  if (id === 'layer') return 'レイヤー';
  for (const layer of layers) {
    const group = kindCatalog(layer).groups.find(item => item.id === id);
    if (group) return group.label;
  }
  return id;
}

export function ParameterPanel({ layers }: { layers: LayerMeta[] }) {
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const surface = layers.length > 1 ? 'multi' as const : 'single' as const;
  const parameters = useMemo(
    () => commonParametersOf(layers.map(hostFromLayer), surface),
    [layers, surface],
  );
  const filtered = parameters.filter(item => !query || item.label.includes(query) || item.id.includes(query));
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, typeof filtered>();
    for (const item of filtered) {
      if (!byGroup.has(item.groupId)) {
        order.push(item.groupId);
        byGroup.set(item.groupId, []);
      }
      byGroup.get(item.groupId)!.push(item);
    }
    return order.map(id => ({ id, items: byGroup.get(id)! }));
  }, [filtered]);
  const custom = layers.length === 1 ? inspectorConfig(layers[0].type) : undefined;
  return (
    <Stack spacing={1.5}>
      {parameters.length > 8 && (
        <TextField
          size="small"
          label="パラメータを検索"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      )}
      {groups.map(group => {
        const expanded = openGroups[group.id] !== false;
        const visible = expanded
          ? (group.items.length > VIRTUALIZE_AFTER ? group.items.slice(0, VIRTUALIZE_AFTER) : group.items)
          : [];
        return (
          <Accordion
            key={group.id}
            disableGutters
            expanded={expanded}
            onChange={(_, next) => setOpenGroups(current => ({ ...current, [group.id]: next }))}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="caption" color="text.secondary">{groupLabel(group.id, layers)}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1.5}>
                {visible.map(item => <ParameterField key={item.semanticId} parameter={item} layers={layers} />)}
                {expanded && group.items.length > VIRTUALIZE_AFTER && (
                  <Typography variant="caption" color="text.secondary">
                    先頭{VIRTUALIZE_AFTER}件を表示しています。検索で絞り込んでください。
                  </Typography>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>
        );
      })}
      {custom?.sections?.map((Section, index) => <Section key={index} meta={layers[0]} />)}
    </Stack>
  );
}
