import { getFrames } from '../persistence/db';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function pickMime(): { mime: string; ext: string } {
  const candidates: [string, string][] = [
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm;codecs=vp8', 'webm'],
    ['video/webm', 'webm'],
    ['video/mp4', 'mp4'],
  ];
  for (const [mime, ext] of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: '', ext: 'webm' };
}

/**
 * IndexedDB に溜めたフレームを 30fps で流し込みながら
 * MediaRecorder で動画にエンコードしてダウンロードする。
 */
export async function exportTimelapse(
  onProgress: (fraction: number) => void,
): Promise<boolean> {
  const frames = await getFrames();
  if (frames.length === 0) return false;

  const first = await createImageBitmap(frames[0].blob);
  const canvas = document.createElement('canvas');
  canvas.width = first.width;
  canvas.height = first.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(first, 0, 0);
  first.close();

  const stream = canvas.captureStream(30);
  const { mime, ext } = pickMime();
  const rec = new MediaRecorder(
    stream,
    mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined,
  );
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });

  rec.start(250);
  await sleep(120);
  for (let i = 0; i < frames.length; i++) {
    const bmp = await createImageBitmap(frames[i].blob);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    onProgress((i + 1) / frames.length);
    await sleep(34);
  }
  await sleep(700);
  rec.stop();
  await stopped;

  const type = mime || 'video/webm';
  downloadBlob(new Blob(chunks, { type }), `rin-paint-timelapse.${ext}`);
  return true;
}
