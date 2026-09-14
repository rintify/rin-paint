import { layerHandler } from '../layer-types/registry';
import type { CanvasLease, LayerDrawEnv } from '../layer-types/types';
import type { Layer } from '../layers';
import type { PaintEngine } from '../PaintEngine';
import type { PixelRect as RenderRect } from '../raster/geometry';
export interface LayerHitCapture {
  layerId: string;
  contribution: CanvasLease | null;
  target: HTMLCanvasElement | null;
}
interface RegionHost {
  engine: PaintEngine;
  borrowCanvas(width: number, height: number): CanvasLease;
  drawEnv(
    tools: boolean,
    width: number,
    height: number,
    x: number,
    y: number,
  ): LayerDrawEnv;
  sequenceVisibleBounds(ids: string[]): RenderRect | null;
}
function intersectBounds(
  a: RenderRect | null,
  b: RenderRect,
): RenderRect | null {
  if (!a) return null;
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w),
    bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}

function mixRevision(current: number, token: string | number): number {
  const value = String(token);
  let hash = current >>> 0;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export class RegionRenderer {
  constructor(private host: RegionHost) {}
  render(
    region: RenderRect,
    included: Set<string> | null,
    drawToolOverlay: boolean,
    capture?: { effectId: string; contribution: CanvasLease | null },
    hit?: LayerHitCapture,
    inputCapture?: { effectId: string; result: CanvasLease | null },
  ): CanvasLease {
    const eng = this.host.engine;
    // The contenteditable text is the synchronous on-canvas preview while typing.
    // Omitting its asynchronously rasterized copy keeps the visible glyphs and
    // the browser caret on the same DOM layout.
    const editingTextId = drawToolOverlay
      ? (eng.getTextEditingId?.() ?? null)
      : null;
    const art = this.host.borrowCanvas(region.w, region.h);
    const artCtx = art.ctx;
    artCtx.save();
    artCtx.setTransform(1, 0, 0, 1, 0, 0);
    artCtx.globalAlpha = 1;
    artCtx.globalCompositeOperation = 'source-over';
    artCtx.filter = 'none';
    artCtx.restore();
    const env = this.host.drawEnv(
      drawToolOverlay,
      region.w,
      region.h,
      region.x,
      region.y,
    );
    const participates = (layer: Layer) =>
      layer.visible &&
      !(layer.type === 'text' && layer.id === editingTextId) &&
      (included === null || included.has(layer.id));
    const activeEffectInChain = (layer: Layer): boolean => {
      if (!layerHandler(layer).renderer.effect) return false;
      if (
        participates(layer) ||
        capture?.effectId === layer.id ||
        hit?.layerId === layer.id
      )
        return true;
      return layer.childIds.some((id) => {
        const child = eng.layerById(id);
        return !!child && activeEffectInChain(child);
      });
    };
    const resetTarget = (target: CanvasRenderingContext2D) => {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = 1;
      target.globalCompositeOperation = 'source-over';
      target.filter = 'none';
    };
    const effectScope = (
      canvas: HTMLCanvasElement,
      inputRevision: number,
      activeRegion: RenderRect,
    ) => ({
      canvas,
      coverage: canvas,
      x: activeRegion.x,
      y: activeRegion.y,
      width: activeRegion.w,
      height: activeRegion.h,
      inputRevision,
    });
    const drawLayer = (
      target: CanvasRenderingContext2D,
      layer: Layer,
      activeRegion: RenderRect,
      activeEnv: LayerDrawEnv,
    ) => {
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
      const own = this.host.borrowCanvas(region.w, region.h);
      drawLayer(own.ctx, layer, region, env);
      hit.contribution = own;
      hit.target = targetCanvas;
    };
    const captureDifference = (
      targetCanvas: HTMLCanvasElement,
      before: CanvasLease,
    ) => {
      const contribution = this.host.borrowCanvas(region.w, region.h);
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
      for (const id of ids) {
        const layer = eng.layerById(id);
        if (!layer) continue;
        const handler = layerHandler(layer);
        if (handler.renderer.effect) {
          if (inputCapture?.effectId === layer.id) {
            inputCapture.result = this.host.borrowCanvas(region.w, region.h);
            inputCapture.result.ctx.drawImage(
              targetCanvas,
              activeRegion.x - region.x,
              activeRegion.y - region.y,
            );
            return true;
          }
          const capturingEyedropper = capture?.effectId === layer.id;
          const capturingHitEffect =
            !!hit &&
            hit.layerId === layer.id &&
            !!handler.renderer.effect.clickableAddedPixels;
          if (
            participates(layer) ||
            capturingEyedropper ||
            capturingHitEffect
          ) {
            const capturingDifference =
              capturingEyedropper || capturingHitEffect;
            const before = capturingDifference
              ? this.host.borrowCanvas(region.w, region.h)
              : null;
            before?.ctx.drawImage(targetCanvas, 0, 0);
            handler.renderer.effect.apply(
              effectScope(targetCanvas, state.revision, activeRegion),
              layer,
              activeEnv,
            );
            resetTarget(target);
            state.revision = mixRevision(
              state.revision,
              `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`,
            );
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
          if (
            renderSequence(
              layer.childIds,
              target,
              targetCanvas,
              state,
              activeRegion,
              activeEnv,
            )
          )
            return true;
          continue;
        }

        const hasActiveDirectEffect = layer.childIds.some((childId) => {
          const child = eng.layerById(childId);
          return !!child && activeEffectInChain(child);
        });
        if (hasActiveDirectEffect) {
          const measured =
            !capture && !hit && !inputCapture
              ? this.host.sequenceVisibleBounds([layer.id])
              : null;
          const clipped = measured
            ? intersectBounds(measured, activeRegion)
            : activeRegion;
          if (!clipped) continue;
          const localRegion = {
            x: Math.floor(clipped.x),
            y: Math.floor(clipped.y),
            w: Math.max(
              1,
              Math.ceil(clipped.x + clipped.w) - Math.floor(clipped.x),
            ),
            h: Math.max(
              1,
              Math.ceil(clipped.y + clipped.h) - Math.floor(clipped.y),
            ),
          };
          const localEnv =
            localRegion.x === activeRegion.x &&
            localRegion.y === activeRegion.y &&
            localRegion.w === activeRegion.w &&
            localRegion.h === activeRegion.h
              ? activeEnv
              : this.host.drawEnv(
                  drawToolOverlay,
                  localRegion.w,
                  localRegion.h,
                  localRegion.x,
                  localRegion.y,
                );
          const localState = {
            revision: mixRevision(
              2166136261,
              `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`,
            ),
          };
          const scope = this.host.borrowCanvas(localRegion.w, localRegion.h);
          const local = scope.ctx;
          local.save();
          local.setTransform(1, 0, 0, 1, 0, 0);
          resetTarget(local);
          if (participates(layer)) {
            captureContent(scope.canvas, layer);
            drawLayer(local, layer, localRegion, localEnv);
          }
          const stopped = renderSequence(
            layer.childIds,
            local,
            scope.canvas,
            localState,
            localRegion,
            localEnv,
          );
          local.restore();
          if (stopped) {
            scope.release();
            return true;
          }
          target.save();
          resetTarget(target);
          target.drawImage(
            local.canvas,
            localRegion.x - activeRegion.x,
            localRegion.y - activeRegion.y,
          );
          target.restore();
          if (hit?.target === scope.canvas) hit.target = targetCanvas;
          scope.release();
          state.revision = mixRevision(state.revision, localState.revision);
          continue;
        }
        if (participates(layer)) {
          captureContent(targetCanvas, layer);
          drawLayer(target, layer, activeRegion, activeEnv);
          state.revision = mixRevision(
            state.revision,
            `${layer.id}:${eng.getRenderRevision?.(layer.id) ?? 0}`,
          );
        }
        if (
          renderSequence(
            layer.childIds,
            target,
            targetCanvas,
            state,
            activeRegion,
            activeEnv,
          )
        )
          return true;
      }
      return false;
    };
    const inclusionKey = included ? [...included].sort().join(',') : 'all';
    const initialRevision = mixRevision(
      2166136261,
      `${inclusionKey}:${drawToolOverlay ? 'tool' : 'plain'}`,
    );
    renderSequence(
      eng.getRootLayerIds(),
      artCtx,
      art.canvas,
      { revision: initialRevision },
      region,
      env,
    );

    return art;
  }
}
