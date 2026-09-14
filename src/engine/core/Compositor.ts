import {withAsyncWarp, hasPendingWarp} from '../geometry/asyncWarp';
import { rasterToScope } from './RasterCoordinates';
import { RasterSurface } from '../raster/RasterSurface';
import { layoutMatrixPixels } from '../geometry/layoutTransform';
import { scopeOwner } from '../layerTree';
import { layerHandler } from '../layer-types/registry';
import type { CanvasLease, LayerDrawEnv, LayerMeasureEnv } from '../layer-types/types';
import { makeCanvas, type Layer, type RasterLayer } from '../layers';
import { TextRenderer } from '../text/render';
import type { PaintEngine } from '../PaintEngine';
import { CanvasPool } from './CanvasPool';
import { MaskRenderer } from './MaskRenderer';
import { unionRect, type DirtyRect } from '../brush';
import { EffectCache } from './EffectCache';
import { SceneQuery } from './SceneQuery';
import { ScopeTransforms } from './ScopeTransforms';
import { inverse, multiply, scaling, transformBounds, IDENTITY, type Homography } from '../geometry/homography';
import { warpCanvas } from '../geometry/warpCanvas';
import { warpRegions } from '../geometry/warpRegions';

interface RenderRect { x: number; y: number; w: number; h: number }

interface LayerHitCapture {
  layerId: string;
  contribution: CanvasLease | null;
  target: HTMLCanvasElement | null;
}

function clampDirty(rect: DirtyRect, width: number, height: number): DirtyRect | null {
  const value = {
    minX: Math.max(0, Math.floor(rect.minX)),
    minY: Math.max(0, Math.floor(rect.minY)),
    maxX: Math.min(width, Math.ceil(rect.maxX)),
    maxY: Math.min(height, Math.ceil(rect.maxY)),
  };
  return value.maxX > value.minX && value.maxY > value.minY ? value : null;
}

function expandDirty(rect: DirtyRect, amount: number, width: number, height: number): DirtyRect {
  return {
    minX: Math.max(0, Math.floor(rect.minX - amount)),
    minY: Math.max(0, Math.floor(rect.minY - amount)),
    maxX: Math.min(width, Math.ceil(rect.maxX + amount)),
    maxY: Math.min(height, Math.ceil(rect.maxY + amount)),
  };
}

function asRenderRect(rect: DirtyRect): RenderRect {
  return { x: rect.minX, y: rect.minY, w: rect.maxX - rect.minX, h: rect.maxY - rect.minY };
}

