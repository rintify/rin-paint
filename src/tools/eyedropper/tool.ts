import type { StrokePoint } from '../../model';
import type { PaintEngine } from '../../engine/PaintEngine';
import type { Tool } from '../types';
import { normalizeEyedropperToolSettings } from './settings';

export class EyedropperTool implements Tool {
  readonly startsImmediately = true;

  constructor(private engine: PaintEngine) {}

  onDown(point: StrokePoint, event: PointerEvent): void {
    const settings = normalizeEyedropperToolSettings(this.engine.activeToolSettings()?.settings);
    this.engine.beginEyedropper(point, event.pointerId, settings.source, true);
  }

  onMove(): void {}
  onUp(): void {}

  cancel(): void {
    this.engine.cancelEyedropper();
  }
}
