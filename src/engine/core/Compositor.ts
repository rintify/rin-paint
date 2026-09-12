import { layerHandler } from '../layer-types/registry';
import type { CanvasLease, LayerDrawEnv, LayerMeasureEnv } from '../layer-types/types';
import { makeCanvas, type Layer, type RasterLayer } from '../layers';
import { TextRenderer } from '../text/render';
import type { PaintEngine } from '../PaintEngine';
import { CanvasPool } from './CanvasPool';

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

  private readonly canvasPool = new CanvasPool();

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

  private borrowCanvas(): CanvasLease {
    const { w, h } = this.engine.artboard;
    return this.canvasPool.acquire(w, h);
  }

  measureEnv(): LayerMeasureEnv {
    return { artboard: this.engine.artboard, textRenderer: this.textRenderer };
  }

  /** レイヤー種別ハンドラが描画に使う依存一式 */
  drawEnv(withToolOverlay: boolean): LayerDrawEnv {
    const eng = this.engine;
    const tool = withToolOverlay ? eng.activeTool() : null;
    const drawAboveLayer = tool?.drawAboveLayer?.bind(tool);
    const env: LayerDrawEnv = {
      artboard: eng.artboard,
      textRenderer: this.textRenderer,
      layerById: (id) => eng.layerById(id),
      handlerFor: layerHandler,
      borrowCanvas: () => this.borrowCanvas(),
      ppi: eng.getCanvasSpec().ppi,
      maskCanvas: (ids) => this.renderMask(ids, env),
      drawAboveLayer,
    };
    return env;
  }

  private renderMask(ids: string[], env: LayerDrawEnv): CanvasLease | null {
    if (!ids.length) return null;
    const lease = this.borrowCanvas();
    const ctx = lease.ctx;
    ctx.save();
    for (const id of ids) {
      const source = this.engine.layerById(id);
      if (!source) continue;
      const handler = layerHandler(source);
      if (!handler.drawMask) continue;
      ctx.save();
      ctx.globalAlpha = source.opacity;
      ctx.globalCompositeOperation = 'source-over';
      handler.drawMask(ctx, source, env);
      ctx.restore();
    }
    ctx.restore();
    return lease;
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
    this.renderLayers(ctx, null, true);
    this.dirty = false;
  }

  compositeSelection(ids: Set<string>): HTMLCanvasElement {
    this.syncWorkCanvases();
    this.renderLayers(this.fillReferenceCtx, ids, false);
    return this.fillReference;
  }

  private renderLayers(
    ctx: CanvasRenderingContext2D,
    included: Set<string> | null,
    drawToolOverlay: boolean,
  ): void {
    const eng = this.engine;
    const { w, h } = eng.artboard;
    const art = this.borrowCanvas();
    const artCtx = art.ctx;
    artCtx.save();
    artCtx.setTransform(1, 0, 0, 1, 0, 0);
    artCtx.globalAlpha = 1;
    artCtx.globalCompositeOperation = 'source-over';
    artCtx.filter = 'none';
    artCtx.restore();
    const env = this.drawEnv(drawToolOverlay);
    const participates = (layer: Layer) => layer.visible && (included === null || included.has(layer.id));
    const activeEffectInChain = (layer: Layer): boolean => {
      if (!layerHandler(layer).effect) return false;
      if (participates(layer)) return true;
      return layer.childIds.some(id => {
        const child = eng.layerById(id);
        return !!child && activeEffectInChain(child);
      });
    };
    const resetTarget = (target: CanvasRenderingContext2D) => {
      target.globalAlpha = 1;
      target.globalCompositeOperation = 'source-over';
      target.filter = 'none';
    };
    const renderSequence = (ids: string[], target: CanvasRenderingContext2D) => {
      for (const id of ids) {
        const layer = eng.layerById(id);
        if (!layer) continue;
        const handler = layerHandler(layer);
        if (handler.effect) {
          if (participates(layer)) {
            handler.effect.apply({ canvas: target.canvas, coverage: target.canvas }, layer, env);
            resetTarget(target);
          }
          renderSequence(layer.childIds, target);
          continue;
        }

        const hasActiveDirectEffect = layer.childIds.some(childId => {
          const child = eng.layerById(childId);
          return !!child && activeEffectInChain(child);
        });
        if (hasActiveDirectEffect) {
          const scope = this.borrowCanvas();
          const local = scope.ctx;
          local.save();
          local.setTransform(1, 0, 0, 1, 0, 0);
          resetTarget(local);
          if (participates(layer)) {
            local.save();
            handler.draw(local, layer, env);
            local.restore();
          }
          renderSequence(layer.childIds, local);
          local.restore();
          target.save();
          resetTarget(target);
          target.drawImage(local.canvas, 0, 0);
          target.restore();
          scope.release();
          continue;
        }
        if (participates(layer)) {
          target.save();
          handler.draw(target, layer, env);
          target.restore();
        }
        renderSequence(layer.childIds, target);
      }
    };
    renderSequence(eng.getRootLayerIds(), artCtx);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(artCtx.canvas, 0, 0);
    ctx.restore();
    art.release();
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
    const handler = layerHandler(source);
    const env = this.drawEnv(false);
    if (handler.effect) {
      const borrowed = this.borrowCanvas();
      const scope = borrowed.ctx;
      const { w, h } = this.engine.artboard;
      if (target.visible) layerHandler(target).draw(scope, target, env);
      handler.effect.apply({ canvas: scope.canvas, coverage: scope.canvas }, source, env);
      target.ctx.clearRect(0, 0, w, h);
      target.ctx.drawImage(scope.canvas, 0, 0);
      borrowed.release();
      return;
    }
    handler.bakeOnto(target, source, env);
  }
}
