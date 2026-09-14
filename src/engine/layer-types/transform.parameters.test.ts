import { describe, expect, it } from 'vitest';
import { createTransformLayer } from '../layers';
import { parameterById, parametersFor } from '../parameters/host';
import { fromCanonical, toCanonical } from '../parameters/codec';
import {
  applyLayerProps,
  scaleLayer,
  scaleStoredLayer,
  savedLayerFrom,
} from './registry';
import { transformMatrix, mapPoint } from '../transform/projective';

describe('transform physical units', () => {
  it('edits translation in millimetres and preserves physical distances on PPI changes', async () => {
    const layer = createTransformLayer('transform');
    const parameter = parameterById(layer, 'transform.translateX')!;
    expect(parameter.editor).toEqual({
      kind: 'number',
      unit: { kind: 'canvas-mm' },
    });
    applyLayerProps(
      layer,
      parameter.write(layer, layer.state, fromCanonical(parameter, 10, 300)),
    );
    expect(toCanonical(parameter, layer.state.translateX, 300)).toBeCloseTo(10);
    const origin = mapPoint(transformMatrix(layer.state, 2000, 3000), 0, 0);
    expect(origin.x).toBeCloseTo((10 * 300) / 25.4);
    const stored = await savedLayerFrom(layer, {
      artboard: { w: 2000, h: 3000 },
    });
    scaleLayer(layer, 2, { width: 4000, height: 6000 });
    await scaleStoredLayer(stored, {
      factor: 2,
      artboard: { w: 4000, h: 6000 },
    });
    expect(stored.state).toEqual(layer.state);
    expect(toCanonical(parameter, layer.state.translateX, 600)).toBeCloseTo(10);
  });
  it('exposes angles and multipliers rather than percentages or unexplained perspective coefficients', () => {
    const layer = createTransformLayer('transform');
    const rotation = parameterById(layer, 'transform.rotation')!;
    expect(rotation.editor).toMatchObject({ unit: { kind: 'degree' } });
    const scale = parameterById(layer, 'transform.scaleX')!;
    expect(scale.read(layer, layer.state)).toBe(1);
    applyLayerProps(layer, scale.write(layer, layer.state, 1.5));
    expect(scale.read(layer, layer.state)).toBe(1.5);
    const own = parametersFor(layer, 'single').filter(
      (p) => p.scope === 'state',
    );
    expect(own.some((p) => p.label.includes('%'))).toBe(false);
    expect(own.some((p) => p.id.includes('perspective'))).toBe(false);
  });
});