function mixRevision(current: number, token: string | number): number {
  const value = String(token);
  let hash = current >>> 0;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Owns canvases, text renderer, and the composite/render loop. */
export class Compositor {
  main: HTMLCanvasElement | null = null;
  mainCtx: CanvasRenderingContext2D | null = null;
  overlayCtx: CanvasRenderingContext2D | null = null;
  private overlaySurface: HTMLCanvasElement | null = null;
  private overlayArea: HTMLElement | null = null;

  /** ストローク開始時のレイヤー内容 (履歴パッチの before 側) */
  fillReference = makeCanvas(1600, 1200);
  fillReferenceCtx = this.fillReference.getContext('2d', { willReadFrequently: true })!;
  private readonly artCache = makeCanvas(1600, 1200);
  private artCacheCtx = this.artCache.getContext('2d')!;

  private readonly canvasPool = new CanvasPool();
  private readonly readbackCanvasPool = new CanvasPool(true, 2, 2 * 1024 * 1024);
  private readonly effectCache = new EffectCache();
  private readonly maskRenderer = new MaskRenderer(this.effectCache);

  textRenderer = new TextRenderer();
  dirty = true;
  private fullDirty = true;
  private readonly damageByLayer = new Map<string, DirtyRect>();
  overlayDirty = true;
  raf = 0;
  /** テスト・計測用。直近フレームで実際に合成した画素面積。 */
  lastCompositedPixels = 0;
  private readonly frameStats = { cpuReadbackPixels: 0, canvasBorrows: 0 };

  renderStats(): { compositedPixels: number; cpuReadbackPixels: number; canvasBorrows: number; maskCacheHits: number; maskCacheMisses: number; effectCacheHits: number; effectCacheMisses: number } {
    return {
      compositedPixels: this.lastCompositedPixels,
      cpuReadbackPixels: this.frameStats.cpuReadbackPixels,
      canvasBorrows: this.frameStats.canvasBorrows,
      maskCacheHits: this.maskRenderer.hits,
      maskCacheMisses: this.maskRenderer.misses,
      effectCacheHits: this.effectCache.hits,
      effectCacheMisses: this.effectCache.misses,
    };
  }

  constructor(private engine: PaintEngine) {}

  requestRender(): void {
    this.dirty = true;
    this.fullDirty = true;
    this.damageByLayer.clear();
    this.overlayDirty = true;
    this.scheduleFrame();
  }

  invalidateLayer(layerId: string, rect: DirtyRect): void {
    // A transformed source can damage pixels far from its local stroke rectangle.
    if (this.engine.allLayers().some(layer => layer.visible && layer.type === 'transform')) {
      this.requestRender(); return;
    }
    const clipped = clampDirty(rect, this.engine.artboard.w, this.engine.artboard.h);
    if (!clipped) return;
    this.dirty = true;
    if (!this.fullDirty) {
      const previous = this.damageByLayer.get(layerId);
      this.damageByLayer.set(layerId, previous ? unionRect(previous, clipped) : clipped);
    }
    this.scheduleFrame();
  }

  requestOverlayRender(): void {
    this.overlayDirty = true;
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (this.raf || (!this.main && !this.overlayCtx)) return;
    this.raf = requestAnimationFrame(this.loop);
  }

  ensureComposited(): void {
    if (this.dirty) withAsyncWarp(()=>this.requestRender(),()=>this.composite());
  }

  syncWorkCanvases(): void {
    const { w, h } = this.engine.artboard;
    for (const c of [this.fillReference, this.artCache]) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
        if (c === this.artCache) {
          this.artCacheCtx = this.artCache.getContext('2d')!;
          this.fullDirty = true;
        }
      }
    }
  }

  private borrowCanvas(width = this.engine.artboard.w, height = this.engine.artboard.h): CanvasLease {
    this.frameStats.canvasBorrows++;
    return this.canvasPool.acquire(width, height);
  }

  private borrowReadbackCanvas(width = this.engine.artboard.w, height = this.engine.artboard.h): CanvasLease {
    this.frameStats.canvasBorrows++;
    return this.readbackCanvasPool.acquire(width, height);
  }

  measureEnv(): LayerMeasureEnv {
    return { artboard: this.engine.artboard, textRenderer: this.textRenderer, ppi: this.engine.getPageSpec().ppi };
  }

  /** レイヤー種別ハンドラが描画に使う依存一式 */
  drawEnv(
    withToolOverlay: boolean,
    width = this.engine.artboard.w,
    height = this.engine.artboard.h,
    originX = 0,
    originY = 0,
  ): LayerDrawEnv {
    const eng = this.engine;
    const tool = withToolOverlay ? eng.activeTool() : null;
    const drawAboveLayer = tool?.drawAboveLayer?.bind(tool);
    const maskRevision = (id: string): number => {
      const layer = eng.layerById(id);
      let revision = eng.getMaskRevision?.(id) ?? 0;
      if (layer?.type === 'canvas') {
        for (const childId of layer.childIds) {
          const child = eng.layerById(childId);
          revision = mixRevision(revision, `${childId}:${child?.visible}:${eng.getRenderRevision?.(childId) ?? 0}:${maskRevision(childId)}`);
        }
      }
      return revision;
    };
    const env: LayerDrawEnv = {
      artboard: eng.artboard,
      originX,
      originY,
      textRenderer: this.textRenderer,
      layerById: (id) => eng.layerById(id),
      handlerFor: layerHandler,
      borrowCanvas: (w = width, h = height) => this.borrowCanvas(w, h),
      borrowReadbackCanvas: (w = width, h = height) => this.borrowReadbackCanvas(w, h),
      ppi: eng.getPageSpec().ppi,
      maskCanvas: (ids) => this.maskRenderer.render(
        ids,
        env,
        maskRevision,
        { x: originX, y: originY, w: width, h: height },
      ),
      drawCanvasScope: (ctx, layerId) => {
        const layer = eng.layerById(layerId);
        if (layer?.type !== 'canvas') return;
        const result = this.renderArt({ x: originX, y: originY, w: width, h: height }, null, false, undefined, undefined, layer.childIds);
        ctx.drawImage(result.canvas, originX, originY);
        result.release();
      },
      drawEffectContribution: (ctx, layerId) => {
        const contribution = this.renderEffectContribution(layerId, { x: originX, y: originY, w: width, h: height });
        ctx.drawImage(contribution.canvas, originX, originY);
        contribution.release();
      },
      effectCache: this.effectCache,
      stats: this.frameStats,
      drawAboveLayer,
    };
    return env;
  }

  invalidateMaskLayer(id: string): void { this.maskRenderer.invalidateLayer(id); }

  clearCaches(): void {
    this.maskRenderer.clear();
    this.effectCache.clear();
    this.canvasPool.clear();
    this.readbackCanvasPool.clear();
  }

  syncTextRenders(): void {
    const layers = this.engine.allLayers();
    const prepared = layers.filter(layer => layerHandler(layer).capabilities.renderLifecycle?.prepare);
    this.textRenderer.retain(new Set(prepared.map(layer => layer.id)));
    const env = this.measureEnv();
    for (const layer of prepared) {
      layerHandler(layer).capabilities.renderLifecycle!.prepare!(layer as never, env, () => {
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

  renderLayerHitMask(layerId: string, region?: RenderRect): CanvasLease {
    const { w, h } = this.engine.artboard;
    const bounds = region ?? { x: 0, y: 0, w, h };
    const {art,contribution}=this.renderScopeInPage(bounds,scopeOwner(this.engine.allLayers(), layerId),layerId);
    art.release();
    return contribution ?? this.borrowCanvas(bounds.w,bounds.h);
  }

  samplePixel(x: number, y: number, includedLayerId: string | null): Uint8ClampedArray {
    const cx = this.engine.bins?.activeId ? Math.round(x) : Math.max(0, Math.min(this.engine.artboard.w - 1, Math.round(x)));
    const cy = this.engine.bins?.activeId ? Math.round(y) : Math.max(0, Math.min(this.engine.artboard.h - 1, Math.round(y)));
    if (includedLayerId === null && (this.engine.bins?.activeId || scopeOwner(this.engine.allLayers(), this.engine.getActiveLayerId()))) {
      const scopeId = scopeOwner(this.engine.allLayers(), this.engine.getActiveLayerId());
      const {art} = this.renderScopeInPage({ x: cx, y: cy, w: 1, h: 1 },scopeId);
      const data = art.ctx.getImageData(0,0,1,1).data;
      art.release(); return data;
    }
    if (includedLayerId === null) {
      this.ensureComposited();
      return this.artCacheCtx.getImageData(cx, cy, 1, 1).data;
    }
    const eng=this.engine;
    const layer=eng.layerById(includedLayerId);
    const query=new SceneQuery(eng.getRootLayerIds(),eng.allLayers());
    if (!layer || query.scopeOf(layer.id) !== query.scopeOf(eng.getActiveLayerId())) return new Uint8ClampedArray(4);
    const roots=query.members(query.scopeOf(layer.id)).map(item=>item.id);
    const matrix=new ScopeTransforms(eng.getRootLayerIds(),eng.allLayers(),eng.getPageSpec().ppi).layerToPage(layer.id);
    const effect=layerHandler(layer).renderer.effect;
    const {art}=this.renderTransformed({x:cx,y:cy,w:1,h:1},roots,matrix,null,false,undefined,
      input=>effect ? this.renderEffectContribution(layer.id,input)
        : this.renderArt(input,new Set([layer.id]),false,undefined,undefined,roots));
    const data=art.ctx.getImageData(0,0,1,1).data;
    art.release();
    return data;
  }

  startLoop(): void {
    this.dirty = true;
    this.fullDirty = true;
    this.overlayDirty = true;
    this.scheduleFrame();
  }

  stopLoop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  attachCanvases(main: HTMLCanvasElement, overlay: HTMLCanvasElement, overlayArea?: HTMLElement): void {
    this.main = main;
    this.mainCtx = main.getContext('2d')!;
    this.overlaySurface = overlay;
    this.overlayArea = overlayArea ?? null;
    this.overlayCtx = overlay.getContext('2d')!;
  }

  detachCanvases(): void {
    this.stopLoop();
    this.main = null;
    this.mainCtx = null;
    this.overlaySurface = null;
    this.overlayArea = null;
    this.overlayCtx = null;
  }

  private loop = (): void => {
    this.raf = 0;
    if (this.dirty) withAsyncWarp(()=>this.requestRender(),()=>this.composite());
    if (this.overlayDirty || this.engine.overlayAnimated?.() || this.engine.activeTool().overlayAnimated?.()) {
      this.drawOverlayFrame();
      this.overlayDirty = false;
    }
    if (this.engine.overlayAnimated?.() || this.engine.activeTool().overlayAnimated?.()) this.scheduleFrame();
  };

  composite(): void {
    const ctx = this.mainCtx;
    const surface = this.main;
    if (!ctx || !surface) return;
    this.frameStats.cpuReadbackPixels = 0;
    this.frameStats.canvasBorrows = 0;
    this.syncWorkCanvases();
    if (this.fullDirty || !this.damageByLayer.size) this.compositeFull(ctx, true);
    else this.compositePartial(ctx, this.damageByLayer);
    if (hasPendingWarp()) {this.dirty=true;this.fullDirty=true;return;}
    this.dirty = false;
    this.fullDirty = false;
    this.damageByLayer.clear();
  }

  compositeSelection(ids: Set<string>): HTMLCanvasElement {
    this.syncWorkCanvases();
    const { w, h } = this.engine.artboard;
    const query = new SceneQuery(this.engine.getRootLayerIds(), this.engine.allLayers());
    const scope = query.scopeOf(this.engine.getActiveLayerId());
    const roots = query.members(scope).map(layer => layer.id);
    const allowed = new Set(roots.filter(id => ids.has(id) || this.engine.layerById(id)?.type === 'transform'));
    const matrix = new ScopeTransforms(this.engine.getRootLayerIds(), this.engine.allLayers(), this.engine.getPageSpec().ppi).scopeToPage(scope);
    const {art} = this.renderTransformed({x: 0, y: 0, w, h}, roots, matrix, allowed, false);
    this.fillReferenceCtx.clearRect(0, 0, w, h);
    this.fillReferenceCtx.drawImage(art.canvas, 0, 0);
    art.release();
    return this.fillReference;
  }

  private renderTransformed(
    region: RenderRect, roots: string[], matrix: Homography, included: Set<string> | null,
    drawToolOverlay: boolean, hitId?: string, renderInput?: (region:RenderRect)=>CanvasLease,
  ): {art:CanvasLease; contribution:CanvasLease|null} {
    const art=this.borrowCanvas(region.w,region.h);
    const contribution=hitId ? this.borrowCanvas(region.w,region.h) : null;
    for (const request of warpRegions(matrix,region)) {
      const hit:LayerHitCapture|undefined=hitId ? {layerId:hitId,contribution:null,target:null} : undefined;
      const input=renderInput ? renderInput(request.input) : this.renderArt(request.input,included,drawToolOverlay,undefined,hit,roots);
      const output=this.borrowCanvas(request.output.w,request.output.h);
      try {
        warpCanvas(input.canvas,output.ctx,matrix,request.input,request.output,request.output.w,request.output.h);
        const x=request.output.x-region.x,y=request.output.y-region.y;
        art.ctx.drawImage(output.canvas,x,y);
        if (hit?.contribution && contribution) {
          output.ctx.clearRect(0,0,output.canvas.width,output.canvas.height);
          warpCanvas(hit.contribution.canvas,output.ctx,matrix,request.input,request.output,request.output.w,request.output.h);
          contribution.ctx.drawImage(output.canvas,x,y);
        }
      } finally {
        hit?.contribution?.release();output.release();input.release();
      }
    }
    return {art,contribution};
  }

  private renderScopeInPage(region:RenderRect,scopeId:string|null,hitId?:string): {art:CanvasLease;contribution:CanvasLease|null} {
    const engine=this.engine;
    const roots=new SceneQuery(engine.getRootLayerIds(),engine.allLayers()).members(scopeId).map(layer=>layer.id);
    if (scopeId !== null) {
      const matrix=new ScopeTransforms(engine.getRootLayerIds(),engine.allLayers(),engine.getPageSpec().ppi).scopeToPage(scopeId);
      return this.renderTransformed(region,roots,matrix,null,false,hitId);
    }
    const hit:LayerHitCapture|undefined=hitId ? {layerId:hitId,contribution:null,target:null} : undefined;
    const art=this.renderArt(region,null,false,undefined,hit,roots);
    return {art,contribution:hit?.contribution??null};
  }

  private renderArt(
    region: RenderRect,
    included: Set<string> | null,
    drawToolOverlay: boolean,
    capture?: { effectId: string; contribution: CanvasLease | null },
    hit?: LayerHitCapture,
    roots = this.engine.getRootLayerIds(),
  ): CanvasLease {
    const eng = this.engine;
    // The contenteditable text is the synchronous on-canvas preview while typing.
    // Omitting its asynchronously rasterized copy keeps the visible glyphs and
    // the browser caret on the same DOM layout.
    const editingTextId = drawToolOverlay ? eng.getTextEditingId?.() ?? null : null;
    const art = this.borrowCanvas(region.w, region.h);
    const artCtx = art.ctx;
    artCtx.save();
    artCtx.setTransform(1, 0, 0, 1, 0, 0);
    artCtx.globalAlpha = 1;
    artCtx.globalCompositeOperation = 'source-over';
    artCtx.filter = 'none';
    artCtx.restore();
    const env = this.drawEnv(drawToolOverlay, region.w, region.h, region.x, region.y);
    const participates = (layer: Layer) => layer.visible
      && !(layer.type === 'text' && layer.id === editingTextId)
      && (included === null || included.has(layer.id));
    const query = new SceneQuery(eng.getRootLayerIds(), eng.allLayers());
    if (included) {
      included = new Set(included);
      for (const id of [...included]) {
        const expand = (canvasId: string): void => {
          for (const child of query.members(canvasId)) {
            included!.add(child.id);
            if (child.type === 'canvas') expand(child.id);
          }
        };
        if (eng.layerById(id)?.type === 'canvas') expand(id);
      }
    }
    const resetTarget = (target: CanvasRenderingContext2D) => {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = 1;
      target.globalCompositeOperation = 'source-over';
      target.filter = 'none';
    };
    const effectScope = (canvas: HTMLCanvasElement, inputRevision: number, activeRegion: RenderRect) => ({
      canvas,
      coverage: canvas,
      x: activeRegion.x,
      y: activeRegion.y,
      width: activeRegion.w,
      height: activeRegion.h,
      inputRevision,
    });
    const drawLayer = (target: CanvasRenderingContext2D, layer: Layer, activeRegion: RenderRect, activeEnv: LayerDrawEnv) => {
      target.save();
      target.setTransform(1, 0, 0, 1, -activeRegion.x, -activeRegion.y);
      layerHandler(layer).renderer.draw(target, layer, activeEnv);
      target.restore();
    };
    const retainHitCoverage = (targetCanvas: HTMLCanvasElement) => {
      if (!hit?.contribution || hit.target !== targetCanvas) return;
      hit.contribution.ctx.save();
      hit.contribution.ctx.setTransform(1, 0, 0, 1, 0, 0);
      hit.contribution.ctx.globalAlpha = 1;
      hit.contribution.ctx.globalCompositeOperation = 'destination-in';
      hit.contribution.ctx.drawImage(targetCanvas, 0, 0);
      hit.contribution.ctx.restore();
    };
    const captureContent = (targetCanvas: HTMLCanvasElement, layer: Layer) => {
      if (!hit || hit.layerId !== layer.id || hit.contribution) return;
      const own = this.borrowCanvas(region.w, region.h);
      drawLayer(own.ctx, layer, region, env);
      hit.contribution = own;
      hit.target = targetCanvas;
    };
    const captureDifference = (targetCanvas: HTMLCanvasElement, before: CanvasLease) => {
      const contribution = this.borrowCanvas(region.w, region.h);
      contribution.ctx.drawImage(targetCanvas, 0, 0);
      contribution.ctx.globalCompositeOperation = 'destination-out';
      contribution.ctx.drawImage(before.canvas, 0, 0);
      contribution.ctx.globalCompositeOperation = 'source-over';
      before.release();
      return contribution;
    };
    const renderSequence = (
      ids: string[],
      target: CanvasRenderingContext2D,
      targetCanvas: HTMLCanvasElement,
      state: { revision: number },
      activeRegion: RenderRect,
      activeEnv: LayerDrawEnv,
    ): boolean => {
      for (let layerIndex = 0; layerIndex < ids.length; layerIndex++) {
        const id = ids[layerIndex];
        const layer = eng.layerById(id);
        if (!layer) continue;
        const handler = layerHandler(layer);
        if (layer.type === 'transform') {
          if (!participates(layer)) continue;
          const px = eng.getPageSpec().ppi / 25.4;
          const matrix = multiply(scaling(px), multiply(layer.state.matrix, scaling(1/px)));
          const inv = inverse(matrix);
          if (!inv) continue;
          const prefix = ids.slice(0,layerIndex);
          const transformHit = !!hit?.contribution && hit.target === targetCanvas;
          const transformed=this.renderTransformed(activeRegion,prefix,matrix,included,drawToolOverlay,transformHit ? hit!.layerId : undefined);
          resetTarget(target); target.clearRect(0,0,targetCanvas.width,targetCanvas.height);
          target.drawImage(transformed.art.canvas,0,0);
          transformed.art.release();
          if (transformHit) {
            hit!.contribution!.release();
            hit!.contribution=transformed.contribution;
          }
          state.revision = mixRevision(state.revision, `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`);
          continue;
        }
        if (handler.renderer.effect) {
          const capturingEyedropper = capture?.effectId === layer.id;
          const capturingHitEffect = !!hit && hit.layerId === layer.id && !!handler.renderer.effect.clickableAddedPixels;
          if (participates(layer) || capturingEyedropper || capturingHitEffect) {
            const capturingDifference = capturingEyedropper || capturingHitEffect;
            const before = capturingDifference ? this.borrowCanvas(region.w, region.h) : null;
            before?.ctx.drawImage(targetCanvas, 0, 0);
            // A small halo bucket lets width edits reuse the same input distance-field cache.
            const padding=Math.ceil(Math.max(0,handler.renderer.effect.paddingPx?.(layer,activeEnv)??0)/16)*16;
            const frame = layer.type === 'outline' ? layoutMatrixPixels(layer.state, eng.getPageSpec().ppi) : null;
            const framed = frame && frame.some((value, index) => Math.abs(value - (index % 4 === 0 ? 1 : 0)) > 1e-10);
            if (frame && framed) {
              const undoFrame = inverse(frame)!;
              const prefix = ids.slice(0, layerIndex);
              const transformed = this.renderTransformed(activeRegion, prefix, frame, included, drawToolOverlay, undefined, local => {
                const expanded = {x: local.x-padding, y: local.y-padding, w: local.w+2*padding, h: local.h+2*padding};
                const input = this.renderTransformed(expanded, prefix, undoFrame, included, drawToolOverlay).art;
                const result = this.borrowCanvas(local.w, local.h);
                try {
                  const localEnv = this.drawEnv(drawToolOverlay, expanded.w, expanded.h, expanded.x, expanded.y);
                  handler.renderer.effect!.apply(effectScope(input.canvas, mixRevision(state.revision, JSON.stringify(frame)), expanded), layer, localEnv);
                  result.ctx.drawImage(input.canvas, -padding, -padding);
                  return result;
                } catch (error) {result.release(); throw error;} finally {input.release();}
              });
              resetTarget(target); target.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
              target.drawImage(transformed.art.canvas, 0, 0); transformed.art.release();
            } else if (padding) {
              const expanded={x:activeRegion.x-padding,y:activeRegion.y-padding,w:activeRegion.w+padding*2,h:activeRegion.h+padding*2};
              const input=this.renderArt(expanded,included,drawToolOverlay,undefined,undefined,ids.slice(0,layerIndex));
              try {
                const localEnv=this.drawEnv(drawToolOverlay,expanded.w,expanded.h,expanded.x,expanded.y);
                const effectEnv={...localEnv,maskCanvas:(ids:string[])=>localEnv.maskCanvas(query.masks(layer.id,ids).valid)};
                handler.renderer.effect.apply(effectScope(input.canvas,state.revision,expanded),layer,effectEnv);
                resetTarget(target);target.clearRect(0,0,targetCanvas.width,targetCanvas.height);
                target.drawImage(input.canvas,-padding,-padding);
              } finally { input.release(); }
            } else {
              const effectEnv = { ...activeEnv, maskCanvas: (ids: string[]) => activeEnv.maskCanvas(query.masks(layer.id, ids).valid) };
              handler.renderer.effect.apply(effectScope(targetCanvas, state.revision, activeRegion), layer, effectEnv);
            }
            resetTarget(target);
            state.revision = mixRevision(state.revision, `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`);
            if (capturingDifference && before) {
              const contribution = captureDifference(targetCanvas, before);
              if (capturingEyedropper && capture) {
                capture.contribution = contribution;
                return true;
              }
              hit!.contribution = contribution;
              hit!.target = targetCanvas;
            } else {
              retainHitCoverage(targetCanvas);
            }
          }
          continue;
        }

        if (layer.type === 'canvas') {
          if (!layer.visible) continue;
          const scope = this.borrowCanvas(activeRegion.w, activeRegion.h);
          const localState = { revision: mixRevision(2166136261, layer.id) };
          const stopped = renderSequence(layer.childIds, scope.ctx, scope.canvas, localState, activeRegion, activeEnv);
          if (stopped) { scope.release(); return true; }
          if (hit?.layerId === layer.id && !hit.contribution) {
            const contribution = this.borrowCanvas(activeRegion.w, activeRegion.h);
            contribution.ctx.globalAlpha = layer.opacity;
            contribution.ctx.drawImage(scope.canvas,0,0);
            hit.contribution = contribution;
            hit.target = targetCanvas;
          }
          target.save(); resetTarget(target);
          target.globalAlpha = layer.opacity;
          target.globalCompositeOperation = layer.blend;
          target.drawImage(scope.canvas,0,0);
          target.restore();
          if (hit?.target === scope.canvas) hit.target = targetCanvas;
          scope.release();
          state.revision = mixRevision(state.revision, localState.revision);
          continue;
        }
        if (participates(layer)) {
          captureContent(targetCanvas, layer);
          drawLayer(target, layer, activeRegion, activeEnv);
          state.revision = mixRevision(state.revision, `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`);
        }

      }
      return false;
    };
    const inclusionKey = included ? [...included].sort().join(',') : 'all';
    const initialRevision = mixRevision(2166136261, `${inclusionKey}:${drawToolOverlay ? 'tool' : 'plain'}`);
    renderSequence(roots, artCtx, art.canvas, { revision: initialRevision }, region, env);

    return art;
  }

  private renderEffectContribution(layerId: string, region: RenderRect): CanvasLease {
    const capture = { effectId: layerId, contribution: null as CanvasLease | null };
    const roots = new SceneQuery(this.engine.getRootLayerIds(), this.engine.allLayers()).members(scopeOwner(this.engine.allLayers(), layerId)).map(item => item.id);
    const art = this.renderArt(region, null, false, capture, undefined, roots);
    art.release();
    return capture.contribution ?? this.borrowCanvas(region.w, region.h);
  }

  private compositeFull(ctx: CanvasRenderingContext2D, drawToolOverlay: boolean): void {
    const { w, h } = this.engine.artboard;
    const region = { x: 0, y: 0, w, h };
    this.renderOutputTiles(region,drawToolOverlay);
    if (!hasPendingWarp()) this.present(ctx,this.artCache,region,true);
    this.lastCompositedPixels=w*h;
  }

  private renderOutputTiles(region:RenderRect,drawToolOverlay:boolean,padding=0):void {
    for(let y=region.y;y<region.y+region.h;y+=256)for(let x=region.x;x<region.x+region.w;x+=256){
      const width=Math.min(256,region.x+region.w-x),height=Math.min(256,region.y+region.h-y);
      const art=this.renderArt({x:x-padding,y:y-padding,w:width+padding*2,h:height+padding*2},null,drawToolOverlay);
      try {
        if(hasPendingWarp())continue;
        this.artCacheCtx.clearRect(x,y,width,height);
        this.artCacheCtx.drawImage(art.canvas,padding,padding,width,height,x,y,width,height);
      } finally {art.release();}
    }
  }

  private effectPaddingByLayer(env: LayerDrawEnv): Map<string, number> {
    const eng = this.engine;
    const merge = (target: Map<string, number>, source: Map<string, number>) => {
      for (const [id, padding] of source) target.set(id, Math.max(target.get(id) ?? 0, padding));
    };
    const visit = (ids: string[], state: Map<string, number>) => {
      for (const id of ids) {
        const layer = eng.layerById(id);
        if (!layer) continue;
        const effect = layerHandler(layer).renderer.effect;
        if (effect) {
          if (layer.visible) {
            const padding = Math.max(0, effect.paddingPx?.(layer, env) ?? 0);
            if (padding) for (const [sourceId, value] of state) state.set(sourceId, value + padding);
            for (const dependencyId of effect.dependencyLayerIds?.(layer) ?? []) {
              state.set(dependencyId, Math.max(state.get(dependencyId) ?? 0, padding));
            }
          }
          continue;
        }
        if (layer.type === 'canvas') {
          if (!layer.visible) continue;
          const local = new Map<string, number>();
          if (layer.visible) local.set(layer.id, 0);
          visit(layer.childIds, local);
          merge(state, local);
        } else {
          if (layer.visible) state.set(layer.id, Math.max(state.get(layer.id) ?? 0, 0));
        }
      }
    };
    const result = new Map<string, number>();
    visit(eng.getRootLayerIds(), result);
    return result;
  }

  private compositePartial(ctx: CanvasRenderingContext2D, damages: Map<string, DirtyRect>): void {
    if (this.engine.allLayers().some(layer => layer.type === 'outline' && layer.state.matrix?.some((value, index) => Math.abs(value - (index % 4 === 0 ? 1 : 0)) > 1e-10))) {
      this.compositeFull(ctx, true); return;
    }
    const { w, h } = this.engine.artboard;
    const env = this.drawEnv(true);
    const paddingByLayer = this.effectPaddingByLayer(env);
    let output: DirtyRect | null = null;
    let evaluationPadding = 0;
    for (const [layerId, damage] of damages) {
      const padding = paddingByLayer.get(layerId) ?? 0;
      const expanded = expandDirty(damage, padding, w, h);
      output = output ? unionRect(output, expanded) : expanded;
      evaluationPadding = Math.max(evaluationPadding, padding);
    }
    if (!output) return;
    const evaluation = expandDirty(output, evaluationPadding, w, h);
    const outputRegion = asRenderRect(output);
    const evaluationRegion = asRenderRect(evaluation);
    this.renderOutputTiles(outputRegion,true,evaluationPadding);
    if(!hasPendingWarp())this.present(ctx,this.artCache,outputRegion,false);
    this.lastCompositedPixels=evaluationRegion.w*evaluationRegion.h;
  }

  private present(
    ctx: CanvasRenderingContext2D,
    art: HTMLCanvasElement,
    region: RenderRect,
    clearAll: boolean,
  ): void {
    const { w, h } = this.engine.artboard;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    if (clearAll) ctx.clearRect(0, 0, w, h);
    else ctx.clearRect(region.x, region.y, region.w, region.h);
    if (this.engine.bins?.activeId) {ctx.restore(); return;}
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(region.x, region.y, region.w, region.h);
    ctx.drawImage(
      art,
      region.x, region.y, region.w, region.h,
      region.x, region.y, region.w, region.h,
    );
    ctx.restore();
  }

  drawOverlayFrame(): void {
    const surface = this.overlaySurface;
    if (!surface) return;
    const eng = this.engine;
    const area = this.overlayArea;
    if (!area || !eng.view) {
      const ctx = this.overlayCtx!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, eng.artboard.w, eng.artboard.h);
      this.paintToolOverlays(eng, ctx);
      eng.drawActiveShapeHandles(ctx);
      eng.drawLoupeIfAny(ctx);
      return;
    }
    const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
    const cssWidth = Math.max(1, area?.clientWidth ?? eng.artboard.w);
    const cssHeight = Math.max(1, area?.clientHeight ?? eng.artboard.h);
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (surface.width !== pixelWidth || surface.height !== pixelHeight) {
      surface.width = pixelWidth;
      surface.height = pixelHeight;
      this.overlayCtx = surface.getContext('2d')!;
    }
    const ctx = this.overlayCtx!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);

    const displayScale = eng.view.displayScale();
    const cos = Math.cos(eng.view.rot);
    const sin = Math.sin(eng.view.rot);
    const a = cos * displayScale * dpr;
    const b = sin * displayScale * dpr;
    const c = -sin * displayScale * dpr;
    const d = cos * displayScale * dpr;
    const centerX = (cssWidth / 2 + eng.view.x) * dpr;
    const centerY = (cssHeight / 2 + eng.view.y) * dpr;
    ctx.setTransform(
      a, b, c, d,
      centerX - a * eng.artboard.w / 2 - c * eng.artboard.h / 2,
      centerY - b * eng.artboard.w / 2 - d * eng.artboard.h / 2,
    );
    ctx.save();
    if (eng.bins?.activeId) {
      ctx.strokeStyle = '#9aa4b2'; ctx.lineWidth = 1 / (displayScale * dpr);
      ctx.setLineDash([6 / displayScale, 4 / displayScale]);
      ctx.strokeRect(0, 0, eng.artboard.w, eng.artboard.h); ctx.setLineDash([]);
      const view = ctx.getTransform();
      const matrix: Homography = [view.a, view.c, view.e, view.b, view.d, view.f, 0, 0, 1];
      const result = this.renderTransformed({x: 0, y: 0, w: pixelWidth, h: pixelHeight}, eng.getRootLayerIds(), matrix, null, true);
      ctx.save(); ctx.resetTransform(); ctx.drawImage(result.art.canvas, 0, 0); ctx.restore(); result.art.release();
    } else {
      ctx.beginPath(); ctx.rect(0, 0, eng.artboard.w, eng.artboard.h); ctx.clip();
    }
    this.paintToolOverlays(eng, ctx);
    eng.drawActiveShapeHandles(ctx);
    eng.drawLoupeIfAny(ctx);
    ctx.restore();
  }

  private paintToolOverlays(eng: PaintEngine, ctx: CanvasRenderingContext2D): void {
    if (eng.drawToolOverlays) eng.drawToolOverlays(ctx);
    else eng.activeTool().drawOverlay?.(ctx);
  }

  rasterBefore: import('../raster/SparseRaster').SparseRasterSnapshot | null = null;
  captureBefore(layer: RasterLayer): void {
    this.rasterBefore = layer.runtime.surface.snapshot();
  }

  restoreBefore(layer: RasterLayer, rect?: DirtyRect): void {
    if (this.rasterBefore) layer.runtime.surface.restore(this.rasterBefore);
    this.engine.links?.resolveLayer(layer);
    this.engine.bumpLayer(layer.id, rect);
  }

  bakeLayerOnto(target: RasterLayer, source: Layer): void {
    const handler = layerHandler(source);
    const env = this.drawEnv(false);
    if (handler.renderer.effect) {
      const placement = rasterToScope(target, env.ppi), undoPlacement = inverse(placement);
      if (!undoPlacement) return;
      const frame = source.type === 'outline' ? layoutMatrixPixels(source.state, env.ppi) : IDENTITY;
      const undoFrame = inverse(frame); if (!undoFrame) return;
      const padding = handler.renderer.effect.paddingPx?.(source as never, env) ?? 0;
      const nativeToEffect = multiply(undoFrame, placement), effectToNative = multiply(undoPlacement, frame);
      const destinations = new Set<string>();
      for (const key of target.runtime.surface.snapshot().tiles.keys()) {
        const [x, y] = key.split(',').map(Number);
        const local = transformBounds(nativeToEffect, {x:x*256, y:y*256, w:256, h:256});
        if (!local) continue;
        const affected = transformBounds(effectToNative, {x:local.x-padding, y:local.y-padding, w:local.w+padding*2, h:local.h+padding*2});
        if (!affected) continue;
        for (let ty=Math.floor(affected.y/256); ty<Math.ceil((affected.y+affected.h)/256); ty++) {
          for (let tx=Math.floor(affected.x/256); tx<Math.ceil((affected.x+affected.w)/256); tx++) destinations.add(`${tx},${ty}`);
        }
      }
      const original = target.runtime.surface;
      const result = new RasterSurface(original.intrinsicPpi, {...original.snapshot(), tiles:new Map()});
      {
        for (const key of destinations) {
          const [x,y]=key.split(',').map(Number), region={x:x*256,y:y*256,w:256,h:256};
          const rendered=this.renderTransformed(region,[target.id,source.id],undoPlacement,null,false).art;
          try {result.paint(region, ctx=>ctx.drawImage(rendered.canvas,region.x,region.y));} finally {rendered.release();}
        }
      }
      original.restore(result.snapshot());
      return;
    }
    handler.renderer.bakeOnto(target, source, env);
  }
}
