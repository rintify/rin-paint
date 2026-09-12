import { useStore } from '../../state/store';
import { TRANSPARENT, type StrokePoint } from '../../model';
import { normalizeFillToolSettings } from '../../tools/fill/settings';
import { analyzeFill, type FillAnalysisResult } from '../fillAlgorithm';
import { makeCanvas } from '../layers';
import type { PaintEngine } from '../PaintEngine';
import { gapCloseMmToPx } from '../units';

function parseHex(color: string): [number, number, number] {
  const value = color.replace('#', '');
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
}

export class FillService {
  private worker: Worker | null = null;
  private token = 0;
  private resolvePending: ((value: FillAnalysisResult | null) => void) | null = null;

  constructor(private engine: PaintEngine) {}

  cancel(): void {
    this.token++;
    this.worker?.terminate();
    this.worker = null;
    this.resolvePending?.(null);
    this.resolvePending = null;
    useStore.getState().set({ fillProgress: null });
    this.engine.setBusy(false);
  }

  async start(point: StrokePoint): Promise<void> {
    if (this.engine.isBusy()) return;
    const ls = this.engine.layerService;
    const target = ls.rasterById(ls.activeLayerId);
    if (!target?.visible) {
      useStore.getState().set({ toolNotice: '表示中のラスターレイヤーを主選択してください' });
      return;
    }
    const state = useStore.getState();
    const active = state.tools.find(tool => tool.id === state.activeToolId);
    const settings = normalizeFillToolSettings(active?.settings);
    const selected = new Set(state.multiSelectMode ? state.selectedLayerIds : [ls.activeLayerId]);
    const color = state.penColor;
    const token = ++this.token;
    this.engine.setBusy(true);
    state.set({ fillProgress: 0 });
    try {
      await this.engine.readyToRender();
      if (token !== this.token) return;
      const reference = this.engine.compositor.compositeSelection(selected);
      const pixels = reference.getContext('2d', { willReadFrequently: true })!
        .getImageData(0, 0, reference.width, reference.height).data;
      const before = makeCanvas(target.runtime.canvas.width, target.runtime.canvas.height);
      before.getContext('2d')!.drawImage(target.runtime.canvas, 0, 0);
      const result = await this.analyze({
        pixels,
        width: reference.width,
        height: reference.height,
        seedX: point.x,
        seedY: point.y,
        tolerance: settings.colorTolerance,
        gapClosePx: gapCloseMmToPx(settings.gapCloseMm, useStore.getState().canvasSpec.ppi),
      }, token);
      if (!result || token !== this.token || !result.bounds) return;
      const bounds = result.bounds;
      const image = target.runtime.ctx.getImageData(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      const rgb = color === TRANSPARENT ? null : parseHex(color);
      const span = bounds.maxX - bounds.minX;
      for (let y = bounds.minY; y < bounds.maxY; y++) {
        for (let x = bounds.minX; x < bounds.maxX; x++) {
          if (!result.mask[y * reference.width + x]) continue;
          const offset = ((y - bounds.minY) * span + x - bounds.minX) * 4;
          if (!rgb) image.data[offset + 3] = 0;
          else {
            image.data[offset] = rgb[0]; image.data[offset + 1] = rgb[1]; image.data[offset + 2] = rgb[2]; image.data[offset + 3] = 255;
          }
        }
      }
      target.runtime.ctx.putImageData(image, bounds.minX, bounds.minY);
      this.engine.commitRasterBatch([{ layer: target, before, rect: bounds }], '塗りつぶし');
      if (color !== TRANSPARENT) useStore.getState().pushColor(color);
    } finally {
      if (token === this.token) {
        this.worker = null;
        useStore.getState().set({ fillProgress: null });
        this.engine.setBusy(false);
      }
    }
  }

  private analyze(
    input: Omit<Parameters<typeof analyzeFill>[0], 'progress'>,
    token: number,
  ): Promise<FillAnalysisResult | null> {
    if (typeof Worker === 'undefined') {
      return Promise.resolve(analyzeFill({ ...input, progress: value => {
        if (token === this.token) useStore.getState().set({ fillProgress: value });
      } }));
    }
    return new Promise((resolve, reject) => {
      this.resolvePending = resolve;
      const worker = new Worker(new URL('../fillWorker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = event => {
        if (event.data?.type === 'progress') {
          if (token === this.token) useStore.getState().set({ fillProgress: event.data.value });
          return;
        }
        if (event.data?.type === 'result') {
          worker.terminate();
          if (this.worker === worker) this.worker = null;
          this.resolvePending = null;
          resolve(token === this.token ? { mask: new Uint8Array(event.data.mask), bounds: event.data.bounds } : null);
        }
      };
      worker.onerror = error => { worker.terminate(); this.resolvePending = null; reject(error); };
      const transferable = input.pixels.slice();
      worker.postMessage({ ...input, pixels: transferable.buffer }, [transferable.buffer]);
    });
  }
}
