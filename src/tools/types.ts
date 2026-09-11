import type { ComponentType, ReactNode } from 'react';
import type { StrokePoint } from '../model';
import type { PaintEngine } from '../engine/PaintEngine';
import type { ToolInstance } from '../model/tool';

export interface ToolSession {
  /** 未確定状態(浮動選択・ドラッグ中プレビュー等)があるか */
  active(): boolean;
  commit(): void;
  cancel(): void;
}

export interface Tool {
  onDown(p: StrokePoint, e: PointerEvent): void;
  onMove(p: StrokePoint, e: PointerEvent): void;
  onUp(p: StrokePoint, e: PointerEvent): void;
  cancel?(): void;
  drawOverlay?(ctx: CanvasRenderingContext2D): void;
  /** 全 raster レイヤー合成時に呼ばれる。関係ある layerId のみ描く */
  drawAboveLayer?(ctx: CanvasRenderingContext2D, layerId: string): void;
  readonly session?: ToolSession;
}

export interface ToolCapabilities {
  color: boolean;
  size: boolean;
  multiSelect: boolean;
}

export interface ToolSettingsSpec<S = unknown> {
  default(): S;
  normalize(value: unknown): S;
  Panel: ComponentType;
}

export interface ToolDescriptor<S = unknown> {
  kind: string;
  label: string;
  description: string;
  icon: ReactNode;
  category: 'root' | 'shape';
  capabilities: ToolCapabilities;
  settings?: ToolSettingsSpec<S>;
  /** settings が無いツール用の設定パネル (例: ぼかし) */
  Panel?: ComponentType;
  sizeLabel?: string;
  summary?(tool: ToolInstance): string;
  create(engine: PaintEngine): Tool;
}

export interface ActiveToolSettings {
  kind: string;
  color: string;
  size: number;
  settings?: unknown;
}
