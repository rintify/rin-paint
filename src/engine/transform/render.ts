import type { LayerOf } from '../layers';
import type { EffectScope, LayerDrawEnv } from '../layer-types/types';
import { inverseMatrix, transformMatrix } from './projective';

export function renderTransform(
  scope: EffectScope,
  layer: LayerOf<'transform'>,
  env: LayerDrawEnv,
): void {
  if (layer.opacity <= 0) return;
  const m = transformMatrix(layer.state, env.artboard.w, env.artboard.h);
  const inverse = inverseMatrix(m);
  const original =
    !scope.source || layer.opacity < 1
      ? env.borrowCanvas(scope.width, scope.height)
      : null;
  original?.ctx.drawImage(scope.canvas, 0, 0);
  const input = scope.source ?? {
    canvas: original!.canvas,
    x: scope.x,
    y: scope.y,
    width: scope.width,
    height: scope.height,
  };
  const ctx = scope.canvas.getContext('2d')!;
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, scope.width, scope.height);
    if (inverse && !m[6] && !m[7]) {
      ctx.setTransform(
        m[0],
        m[3],
        m[1],
        m[4],
        m[0] * input.x + m[1] * input.y + m[2] - scope.x,
        m[3] * input.x + m[4] * input.y + m[5] - scope.y,
      );
      ctx.drawImage(input.canvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else if (inverse) {
      const preview =
        env.effectPreview?.source === input ? env.effectPreview : undefined;
      let source = input.pixels;
      if (!source) {
        source = input.canvas
          .getContext('2d')!
          .getImageData(0, 0, input.width, input.height).data;
        env.stats.cpuReadbackPixels += input.width * input.height;
        if (preview) input.pixels = source;
      }
      const step = preview?.sampleStep ?? 1;
      const width = Math.ceil(scope.width / step),
        height = Math.ceil(scope.height / step);
      const output = ctx.createImageData(width, height);
      const [a, b, c, d, e, f, g, h, i] = inverse;
      env.stats.transformSamplePixels =
        (env.stats.transformSamplePixels ?? 0) + width * height;
      // Inverse homography with premultiplied-alpha bilinear sampling avoids seams and dark fringes.
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const px = (x + 0.5) * step + scope.x,
            py = (y + 0.5) * step + scope.y,
            z = g * px + h * py + i;
          if (Math.abs(z) < 1e-12) continue;
          const u = (a * px + b * py + c) / z - input.x - 0.5,
            v = (d * px + e * py + f) / z - input.y - 0.5;
          if (u < -1 || v < -1 || u >= input.width || v >= input.height)
            continue;
          const ix = Math.floor(u),
            iy = Math.floor(v),
            fx = u - ix,
            fy = v - iy;
          let alpha = 0,
            red = 0,
            green = 0,
            blue = 0;
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
              const xx = ix + dx,
                yy = iy + dy;
              if (xx < 0 || yy < 0 || xx >= input.width || yy >= input.height)
                continue;
              const index = (yy * input.width + xx) * 4;
              const weight =
                (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * source[index + 3];
              alpha += weight;
              red += source[index] * weight;
              green += source[index + 1] * weight;
              blue += source[index + 2] * weight;
            }
          const index = (y * width + x) * 4;
          if (alpha) {
            output.data[index] = red / alpha;
            output.data[index + 1] = green / alpha;
            output.data[index + 2] = blue / alpha;
            output.data[index + 3] = alpha;
          }
        }
      if (step === 1) ctx.putImageData(output, 0, 0);
      else {
        const small = env.borrowCanvas(width, height);
        try {
          small.ctx.putImageData(output, 0, 0);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(
            small.canvas,
            0,
            0,
            width,
            height,
            0,
            0,
            width * step,
            height * step,
          );
        } finally {
          small.release();
        }
      }
    }
    if (layer.opacity < 1) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.globalAlpha = layer.opacity;
      ctx.fillRect(0, 0, scope.width, scope.height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - layer.opacity;
      ctx.drawImage(original!.canvas, 0, 0);
    }
  } finally {
    ctx.restore();
    original?.release();
  }
}
