import { useState } from 'react';
import { Button, MenuItem, TextField } from '@mui/material';
import type { LayerMeta } from '../../model';
import { useStore } from '../../state/store';
import { useEngine } from '../EngineContext';

export function RasterTransferSection({meta}: {meta: LayerMeta}) {
  const engine = useEngine();
  const layers = useStore(state => state.layers);
  const [targetId, setTargetId] = useState('');
  const candidates = layers.filter(layer => layer.type === 'raster' && layer.parentId === meta.parentId);
  const target = candidates.some(layer => layer.id === targetId) ? targetId : candidates[0]?.id ?? '';
  return <>
    <TextField select size="small" label="転写先ラスター" value={target} disabled={!candidates.length}
      onChange={event => setTargetId(event.target.value)}>
      {candidates.map(layer => <MenuItem key={layer.id} value={layer.id}>{layer.name}</MenuItem>)}
    </TextField>
    <Button fullWidth disabled={!target || !meta.canTransferShape} onClick={() => engine.transferShapeLayer(target)}>
      指定したラスターへ転写
    </Button>
  </>;
}
