import { RasterTransformPreview } from './RasterTransformPreview';
import { RasterWarpMesh } from './RasterWarpMesh';
import { FloatSelection } from '../../tools/transform/floatSelection';
import type { PaintEngine } from '../PaintEngine';
import { ContourIndex } from './ContourIndex';
import { drawShape } from '../shapes';
// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { createCanvas, loadImage, Path2D, type Canvas } from '@napi-rs/canvas';
import { Blob as NodeBlob } from 'node:buffer';
import { RasterSurface, RasterEditSession } from './RasterSurface';
import { RasterResampler } from './RasterResampler';
import { RasterSelectionContent } from './RasterSelectionContent';
import {
  assetBlobs,
  getAsset,
  rasterStats,
  releaseUnusedCanvases,
} from './RasterAssetRepository';
import { createRasterLayer } from '../layers';
import { stampRasterSegment } from '../brush';
import {
  savePage,
  loadPage,
  replaceProject,
  collectUnusedRasterAssets,
  saveClipboard,
  loadClipboard,
} from '../persistence/db';
import { HistoryTree } from '../history/historyTree';
import { PROJECT_VERSION, CLIPBOARD_VERSION } from '../persistence/version';
import { packProjectFile, unpackProjectFile } from '../persistence/projectFile';
import { traceSparseAlphaContours } from '../layer-types/effectUtils';
const native = new WeakMap<HTMLCanvasElement, Canvas>();
function backing(c: HTMLCanvasElement): Canvas {
  let n = native.get(c);
  if (!n) {
    n = createCanvas(c.width, c.height);
    native.set(c, n);
  }
  if (n.width !== c.width) n.width = c.width;
  if (n.height !== c.height) n.height = c.height;
  return n;
}
beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('Path2D', Path2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      const node = this,
        ctx = backing(node).getContext('2d');
      return new Proxy(ctx, {
        get(t, k) {
          if (k === 'canvas') return node;
          if (k === 'drawImage')
            return (source: HTMLCanvasElement | Canvas, ...args: number[]) =>
              (t.drawImage as Function)(
                source instanceof HTMLCanvasElement ? backing(source) : source,
                ...args,
              );
          const v = Reflect.get(t, k, t);
          return typeof v === 'function' ? v.bind(t) : v;
        },
        set(t, k, v) {
          return Reflect.set(t, k, v, t);
        },
      }) as unknown as CanvasRenderingContext2D;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    void backing(this)
      .encode('png')
      .then((b) => cb(new Blob([new Uint8Array(b)])));
  });
  vi.stubGlobal('createImageBitmap', async (blob: Blob) =>
    Object.assign(await loadImage(new Uint8Array(await blob.arrayBuffer())), {
      close() {},
    }),
  );
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const read = (s: RasterSurface, x: number, y: number) => [
  ...s.readRegion({ x, y, w: 1, h: 1 }).data,
];
function dot(s: RasterSurface, x: number, y: number, color = '#ff0000') {
  const edit = new RasterEditSession(s);
  edit.mutateRegion({ x, y, w: 1, h: 1 }, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  });
  return edit.commit();
}
const rectCorners = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
describe('sparse raster storage and transactions', () => {
  it.each([
    [0.73, 0, 1],
    [1.37, 0, 1],
    [2.1, 0.23, 0.6],
    [0.31, -0.4, 0.6],
    [1, 0, 0.6],
  ])('draws continuous tile boundaries at scale %s and angle %s', (scale, angle, opacity) => {
    const source = new RasterSurface();
    const edit = new RasterEditSession(source);
    const region = { x: -512, y: -512, w: 1024, h: 1024 };
    const paint = (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'rgba(230,40,20,0.5)';
      ctx.fillRect(-400, -400, 800, 800);
      ctx.fillStyle = '#222222';
      ctx.fillRect(-300, -30, 600, 60);
      ctx.strokeStyle = '#ee493c';
      ctx.lineWidth = 47;
      ctx.beginPath();
      ctx.moveTo(-350, -300);
      ctx.lineTo(300, 350);
      ctx.stroke();
    };
    edit.mutateRegion(region, paint);
    edit.commit();
    const whole = document.createElement('canvas');
    whole.width = whole.height = 1024;
    whole.getContext('2d')!.putImageData(source.readRegion(region), 0, 0);
    const render = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 900;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#9fb7cf';
      ctx.fillRect(0, 0, 900, 900);
      ctx.translate(450.3, 449.7);
      ctx.rotate(angle);
      ctx.scale(scale, scale);
      ctx.globalAlpha = opacity;
      draw(ctx);
      return ctx.getImageData(0, 0, 900, 900).data;
    };
    const actual = render(ctx => source.drawRegion(ctx, region));
    const expected = render(ctx => ctx.drawImage(whole, -512, -512));
    let maxError = 0;
    for (let i = 0; i < actual.length; i++)
      maxError = Math.max(maxError, Math.abs(actual[i] - expected[i]));
    expect(maxError).toBeLessThanOrEqual(1);
  });

  it('shares fully selected tiles without copying pixels and cancels exactly', () => {
    const source = new RasterSurface();
    dot(source, -257, -1);
    dot(source, 1000000, 1);
    const before = source.snapshot(),
      copies = rasterStats.copiedPixels;
    const edit = new RasterEditSession(source);
    const selection = RasterSelectionContent.extract(
      source,
      { x: -257, y: -1, w: 1000258, h: 3 },
      () => {
        throw new Error('unneeded clipping');
      },
      edit,
      true,
    );
    expect(source.tileCount).toBe(0);
    expect(selection.surface.snapshot()).toEqual(before);
    expect(rasterStats.copiedPixels).toBe(copies);
    edit.cancel();
    expect(source.snapshot()).toEqual(before);
  });

  it('previews integer moves without copying or resampling pixels', () => {
    const layer = createRasterLayer('move', 512, 512);
    dot(layer.runtime.surface, 100, 100);
    const engine = {
      selectedRasters: () => [layer],
      selectedObjectsInRect: () => [],
      bumpLayer: () => {},
      setSelectionState: () => {},
      requestOverlayRender: () => {},
      uiScale: () => 1,
    } as unknown as PaintEngine;
    const selection = new FloatSelection(engine, 'move');
    selection.extractFromRect({ minX: 0, minY: 0, maxX: 512, maxY: 512 });
    selection.beginDrag({ x: 250, y: 250, pressure: 1 });
    selection.dragTo({ x: 265.2, y: 239.8, pressure: 1 });
    const copies = rasterStats.copiedPixels,
      samples = rasterStats.sampledPixels;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    selection.drawAboveLayer(ctx, layer.id);
    expect([...ctx.getImageData(115, 90, 1, 1).data]).toEqual([255, 0, 0, 255]);
    expect(rasterStats.copiedPixels).toBe(copies);
    expect(rasterStats.sampledPixels).toBe(samples);
  });

  it('uses a direct inverse for affine transforms regardless of selection size', () => {
    const mesh = new RasterWarpMesh([
      { x: -10, y: 20 },
      { x: 3990, y: 3020 },
      { x: 990, y: 7020 },
      { x: -3010, y: 4020 },
    ]);
    expect(mesh.divisions).toBe(1);
    expect(mesh.sampler({ x: 0, y: 0, w: 4096, h: 4096 })(490, 3520)).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it('reuses transformed preview tiles and samples only screen resolution', () => {
    const source = new RasterSurface(),
      edit = new RasterEditSession(source);
    edit.mutateRegion({ x: 0, y: 0, w: 128, h: 128 }, (ctx) =>
      ctx.fillRect(0, 0, 128, 128),
    );
    edit.commit();
    const preview = new RasterTransformPreview(source, {
      x: 0,
      y: 0,
      w: 128,
      h: 128,
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const region = { x: 0, y: 0, w: 512, h: 512 },
      corners = rectCorners(0.4, 0.4, 512, 512);
    const count = rasterStats.sampledPixels,
      nativeBefore = rasterStats.nativeTransformedPixels;
    preview.draw(ctx, region, corners, 0.25);
    const sampled = rasterStats.sampledPixels - count;
    expect(sampled).toBe(0);
    const native = rasterStats.nativeTransformedPixels - nativeBefore;
    expect(native).toBeGreaterThan(0);
    expect(native).toBeLessThan(256 * 256);
    const before = [...ctx.getImageData(0, 0, 512, 512).data];
    ctx.clearRect(0, 0, 512, 512);
    preview.draw(ctx, region, corners, 0.25);
    expect(rasterStats.sampledPixels - count).toBe(sampled);
    expect(rasterStats.nativeTransformedPixels - nativeBefore).toBe(native);
    expect([...ctx.getImageData(0, 0, 512, 512).data]).toEqual(before);
  });

  it('matches native whole-image affine rendering across tile boundaries without CPU sampling', () => {
    const source = new RasterSurface(),
      edit = new RasterEditSession(source);
    const sourceRect = { x: -270, y: -60, w: 540, h: 160 };
    edit.mutateRegion(sourceRect, (ctx) => {
      ctx.fillStyle = 'rgba(210,30,60,0.5)';
      ctx.fillRect(-260, -50, 520, 140);
      ctx.fillStyle = 'rgba(0,180,240,0.8)';
      ctx.fillRect(-8, -60, 32, 160);
    });
    edit.commit();
    const whole = document.createElement('canvas');
    whole.width = sourceRect.w + 4;
    whole.height = sourceRect.h + 4;
    whole.getContext('2d')!.putImageData(source.readRegion(sourceRect), 2, 2);
    const output = { x: -512, y: -256, w: 1024, h: 512 };
    for (const angle of [0, 0.3, -0.75]) {
      const a = 1.3 * Math.cos(angle),
        b = 1.3 * Math.sin(angle),
        c = -b,
        d = a;
      const corners = rectCorners(
        sourceRect.x,
        sourceRect.y,
        sourceRect.w,
        sourceRect.h,
      ).map((p) => ({
        x: a * p.x + c * p.y + 0.25,
        y: b * p.x + d * p.y - 0.4,
      }));
      const result = new RasterSurface(),
        target = new RasterEditSession(result);
      const samples = rasterStats.sampledPixels,
        reads = rasterStats.sourceReadbackPixels;
      RasterResampler.draw(source, sourceRect, corners, target);
      expect(rasterStats.sampledPixels).toBe(samples);
      expect(rasterStats.sourceReadbackPixels).toBe(reads);
      const expected = document.createElement('canvas');
      expected.width = output.w;
      expected.height = output.h;
      const ctx = expected.getContext('2d')!;
      ctx.setTransform(
        a,
        b,
        c,
        d,
        a * (sourceRect.x - 2) + c * (sourceRect.y - 2) + 0.25 - output.x,
        b * (sourceRect.x - 2) + d * (sourceRect.y - 2) - 0.4 - output.y,
      );
      ctx.drawImage(whole, 0, 0);
      const actual = result.readRegion(output).data,
        reference = ctx.getImageData(0, 0, output.w, output.h).data;
      let maxAlphaError = 0,
        significant = 0;
      const mismatches: unknown[] = [];
      for (let i = 3; i < actual.length; i += 4) {
        const error = Math.abs(actual[i] - reference[i]);
        maxAlphaError = Math.max(maxAlphaError, error);
        if (error > 1) {
          significant++;
          if (mismatches.length < 12)
            mismatches.push({
              x: (((i - 3) / 4) % output.w) + output.x,
              y: Math.floor((i - 3) / 4 / output.w) + output.y,
              actual: actual[i],
              expected: reference[i],
            });
        }
      }
      expect(
        maxAlphaError,
        JSON.stringify({ angle, significant, mismatches }),
      ).toBeLessThanOrEqual(1);
      expect(significant).toBe(0);
    }
  });

  it('keeps the same warp geometry when preview resolution is reduced', () => {
    const corners = [
      { x: -100, y: -200 },
      { x: 1700, y: 40 },
      { x: 500, y: 800 },
      { x: 0, y: 300 },
    ];
    const full = new RasterWarpMesh(corners),
      scale = 0.125;
    const preview = new RasterWarpMesh(
      corners.map((p) => ({ x: p.x * scale, y: p.y * scale })),
      scale,
    );
    expect(preview.divisions).toBe(full.divisions);
    for (const u of [0, 0.13, 0.47, 0.91, 1])
      for (const v of [0, 0.21, 0.52, 0.88, 1]) {
        const expected = full.map(u, v),
          actual = preview.map(u, v);
        expect(actual.x).toBeCloseTo(expected.x * scale, 10);
        expect(actual.y).toBeCloseTo(expected.y * scale, 10);
      }
  });

  it('scanline warp coverage matches the edge-rule oracle for convex, concave and folded quads', () => {
    const rect = { x: -32, y: -32, w: 128, h: 128 };
    const quads = [
      [
        { x: 0, y: 0 },
        { x: 63, y: 9 },
        { x: 54, y: 65 },
        { x: -8, y: 58 },
      ],
      [
        { x: 0, y: 0 },
        { x: 64, y: 0 },
        { x: 16, y: 16 },
        { x: 0, y: 64 },
      ],
      [
        { x: 0, y: 0 },
        { x: 64, y: 64 },
        { x: 64, y: 0 },
        { x: 0, y: 64 },
      ],
      [
        { x: 64, y: 0 },
        { x: 0, y: 0 },
        { x: -8, y: 64 },
        { x: 63, y: 65 },
      ],
    ];
    for (const corners of quads) {
      const mesh = new RasterWarpMesh(corners),
        oracle = mesh.sampler(rect);
      const values = new Map<string, { x: number; y: number }>();
      mesh.forEachSpan(rect, (s) => {
        for (let x = s.x0; x < s.x1; x++)
          values.set(`${x},${s.y}`, {
            x: s.ux * (x + 0.5) + s.uy * (s.y + 0.5) + s.u0,
            y: s.vx * (x + 0.5) + s.vy * (s.y + 0.5) + s.v0,
          });
      });
      for (let y = rect.y; y < rect.y + rect.h; y++)
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          const expected = oracle(x + 0.5, y + 0.5),
            actual = values.get(`${x},${y}`);
          expect(!!actual).toBe(!!expected);
          if (actual && expected) {
            expect(actual.x).toBeCloseTo(expected.x, 10);
            expect(actual.y).toBeCloseTo(expected.y, 10);
          }
        }
    }
  });

  it('uses one mesh and one edge owner across clipped transform tiles', () => {
    const source = new RasterSurface(),
      input = new RasterEditSession(source);
    input.mutateRegion({ x: 0, y: 0, w: 64, h: 64 }, (ctx) => {
      ctx.fillStyle = 'rgba(255,0,0,0.5)';
      ctx.fillRect(0, 0, 64, 64);
    });
    input.commit();
    const corners = [
        { x: -30, y: 0 },
        { x: 310, y: 30 },
        { x: 280, y: 90 },
        { x: -20, y: 64 },
      ],
      rect = { x: 0, y: 0, w: 64, h: 64 };
    const full = new RasterSurface(),
      fullEdit = new RasterEditSession(full);
    RasterResampler.draw(source, rect, corners, fullEdit);
    fullEdit.commit();
    const split = new RasterSurface(),
      splitEdit = new RasterEditSession(split);
    for (const x of [-256, 0, 256])
      RasterResampler.draw(source, rect, corners, splitEdit, {
        x,
        y: 0,
        w: 256,
        h: 256,
      });
    splitEdit.commit();
    expect(split.readRegion({ x: -32, y: 0, w: 350, h: 100 }).data).toEqual(
      full.readRegion({ x: -32, y: 0, w: 350, h: 100 }).data,
    );
    for (const x of [254, 255, 256, 257])
      expect(read(full, x, 50)[3]).toBe(127);
  });
  it('retains immutable pixels after a failed PNG encode and retries', async () => {
    const surface = new RasterSurface();
    dot(surface, -1, 0);
    const snapshot = surface.snapshot();
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce((cb) =>
      cb(null),
    );
    await expect(assetBlobs(snapshot)).rejects.toThrow();
    expect(read(surface, -1, 0)).toEqual([255, 0, 0, 255]);
    expect(Object.keys(await assetBlobs(snapshot))).toHaveLength(1);
  });
  it('rolls back every touched tile when a drawing callback fails', () => {
    const surface = new RasterSurface();
    dot(surface, -1, 0);
    const before = surface.snapshot();
    const edit = new RasterEditSession(surface);
    expect(() =>
      edit.mutateRegion({ x: -1, y: 0, w: 258, h: 1 }, (ctx, r) => {
        ctx.fillRect(r.x, 0, 256, 1);
        if (r.x === 256) throw new Error('allocation');
      }),
    ).toThrow('allocation');
    expect(surface.snapshot()).toEqual(before);
    expect(read(surface, -1, 0)).toEqual([255, 0, 0, 255]);
  });
  it('keeps outside shape fill finite and preserves existing off-paper pixels', () => {
    const surface = new RasterSurface();
    dot(surface, -5, -5);
    const edit = new RasterEditSession(surface);
    edit.mutateRegion({ x: -16, y: -16, w: 64, h: 64 }, (ctx) =>
      drawShape(
        ctx,
        {
          kind: 'rect',
          x: -10,
          y: -10,
          width: 20,
          height: 20,
          color: '#00ff00',
          strokeWidth: 0,
          paintMode: 'fill-outside',
        },
        false,
        { w: 32, h: 32 },
      ),
    );
    edit.commit();
    expect(read(surface, -5, -5)).toEqual([255, 0, 0, 255]);
    expect(read(surface, 20, 20)).toEqual([0, 255, 0, 255]);
    expect(read(surface, 33, 20)[3]).toBe(0);
  });
  it('queries contour segments without enumerating distant empty tiles', () => {
    const contours = Array.from({ length: 1000 }, (_, i) => {
      const x = i * 1000000;
      return [
        { x, y: 0 },
        { x: x + 10, y: 0 },
        { x: x + 10, y: 10 },
        { x, y: 10 },
      ];
    });
    const index = new ContourIndex(contours);
    expect([...index.query({ x: 999000000, y: 0, w: 10, h: 10 })]).toHaveLength(
      4,
    );
    expect([...index.query({ x: 500000, y: 0, w: 10, h: 10 })]).toHaveLength(0);
  });
  it('encodes a frozen version while a new edit changes the same tile', async () => {
    const surface = new RasterSurface();
    dot(surface, 0, 0);
    const snapshot = surface.snapshot();
    let release!: () => void;
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(
      function (this: HTMLCanvasElement, cb) {
        release = () => {
          void backing(this)
            .encode('png')
            .then((b) => cb(new Blob([new Uint8Array(b)])));
        };
      },
    );
    const pending = assetBlobs(snapshot);
    dot(surface, 0, 0, '#0000ff');
    release();
    await pending;
    const restored = await RasterSurface.restore(snapshot);
    expect(read(restored, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(read(surface, 0, 0)).toEqual([0, 0, 255, 255]);
  });
  it('evicts old decoded history tiles while pinning active pixels', async () => {
    const a = new RasterSurface(),
      b = new RasterSurface(),
      active = new RasterSurface();
    dot(a, 0, 0);
    dot(b, 0, 0);
    dot(active, 0, 0);
    const snapshots = [a.snapshot(), b.snapshot(), active.snapshot()];
    await assetBlobs(snapshots);
    const ids = snapshots.map((s) => s.tiles[0].assetId);
    getAsset(ids[0]);
    getAsset(ids[1]);
    releaseUnusedCanvases(new Set([ids[2]]), 256 * 256 * 4);
    expect(a.get(0, 0)!.canvas).toBeUndefined();
    expect(b.get(0, 0)!.canvas).toBeDefined();
    expect(active.get(0, 0)!.canvas).toBeDefined();
    expect(read(await RasterSurface.restore(snapshots[0]), 0, 0)).toEqual([
      255, 0, 0, 255,
    ]);
  });
  it('allocates no pixel buffers for 100 empty layers', () => {
    expect(
      Array.from({ length: 100 }, () =>
        createRasterLayer('empty', 4096, 4096),
      ).reduce((n, l) => n + l.runtime.surface.tileCount, 0),
    ).toBe(0);
  });
  it('reads and restores negative tile coordinates and the origin', async () => {
    const s = new RasterSurface();
    for (const x of [-257, -256, -1, 0, 255, 256]) {
      const change = dot(s, x, x);
      expect(read(s, x, x)).toEqual([255, 0, 0, 255]);
      await s.apply(change.tiles, 'before');
      expect(read(s, x, x)[3]).toBe(0);
      await s.apply(change.tiles, 'after');
      expect(read(s, x, x)[3]).toBe(255);
    }
  });
  it('does not allocate the gap between distant pixels and copies only touched tiles', () => {
    const s = new RasterSurface();
    dot(s, 20, 20);
    dot(s, 1_000_020, 20);
    expect(s.tileCount).toBe(2);
    const before = rasterStats.copiedPixels;
    dot(s, 21, 20);
    expect(rasterStats.copiedPixels - before).toBe(256 * 256);
    expect(s.tileCount).toBe(2);
  });
  it('shares snapshots without editing their pixels and removes fully erased tiles', async () => {
    const s = new RasterSurface();
    dot(s, -1, -1);
    const copy = s.clone(),
      id = s.snapshot().tiles[0].assetId;
    const edit = new RasterEditSession(s);
    edit.mutateRegion({ x: -1, y: -1, w: 1, h: 1 }, (ctx) =>
      ctx.clearRect(-1, -1, 1, 1),
    );
    const change = edit.commit();
    expect(s.tileCount).toBe(0);
    expect(read(copy, -1, -1)[3]).toBe(255);
    expect(change.tiles[0]).toMatchObject({
      tx: -1,
      ty: -1,
      before: id,
      after: null,
    });
    await s.apply(change.tiles, 'before');
    expect(read(s, -1, -1)[3]).toBe(255);
  });
  it('cancels created tiles and resets the before image for taper repaint', () => {
    const s = new RasterSurface();
    dot(s, 0, 0);
    const edit = new RasterEditSession(s);
    edit.mutateRegion({ x: -1, y: -1, w: 2, h: 2 }, (ctx) => {
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(-1, -1, 2, 2);
    });
    edit.resetToBefore();
    expect(s.tileCount).toBe(1);
    expect(read(s, 0, 0)).toEqual([255, 0, 0, 255]);
    edit.mutateRegion({ x: 0, y: 0, w: 1, h: 1 }, (ctx) =>
      ctx.clearRect(0, 0, 1, 1),
    );
    edit.cancel();
    expect(read(s, 0, 0)[3]).toBe(255);
  });
  it('keeps empty erasing sparse and draws a diagonal through only touched tiles', () => {
    const s = new RasterSurface(),
      edit = new RasterEditSession(s);
    stampRasterSegment(edit, -100, -100, 3, 100, 100, 3, 'transparent', true);
    expect(edit.commit().tiles).toHaveLength(0);
    const draw = new RasterEditSession(s);
    stampRasterSegment(draw, -600, -600, 2, 600, 600, 2, '#ff0000', false);
    draw.commit();
    expect(s.tileCount).toBeLessThan(20);
    expect(read(s, 0, 0)[3]).toBe(255);
  });
  it('checks world bounds before writing', () => {
    const s = new RasterSurface(),
      edit = new RasterEditSession(s);
    expect(() =>
      edit.mutateRegion({ x: 2 ** 30, y: 0, w: 1, h: 1 }, () => {}),
    ).toThrow();
    expect(s.tileCount).toBe(0);
  });
  it('preserves neighboring off-paper pixels on region replacement', () => {
    const s = new RasterSurface();
    dot(s, 99, 20);
    dot(s, 100, 20);
    const image = s.readRegion({ x: 99, y: 20, w: 1, h: 1 });
    image.data.fill(0);
    const edit = new RasterEditSession(s);
    edit.replaceRegion({ x: 99, y: 20, w: 1, h: 1 }, image);
    edit.commit();
    expect(read(s, 99, 20)[3]).toBe(0);
    expect(read(s, 100, 20)[3]).toBe(255);
  });
});
describe('sparse selection and resampling', () => {
  it('moves isolated pixels a million pixels away without allocating a bounding image', () => {
    const s = new RasterSurface();
    dot(s, 0, 0);
    dot(s, 1_000_000, 0);
    const target = new RasterSurface(),
      edit = new RasterEditSession(target),
      r = s.getContentBounds()!;
    RasterResampler.draw(
      s,
      r,
      rectCorners(r.x - 500, r.y - 500, r.w, r.h),
      edit,
    );
    edit.commit();
    expect(target.tileCount).toBe(2);
    expect(read(target, -500, -500)[3]).toBe(255);
    expect(read(target, 999500, -500)[3]).toBe(255);
  });
  it('selects a single negative pixel and restores it on cancellation', () => {
    const s = new RasterSurface();
    dot(s, -1, -1);
    const edit = new RasterEditSession(s),
      r = { x: -1, y: -1, w: 1, h: 1 };
    const c = RasterSelectionContent.extract(
      s,
      r,
      (ctx) => {
        ctx.beginPath();
        ctx.rect(-1, -1, 1, 1);
      },
      edit,
    );
    expect(read(c.surface, -1, -1)[3]).toBe(255);
    expect(read(s, -1, -1)[3]).toBe(0);
    edit.cancel();
    expect(read(s, -1, -1)[3]).toBe(255);
  });
  it('scales across a tile seam with consistent alpha and keeps negative content', () => {
    const s = new RasterSurface(),
      edit = new RasterEditSession(s);
    edit.mutateRegion({ x: -2, y: -2, w: 260, h: 4 }, (ctx) => {
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(-2, -2, 260, 4);
    });
    edit.commit();
    const scaled = RasterResampler.scale(s, 2);
    for (const x of [-2, 0, 254, 255, 256, 257, 510, 511, 512])
      expect(read(scaled, x, 0)).toEqual([0, 255, 0, 255]);
  });
  it('joins sharp outlines across negative and positive tile boundaries', () => {
    const s = new RasterSurface(),
      edit = new RasterEditSession(s);
    edit.mutateRegion({ x: -300, y: -5, w: 600, h: 10 }, (ctx) =>
      ctx.fillRect(-300, -5, 600, 10),
    );
    edit.commit();
    const contours = traceSparseAlphaContours(s, 127);
    expect(contours).toHaveLength(1);
    expect(contours[0].length).toBeLessThan(15);
  });
});
describe('raster persistence', () => {
  it('encodes only changed versions and restores pixels from PNG assets', async () => {
    const s = new RasterSurface();
    dot(s, -1, 0);
    dot(s, 1000000, 0);
    const snapshot = s.snapshot(),
      before = rasterStats.encodedTiles;
    await assetBlobs(snapshot);
    expect(rasterStats.encodedTiles - before).toBe(2);
    await assetBlobs(snapshot);
    expect(rasterStats.encodedTiles - before).toBe(2);
    dot(s, 1000000, 1);
    await assetBlobs(s.snapshot());
    expect(rasterStats.encodedTiles - before).toBe(3);
    releaseUnusedCanvases(new Set(), 0);
    const restored = await RasterSurface.restore(snapshot);
    expect(read(restored, -1, 0)).toEqual([255, 0, 0, 255]);
    expect(read(restored, 1000000, 0)[3]).toBe(255);
    expect(read(restored, 1000000, 1)[3]).toBe(0);
  });
  it('roundtrips page, branches, project file and clipboard without losing external tiles', async () => {
    const surface = new RasterSurface(),
      a = dot(surface, -300, 10),
      history = new HistoryTree();
    history.push({ kind: 'raster', layerId: 'l', tiles: a.tiles }, 'a');
    const b = dot(surface, 1000000, 10);
    history.push({ kind: 'raster', layerId: 'l', tiles: b.tiles }, 'b');
    history.undo();
    await surface.apply(b.tiles, 'before');
    const c = dot(surface, -500, 10);
    history.push({ kind: 'raster', layerId: 'l', tiles: c.tiles }, 'c');
    const layer = {
      id: 'l',
      type: 'raster' as const,
      common: {
        name: 'layer',
        opacity: 1,
        blend: 'source-over' as const,
        visible: true,
        parentId: null,
        childIds: [],
      },
      state: {},
      content: surface.snapshot(),
    };
    const page = {
      id: 'p',
      pageSpec: { widthMm: 10, heightMm: 10, ppi: 300 },
      layers: [layer],
      rootLayerIds: ['l'],
      activeLayerId: 'l',
      history: await history.serialize(async () => new Blob()),
      view: { x: 0, y: 0, scale: 1, rot: 0 },
      thumbnailVersion: 0,
    };
    const meta = {
      version: PROJECT_VERSION,
      pageOrder: ['p'],
      activePageId: 'p',
      fonts: [],
    };
    await replaceProject(meta, [page]);
    await savePage(page, meta);
    const loaded = (await loadPage('p'))!;
    const content = loaded.layers[0].content;
    if (!content || content instanceof Blob)
      throw new Error('missing tiled content');
    const restored = await RasterSurface.restore(content);
    expect(read(restored, -300, 10)[3]).toBe(255);
    expect(read(restored, -500, 10)[3]).toBe(255);
    const h = new HistoryTree();
    h.restore(loaded.history);
    h.undo();
    expect(h.current.children).toHaveLength(2);
    await saveClipboard({
      version: CLIPBOARD_VERSION,
      sourcePageId: 'p',
      sourcePageIndex: 0,
      sourcePpi: 300,
      rootIds: ['l'],
      layers: [layer],
    });
    await collectUnusedRasterAssets();
    expect((await loadClipboard())?.layers[0].content).toEqual(layer.content);
    const file = await packProjectFile({
      app: 'rin-paint',
      version: PROJECT_VERSION,
      meta,
      pages: [page],
    });
    const unpacked = await unpackProjectFile(file);
    expect(unpacked.pages[0].history.nodes).toHaveLength(4);
    expect(Object.keys(unpacked.rasterAssets!)).toHaveLength(3);
  });
});
