import { layerHandler } from '../layer-types/registry';
import type { LayerDrawEnv, LayerMeasureEnv } from '../layer-types/types';
import { makeCanvas, type Layer, type RasterLayer } from '../layers';
import { TextRenderer } from '../text/render';
import type { PaintEngine } from '../PaintEngine';

/** Owns canvases, text renderer, and the composite/render loop. */
export class Compositor {
  main: HTMLCanvasElement | null = null;
  mainCtx: CanvasRenderingContext2D | null = null;
  overlayCtx: CanvasRenderingContext2D | null = null;

  /** ストローク開始時のレイヤー内容 (履歴パッチの before 側) */
  scratch = makeCanvas(1600, 1200);
  scratchCtx = this.scratch.getContext('2d', { willReadFrequently: true })!;
  fillReference = makeCanvas(1600, 1200);
  fillReferenceCtx = this.fillReference.getContext('2d', { willReadFrequently: true })!;

  /** レイヤー種別ハンドラへ貸し出す作業キャンバス。用途ごとに使い回す。 */
  private work = new Map<string, HTMLCanvasElement>();

  textRenderer = new TextRenderer();
  dirty = true;
  raf = 0;

  constructor(private engine: PaintEngine) {}

  requestRender(): void {
    this.dirty = true;
  }

  ensureComposited(): void {
    if (this.dirty) this.composite();
  }

  syncWorkCanvases(): void {
    const { w, h } = this.engine.artboard;
    for (const c of [this.scratch, this.fillReference]) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }
  }

  /** 名前ごとに使い回す作業キャンバス。常にアートボードサイズへ揃える。 */
  workCtx(name: string): CanvasRenderingContext2D {
    const { w, h } = this.engine.artboard;
    let canvas = this.work.get(name);
    if (!canvas) {
      canvas = makeCanvas(w, h);
      this.work.set(name, canvas);
    } else if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return canvas.getContext('2d')!;
  }

  measureEnv(): LayerMeasureEnv {
    return { artboard: this.engine.artboard, textRenderer: this.textRenderer };
  }

  /** レイヤー種別ハンドラが描画に使う依存一式 */
  drawEnv(backdrop: HTMLCanvasElement | null, withToolOverlay: boolean): LayerDrawEnv {
    const eng = this.engine;
    const tool = withToolOverlay ? eng.activeTool() : null;
    const drawAboveLayer = tool?.drawAboveLayer?.bind(tool);
    return {
      artboard: eng.artboard,
      textRenderer: this.textRenderer,
      layerById: (id) => eng.layerById(id),
      handlerFor: layerHandler,
      workCtx: (name) => this.workCtx(name),
      backdrop,
      drawAboveLayer,
    };
  }

  syncTextRenders(): void {
    const layers = this.engine.allLayers();
    this.textRenderer.retain(new Set(layers.filter(l => l.type === 'text').map(l => l.id)));
    for (const layer of layers) if (layer.type === 'text') {
      this.textRenderer.request(layer.id, layer.text, this.engine.getCanvasSpec().ppi, () => {
        this.engine.bumpLayer(layer.id);
        this.engine.syncStore();
      });
    }
  }

  async readyToRender(): Promise<void> {
    this.syncTextRenders();
    await this.textRenderer.ready();
    this.ensureComposited();
  }

  compositeCanvas(): HTMLCanvasElement | null {
    return this.main;
  }

  startLoop(): void {
    this.raf = requestAnimationFrame(this.loop);
  }

  stopLoop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  attachCanvases(main: HTMLCanvasElement, overlay: HTMLCanvasElement): void {
    this.main = main;
    this.mainCtx = main.getContext('2d', { willReadFrequently: true })!;
    this.overlayCtx = overlay.getContext('2d')!;
  }

  detachCanvases(): void {
    this.stopLoop();
    this.main = null;
    this.mainCtx = null;
    this.overlayCtx = null;
  }

  private loop = (): void => {
    if (this.dirty) this.composite();
    this.drawOverlayFrame();
    this.raf = requestAnimationFrame(this.loop);
  };

  composite(): void {
    const ctx = this.mainCtx;
    const surface = this.main;
    if (!ctx || !surface) return;
    this.renderLayers(surface, ctx, null, true);
    this.dirty = false;
  }

  compositeSelection(ids: Set<string>): HTMLCanvasElement {
    this.syncWorkCanvases();
    this.renderLayers(this.fillReference, this.fillReferenceCtx, ids, false);
    return this.fillReference;
  }

  private renderLayers(
    surface: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    included: Set<string> | null,
    drawToolOverlay: boolean,
  ): void {
    const eng = this.engine;
    const { w, h } = eng.artboard;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const env = this.drawEnv(surface, drawToolOverlay);
    const render = (id: string) => {
      const l = eng.layerById(id);
      if (!l) return;
      if (l.visible && (included === null || included.has(id))) {
        layerHandler(l).draw(ctx, l, env);
      }
      for (const childId of l.childIds) render(childId);
    };
    for (const id of eng.getRootLayerIds()) render(id);
    ctx.restore();
  }

  drawOverlayFrame(): void {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    const eng = this.engine;
    ctx.clearRect(0, 0, eng.artboard.w, eng.artboard.h);
    eng.activeTool().drawOverlay?.(ctx);
    eng.drawActiveShapeHandles(ctx);
    eng.drawLoupeIfAny(ctx);
  }

  captureBefore(layer: RasterLayer): void {
    const { w, h } = this.engine.artboard;
    this.scratchCtx.clearRect(0, 0, w, h);
    this.scratchCtx.drawImage(layer.canvas, 0, 0);
  }

  restoreBefore(layer: RasterLayer): void {
    const { w, h } = this.engine.artboard;
    layer.ctx.clearRect(0, 0, w, h);
    layer.ctx.drawImage(this.scratch, 0, 0);
    this.engine.bumpLayer(layer.id);
  }

  bakeLayerOnto(target: RasterLayer, source: Layer): void {
    layerHandler(source).bakeOnto(target, source, this.drawEnv(target.canvas, false));
  }
}
