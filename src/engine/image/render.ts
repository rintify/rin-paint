import type { ImageParams } from '../../model';

export function drawPlacedImage(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  image: ImageParams,
): void {
  ctx.save();
  ctx.translate(image.x + image.width / 2, image.y + image.height / 2);
  ctx.rotate(image.rotation);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, -image.width / 2, -image.height / 2, image.width, image.height);
  ctx.restore();
}
