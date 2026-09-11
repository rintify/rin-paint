import { TRANSPARENT } from '../../model';
import { buildFilter, makeCanvas, type Layer, type RasterLayer, type ShapeLayer } from '../layers';
import { drawShape } from '../shapes';
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
  /** 調整レイヤー適用用の作業キャンバス */
  tmp = makeCanvas(1600, 1200);
  tmpCtx = this.tmp.getContext('2d')!;
  /** 透明図形を直親ラスターだけへ非破壊で反映する作業キャンバス */
  shapeTmp = makeCanvas(1600, 1200);
  shapeTmpCtx = this.shapeTmp.getContext('2d')!;
  maskTmp = makeCanvas(1600, 1200);
  maskTmpCtx = this.maskTmp.getContext('2d')!;

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
    for (const c of [this.scratch, this.tmp, this.shapeTmp, this.maskTmp]) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }
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
    if (!ctx) return;
    const eng = this.engine;
    const { w, h } = eng.artboard;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const tool = eng.activeTool();
    const render = (id: string) => {
      const l = eng.layerById(id);
      if (!l) return;
      if (l.visible && l.type === 'raster') {
        let source: HTMLCanvasElement = l.canvas;
        const erasers = l.childIds
          .map((childId) => eng.shapeLayerById(childId))
          .filter((child): child is ShapeLayer => !!child && child.visible && child.shape.color === TRANSPARENT);
        if (erasers.length) {
          this.shapeTmpCtx.save();
          this.shapeTmpCtx.clearRect(0, 0, w, h);
          this.shapeTmpCtx.globalAlpha = 1;
          this.shapeTmpCtx.globalCompositeOperation = 'source-over';
          this.shapeTmpCtx.drawImage(l.canvas, 0, 0);
          for (const eraser of erasers) {
            this.shapeTmpCtx.globalAlpha = eraser.opacity;
            drawShape(this.shapeTmpCtx, eraser.shape);
          }
          this.shapeTmpCtx.restore();
          source = this.shapeTmp;
        }
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = l.blend;
        ctx.drawImage(source, 0, 0);
        if (tool.drawAboveLayer) tool.drawAboveLayer(ctx, l.id);
      } else if (l.visible && l.type === 'shape' && l.shape.color !== TRANSPARENT) {
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = l.blend;
        drawShape(ctx, l.shape);
      } else if (l.visible && l.type === 'text') {
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = l.blend;
        this.textRenderer.draw(ctx, l.id, l.text);
      } else if (l.visible && l.type === 'adjust') {
        this.tmpCtx.save();
        this.tmpCtx.clearRect(0, 0, w, h);
        this.tmpCtx.filter = buildFilter(l.params);
        this.tmpCtx.drawImage(this.main!, 0, 0);
        this.tmpCtx.restore();
        if (l.maskLayerIds.length) {
          this.maskTmpCtx.save();
          this.maskTmpCtx.clearRect(0, 0, w, h);
          this.maskTmpCtx.globalCompositeOperation = 'source-over';
          for (const sourceId of l.maskLayerIds) {
            const source = eng.layerById(sourceId);
            if (!source?.visible || source.type === 'adjust') continue;
            this.maskTmpCtx.globalAlpha = source.opacity;
            if (source.type === 'raster') this.maskTmpCtx.drawImage(source.canvas, 0, 0);
            else if (source.type === 'shape' && source.shape.color !== TRANSPARENT) {
              const shape = source.shape.kind === 'line' ? { ...source.shape, color: '#fff' } : { ...source.shape, color: '#fff' };
              drawShape(this.maskTmpCtx, shape);
            } else if (source.type === 'text') this.textRenderer.draw(this.maskTmpCtx, source.id, source.text);
          }
          this.maskTmpCtx.restore();
          this.tmpCtx.save();
          this.tmpCtx.globalCompositeOperation = 'destination-in';
          this.tmpCtx.globalAlpha = 1;
          this.tmpCtx.drawImage(this.maskTmp, 0, 0);
          this.tmpCtx.restore();
        }
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(this.tmp, 0, 0);
      }
      for (const childId of l.childIds) render(childId);
    };
    for (const id of eng.getRootLayerIds()) render(id);
    ctx.restore();
    this.dirty = false;
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
    const { w, h } = this.engine.artboard;
    if (source.type === 'adjust') {
      this.tmpCtx.save();
      this.tmpCtx.clearRect(0, 0, w, h);
      this.tmpCtx.filter = buildFilter(source.params);
      this.tmpCtx.drawImage(target.canvas, 0, 0);
      this.tmpCtx.restore();
      target.ctx.save();
      target.ctx.globalAlpha = source.opacity;
      target.ctx.globalCompositeOperation = 'source-over';
      target.ctx.drawImage(this.tmp, 0, 0);
      target.ctx.restore();
    } else {
      target.ctx.save();
      target.ctx.globalAlpha = source.opacity;
      target.ctx.globalCompositeOperation = source.blend;
      if (source.type === 'raster') target.ctx.drawImage(source.canvas, 0, 0);
      else if (source.type === 'text') this.textRenderer.draw(target.ctx, source.id, source.text);
      else drawShape(target.ctx, source.shape);
      target.ctx.restore();
    }
  }
}
