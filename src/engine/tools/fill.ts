import type { StrokePoint } from '../../model';
import type { Tool, ToolContext } from './types';

export class FillTool implements Tool {
  constructor(private ctx: ToolContext) {}
  onDown(): void {}
  onMove(): void {}
  onUp(point: StrokePoint): void { this.ctx.fillAt(point); }
}
