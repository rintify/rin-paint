import type { StrokePoint } from '../../model';
import type { PaintEngine } from '../../engine/PaintEngine';
import type { Tool } from '../types';

export class FillTool implements Tool {
  constructor(private eng: PaintEngine) {}

  onDown(): void {}
  onMove(): void {}
  onUp(point: StrokePoint): void {
    void this.eng.fill.start(point);
  }
}
