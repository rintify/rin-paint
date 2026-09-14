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
  /** Transform previews only need the latest pointer position per display frame. */
  readonly latestMoveOnly?: boolean;
  /** 長押し判定を待たず、pointerdown から操作を始めるツール。 */
  readonly startsImmediately?: boolean;
  /** 選択中の図形・画像をキャンバス上で直接移動・変形していいか。未指定は許可。 */
  readonly allowsDirectShapeEdit?: boolean;
  onDown(p: StrokePoint, e: PointerEvent): void;
  onMove(p: StrokePoint, e: PointerEvent): void;
  onUp(p: StrokePoint, e: PointerEvent): void;
  cancel?(): void;
  /** ツールがアクティブになった直後。未確定状態の開始などに使う。 */
  onActivate?(): void;
  /** レイヤー選択が変わった直後。選択に追従するツールが使う。 */
  onLayerSelectionChange?(): void;
  drawOverlay?(ctx: CanvasRenderingContext2D): void;
  /** trueの間だけ操作ガイドのアニメーションフレームを継続する。 */
  overlayAnimated?(): boolean;
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
  /** 新しくツールを追加するとき、現在のペン設定より優先する初期値。 */
  initialColor?: string;
  initialSizeMm?: number;
  colorLabel?: string;
  allowTransparentColor?: boolean;
  summary?(tool: ToolInstance): string;
  create(engine: PaintEngine): Tool;
}

export interface ActiveToolSettings {
  kind: string;
  color: string;
  /** ツール設定に保持している太さ (mm) */
  sizeMm: number;
  /** 現在ページ ppi で換算した描画用直径 / 線幅 (px) */
  sizePx: number;
  settings?: unknown;
}
