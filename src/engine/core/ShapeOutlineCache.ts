import { TRANSPARENT } from '../../model';
import type { Layer } from '../layers';
import { makeCanvas } from '../layers';
import { drawShape, shapeBounds, shapeVisualPadding, translateShape } from '../shapes';
import { applyOutline, SHARP_OUTLINE_MITER_LIMIT } from '../layer-types/effectUtils';
import type { EffectScope, LayerDrawEnv } from '../layer-types/types';

/** Cache the outline in source-local coordinates, independent of output tiles.
 * Integer translations reuse both silhouette analysis and the colored bitmap.
 * Fractional coordinates stay in the key to preserve pixel coverage exactly.
 */
export function drawCachedShapeOutline(
  scope: EffectScope,
  layer: Extract<Layer, { type: 'outline' }>,
  inputs: Layer[],
  env: LayerDrawEnv,
): boolean {
  if (!inputs.length || !inputs.every(
    (input): input is Extract<Layer, { type: 'shape' }> =>
      input.type === 'shape' && input.blend === 'source-over' &&
      input.state.shape.color !== TRANSPARENT &&
      !('paintMode' in input.state.shape && input.state.shape.paintMode === 'fill-outside'),
  )) return false;

  const outline = layer.state.outline;
  const radius = outline.widthMm * env.ppi / 25.4;
  if (radius <= 0 || layer.opacity <= 0) return true;
  const padding = Math.ceil(radius *
    (outline.cornerStyle === 'sharp' ? SHARP_OUTLINE_MITER_LIMIT : 1) + 2);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const input of inputs) {
    const shape = input.state.shape;
    const bounds = shapeBounds(shape);
    const pad = shapeVisualPadding(shape) + padding;
    left = Math.min(left, bounds.x - pad);
    top = Math.min(top, bounds.y - pad);
    right = Math.max(right, bounds.x + bounds.w + pad);
    bottom = Math.max(bottom, bounds.y + bounds.h + pad);
  }
  const x = Math.floor(left), y = Math.floor(top);
  const width = Math.ceil(right) - x, height = Math.ceil(bottom) - y;
  // Keep large or widely separated shapes on the bounded tile renderer.
  if (!Number.isFinite(width * height) || width < 1 || height < 1 ||
    width * height > 4 * 1024 * 1024) return false;
  const sources = inputs.map(input => ({
    shape: translateShape(input.state.shape, -x, -y), opacity: input.opacity,
  }));
  const key = `shape-outline:${JSON.stringify([sources, outline, layer.opacity, env.ppi, width, height])}`;
  let cached = env.effectCache.get<HTMLCanvasElement>(key);
  if (!cached) {
    const source = env.borrowCanvas(width, height);
    try {
      for (const input of sources) {
        source.ctx.globalAlpha = input.opacity;
        drawShape(source.ctx, input.shape, false, env.artboard);
      }
      cached = makeCanvas(width, height);
      // Analysis intermediates belong to this build, not to every drag position.
      const localEnv: LayerDrawEnv = {
        ...env,
        sharpContours: env.sharpContours
          ? (id, threshold) => env.sharpContours!(id, threshold, scope.inputRevision)
              .map(contour => contour.map(point => ({ x: point.x - x, y: point.y - y })))
          : undefined,
        effectCache: { get: () => undefined, set: () => {} },
      };
      applyOutline({
        canvas: source.canvas, coverage: source.canvas,
        x: 0, y: 0, width, height, inputRevision: 0,
      }, layer.id, outline.color, outline.widthMm, outline.alphaThreshold,
      outline.cornerStyle ?? 'round', layer.opacity, localEnv, cached);
      env.effectCache.set(key, cached, width * height * 4);
    } finally {
      source.release();
    }
  }
  const target = scope.canvas.getContext('2d')!;
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = 1;
  target.globalCompositeOperation = 'destination-over';
  target.drawImage(cached, x - scope.x, y - scope.y);
  target.restore();
  return true;
}
