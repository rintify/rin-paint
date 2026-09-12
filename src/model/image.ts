export interface ImageParams {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export function cloneImageParams(image: ImageParams): ImageParams {
  return { x: image.x, y: image.y, width: image.width, height: image.height, rotation: image.rotation };
}

export function normalizeImageParams(image: ImageParams): ImageParams {
  return {
    x: image.x,
    y: image.y,
    width: Math.max(0.1, image.width),
    height: Math.max(0.1, image.height),
    rotation: image.rotation ?? 0,
  };
}

/** Scale source pixels so they just fit inside maxWidth × maxHeight. */
export function fitSizeInBox(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const boxW = Math.max(0.1, maxWidth);
  const boxH = Math.max(0.1, maxHeight);
  if (sourceWidth <= 0 || sourceHeight <= 0) return { width: boxW, height: boxH };
  const scale = Math.min(boxW / sourceWidth, boxH / sourceHeight);
  return { width: Math.max(0.1, sourceWidth * scale), height: Math.max(0.1, sourceHeight * scale) };
}

/** Keep x/y/rotation and shrink the frame until the source aspect just fits. */
export function fitImageParamsToSource(
  image: ImageParams,
  sourceWidth: number,
  sourceHeight: number,
): ImageParams {
  const size = fitSizeInBox(sourceWidth, sourceHeight, image.width, image.height);
  return { ...image, width: size.width, height: size.height };
}
