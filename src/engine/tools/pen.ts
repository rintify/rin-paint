import { useStore } from '../../state/store';
import {
  normalizePenDetailSettings,
  TRANSPARENT,
  type PenDetailSettings,
  type StrokePoint,
} from '../../types';
import { emptyRect, expandRect, stampSegment, type DirtyRect } from '../brush';
import type { RasterLayer } from '../layers';
import type { PaintEngine } from '../PaintEngine';
import type { Tool } from './types';

interface RecordedPoint extends StrokePoint {
  /** ストローク始端からの累積距離 */
  distance: number;
}

export class PenTool implements Tool {
  private layer: RasterLayer | null = null;
  private lastX = 0;
  private lastY = 0;
  private lastR = 0;
  private press = 0.5;
  private size = 10;
  private color = '#000';
  private settings: PenDetailSettings = normalizePenDetailSettings(undefined);
  /** 透明色ストローク (destination-out で消す) */
  private erase = false;
  private rect: DirtyRect = emptyRect();
  private points: RecordedPoint[] = [];
  private totalDistance = 0;

  constructor(private engine: PaintEngine) {}

  /** 補正量 0 なら入力をそのまま、100 なら緩やかに追従する。 */
  private stabilizePressure(pressure: number, first: boolean): number {
    if (first) {
      this.press = pressure;
    } else {
      const alpha = Math.max(
        0.05,
        1 - this.settings.pressureStabilization / 100,
      );
      this.press += (pressure - this.press) * alpha;
    }
    return this.press;
  }

  /**
   * 入り・抜きの値を、ペン径に比例したテーパー距離へ変換する。
   * 100 でペン径10個分かけて細くする。
   */
  private taperDistance(amount: number): number {
    return this.size * amount * 0.1;
  }

  private taperFactor(distance: number, remaining?: number): number {
    let factor = 1;
    const inDistance = this.taperDistance(this.settings.taperIn);
    if (inDistance > 0) factor = Math.min(factor, distance / inDistance);
    if (remaining !== undefined) {
      const outDistance = this.taperDistance(this.settings.taperOut);
      if (outDistance > 0) factor = Math.min(factor, remaining / outDistance);
    }
    const clamped = Math.max(0, Math.min(1, factor));
    // 端で急に太さが変わらない smoothstep
    return clamped * clamped * (3 - 2 * clamped);
  }

  private radius(pressure: number, taper: number, first: boolean): number {
    const stabilized = this.stabilizePressure(pressure, first);
    const pressureRadius = this.size * 0.5 * (0.12 + 0.88 * stabilized);
    return Math.max(0.35, pressureRadius * taper);
  }

  onDown(p: StrokePoint): void {
    const layer = this.engine.activeRaster();
    if (!layer) return;
    this.layer = layer;
    this.engine.captureBefore(layer);
    const st = useStore.getState();
    const instance = st.tools.find((tool) => tool.id === st.activeToolId);
    this.size = st.penSize;
    this.color = st.penColor;
    this.settings = normalizePenDetailSettings(instance?.penSettings);
    this.erase = st.penColor === TRANSPARENT;
    this.rect = emptyRect();
    this.points = [{ ...p, distance: 0 }];
    this.totalDistance = 0;

    const r = this.radius(p.pressure, this.taperFactor(0), true);
    stampSegment(layer.ctx, p.x, p.y, r, p.x, p.y, r, this.color, this.erase);
    expandRect(this.rect, p.x, p.y, r + 2);
    this.lastX = p.x;
    this.lastY = p.y;
    this.lastR = r;
    this.engine.requestRender();
  }

  onMove(p: StrokePoint): void {
    if (!this.layer) return;
    const segmentDistance = Math.hypot(p.x - this.lastX, p.y - this.lastY);
    this.totalDistance += segmentDistance;
    this.points.push({ ...p, distance: this.totalDistance });
    const r = this.radius(
      p.pressure,
      this.taperFactor(this.totalDistance),
      false,
    );
    stampSegment(
      this.layer.ctx,
      this.lastX,
      this.lastY,
      this.lastR,
      p.x,
      p.y,
      r,
      this.color,
      this.erase,
    );
    expandRect(this.rect, this.lastX, this.lastY, this.lastR + 2);
    expandRect(this.rect, p.x, p.y, r + 2);
    this.lastX = p.x;
    this.lastY = p.y;
    this.lastR = r;
    this.engine.requestRender();
  }

  onUp(p: StrokePoint): void {
    if (!this.layer) return;
    if (Math.hypot(p.x - this.lastX, p.y - this.lastY) > 0.01) {
      this.onMove(p);
    }
    // 抜きは終点が確定して初めて長さを計算できるため、確定時に再描画する。
    if (this.settings.taperOut > 0) this.repaintWithTaperOut();
    this.engine.commitRasterEdit(
      this.layer,
      this.rect,
      this.erase ? '透明ペン' : 'ペン',
    );
    useStore.getState().pushColor(this.color);
    this.layer = null;
    this.points = [];
  }

  cancel(): void {
    if (!this.layer) return;
    this.engine.restoreBefore(this.layer);
    this.layer = null;
    this.points = [];
    this.engine.requestRender();
  }

  private repaintWithTaperOut(): void {
    const layer = this.layer!;
    this.engine.restoreBefore(layer);
    this.rect = emptyRect();
    this.press = this.points[0]?.pressure ?? 0.5;
    let prev: RecordedPoint | null = null;
    let prevR = 0;

    for (let i = 0; i < this.points.length; i++) {
      const point = this.points[i];
      const taper = this.taperFactor(
        point.distance,
        this.totalDistance - point.distance,
      );
      const r = this.radius(point.pressure, taper, i === 0);
      if (prev) {
        stampSegment(
          layer.ctx,
          prev.x,
          prev.y,
          prevR,
          point.x,
          point.y,
          r,
          this.color,
          this.erase,
        );
        expandRect(this.rect, prev.x, prev.y, prevR + 2);
      } else {
        stampSegment(
          layer.ctx,
          point.x,
          point.y,
          r,
          point.x,
          point.y,
          r,
          this.color,
          this.erase,
        );
      }
      expandRect(this.rect, point.x, point.y, r + 2);
      prev = point;
      prevR = r;
    }
    this.engine.requestRender();
  }
}
