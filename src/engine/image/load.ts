import { makeCanvas } from '../../engine/layers';

export async function canvasFromImageFile(file: File): Promise<HTMLCanvasElement | null> {
  if (file.type && !file.type.startsWith('image/')) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.width > 0 && canvas.height > 0 ? canvas : null;
  } catch {
    return null;
  }
}
