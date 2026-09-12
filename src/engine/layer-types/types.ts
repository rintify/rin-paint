import type {
  AdjustParams,
  BlendMode,
  ImageParams,
  LayerMeta,
  LayerType,
  OutlineParams,
  ShapeParams,
  TextParams,
  LayerParameterLink,
} from '../../model';
import type { LayerProps, LayerSnapshot } from '../history/historyTree';
import type { Layer, RasterLayer } from '../layers';
import type { SavedLayer } from '../persistence/db';
import type { TextRenderer } from '../text/render';

export interface ArtboardSize {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * 永続レイヤー表現の最小公倍数。LayerSnapshot (履歴) と SavedLayer (保存・
 * クリップボード) の両方をこの形で受け取り、型ごとのハンドラが解釈する。
 * 欠けたフィールドは復元時に既定値へ寄せるため、共通項は任意扱いにしている。
 */
export interface StoredLayer {
  id: string;
  type: LayerType;
  name?: string;
  opacity?: number;
  blend?: BlendMode;
  visible?: boolean;
  parentId: string | null;
  childIds: string[];
  params?: AdjustParams;
  outline?: OutlineParams;
  maskLayerIds?: string[];
  shape?: ShapeParams;
  snapEnabled?: boolean;
  constrainAspect?: boolean;
  text?: TextParams;
  image?: ImageParams;
  parameterLink?: LayerParameterLink;
  canvas?: HTMLCanvasElement;
  blob?: Blob;
}

export interface LayerContentEnv {
  artboard: ArtboardSize;
}

export interface LayerRestoreEnv extends LayerContentEnv {
  /** 保存データに名前が無い場合に使う、決定済みのレイヤー名 */
  name: string;
}

export interface LayerSnapshotEnv extends LayerContentEnv {
  /** ラスター内容を取り込むか (メタデータだけで足りる場合は false) */
  withContent: boolean;
  /** true なら canvas を保持し、false なら PNG へ非同期エンコードして捨てる */
  keepCanvas: boolean;
  /** PNG エンコード完了通知 (保存容量表示の更新用) */
  onEncoded(): void;
}

export interface LayerScaleEnv {
  /** 解像度変更後のピクセルサイズ */
  width: number;
  height: number;
}

export interface LayerStoredScaleEnv extends LayerContentEnv {
  factor: number;
}

/** 文字ビットマップの実測が必要な処理 (外接矩形・サムネイル) 用 */
export interface LayerMeasureEnv {
  artboard: ArtboardSize;
  textRenderer: TextRenderer;
}

export interface LayerDrawEnv extends LayerMeasureEnv {
  /** 局所再合成Canvas左上のアートボード座標。 */
  originX: number;
  originY: number;
  /** マスク元・消しゴム子レイヤーの解決 */
  layerById(id: string): Layer | null;
  /** 他レイヤーを描くためのハンドラ解決 */
  handlerFor(layer: Layer): LayerTypeHandler;
  /** 再帰合成でも衝突しない貸出式作業キャンバス。使用後は必ず release する。 */
  borrowCanvas(width?: number, height?: number): CanvasLease;
  /** CPUへ画素を読む処理専用。通常合成Canvasへ willReadFrequently を波及させない。 */
  borrowReadbackCanvas(width?: number, height?: number): CanvasLease;
  /** 現在ページの解像度。mm指定の効果をpxへ変換する。 */
  ppi: number;
  /** 指定レイヤー自身のアルファをOR合成する。表示状態は無視する。 */
  maskCanvas(ids: string[]): MaskCanvas | null;
  /** 入力を必要とする効果レイヤーの、効果によって追加された見た目だけを描画する。 */
  drawEffectContribution(ctx: CanvasRenderingContext2D, layerId: string): void;
  effectCache: EffectCacheStore;
  stats: RenderStatsAccumulator;
  /** ラスターレイヤー直上に描くツールのプレビュー */
  drawAboveLayer?(ctx: CanvasRenderingContext2D, layerId: string): void;
}

export interface RenderStatsAccumulator {
  cpuReadbackPixels: number;
  canvasBorrows: number;
}

export interface CanvasLease {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  release(): void;
}

/** 単一ラスターを複製せずマスクとして渡せるよう、不透明度を別に保持する。 */
export interface MaskCanvas {
  canvas: HTMLCanvasElement;
  opacity: number;
  release(): void;
}

export interface EffectScope {
  canvas: HTMLCanvasElement;
  coverage: HTMLCanvasElement;
  /** この作業Canvas左上のアートボード座標。 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** この効果より前の対象スコープ内容を表すリビジョン。 */
  inputRevision: number;
}

export interface EffectCacheStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, bytes: number, dispose?: () => void): void;
}

export interface LayerEffectHandler<L extends Layer> {
  apply(scope: EffectScope, layer: L, env: LayerDrawEnv): void;
  /** 入力変化が周囲へ広がる最大距離。ピクセルローカルな効果は0。 */
  paddingPx?(layer: L, env: LayerDrawEnv): number;
  /** 効果結果が直接参照する、対象スコープ外のレイヤー。 */
  dependencyLayerIds?(layer: L): readonly string[];
}

export interface ObjectBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 実測が必要な型 (文字) が返す、変形時に再利用するサイズ */
  width?: number;
  height?: number;
}

export interface ObjectTransformContext {
  /** 変形開始時のパラメータ */
  before: LayerProps;
  transform(x: number, y: number): Point;
  scale: number;
  angle: number;
  width?: number;
  height?: number;
}

export interface LayerObjectTransform<L extends Layer> {
  /** 選択判定用の外接矩形 */
  bounds(layer: L, env: LayerMeasureEnv): ObjectBounds | null;
  apply(layer: L, context: ObjectTransformContext): void;
}

/** 直親ラスターを非破壊で削る子レイヤー (透明図形) の振る舞い */
export interface LayerEraser<L extends Layer> {
  applies(layer: L): boolean;
  draw(ctx: CanvasRenderingContext2D, layer: L, env: LayerDrawEnv): void;
}

export type LayerParameterValue = number | string | boolean | null;
export type LayerParameterLayer = Layer | LayerMeta;

export interface LayerParameterDescriptor {
  key: string;
  /** Stable cross-layer identity used by multi-editing and parameter links. */
  semanticId?: string;
  /** False when a value cannot safely be edited across a heterogeneous selection. */
  multiSelectable?: boolean;
  /** False for selection-dependent controls such as rich-text formatting. */
  linkable?: boolean;
  label: string;
  control: 'number' | 'color' | 'select' | 'switch';
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  allowTransparent?: boolean;
  nullable?: boolean;
  /** switch の ON/OFF 表示。未指定なら「表示／非表示」 */
  trueLabel?: string;
  falseLabel?: string;
  /** true なら内部は px、UI は現在ページ ppi で mm 表示・入力する */
  canvasLength?: boolean;
  /** Canonical values are persisted in links; canvas lengths use millimetres. */
  readCanonical?(layer: LayerParameterLayer, ppi: number): LayerParameterValue | null;
  writeCanonical?(layer: LayerParameterLayer, value: LayerParameterValue, ppi: number): LayerProps;
  read(layer: LayerParameterLayer): LayerParameterValue | null;
  write(layer: LayerParameterLayer, value: LayerParameterValue): LayerProps;
}

/**
 * レイヤー種別ごとの知識をまとめた実装。コアはこのインターフェイス越しに
 * ディスパッチするだけで、`layer.type` を見た分岐を持たない。
 */
export interface LayerTypeHandler<L extends Layer = Layer> {
  type: L['type'];
  /** マスク元レイヤーとして使えるか */
  canMask: boolean;
  /** マスク元一覧に出す種類名 */
  maskSourceLabel: string | null;
  /** 合成モードを持つか (補正レイヤーは常に source-over) */
  supportsBlend: boolean;

  /** 自動生成レイヤー名。index は同種レイヤーの連番 */
  defaultName(index: number): string;

  /** 型固有フィールドを snapshot へ書き込む (ラスターは PNG 化も予約する) */
  snapshot(layer: L, snapshot: LayerSnapshot, env: LayerSnapshotEnv): void;
  /** 永続表現からレイヤーを生成する。データが不足していれば null */
  restore(source: StoredLayer, env: LayerRestoreEnv): Promise<L | null>;
  /** 型固有フィールドの保存形。共通項は呼び出し側が付与する */
  toSaved(layer: L, env: LayerContentEnv): Promise<Partial<SavedLayer>>;

  /** 型固有プロパティの適用 (共通項は呼び出し側が適用する) */
  applyProps(layer: L, props: LayerProps): void;
  /** 型固有プロパティの現在値 (履歴の before 側・ストア用メタ) */
  captureProps(layer: L): LayerProps;

  /** 解像度変更に伴う実寸スケール */
  scale(layer: L, factor: number, env: LayerScaleEnv): void;
  /** 永続表現のままスケールする (ページ間ペースト) */
  scaleStored(source: StoredLayer, env: LayerStoredScaleEnv): Promise<void>;

  draw(ctx: CanvasRenderingContext2D, layer: L, env: LayerDrawEnv): void;
  /** 対象区間の合成結果そのものを変更する非破壊効果。 */
  effect?: LayerEffectHandler<L>;
  /** 補正レイヤーのマスクとしてアルファを描く。canMask と対応する */
  drawMask?(ctx: CanvasRenderingContext2D, layer: L, env: LayerDrawEnv): void;
  bakeOnto(target: RasterLayer, layer: L, env: LayerDrawEnv): void;

  eraser?: LayerEraser<L>;
  objectTransform?: LayerObjectTransform<L>;

  /** サムネイル等に使える内容キャンバス */
  contentCanvas(layer: L, env: LayerMeasureEnv): HTMLCanvasElement | null;

  /** 型固有の汎用パラメータ (共通の表示・不透明度・合成は呼び出し側が足す) */
  parameterDescriptors(layer: LayerParameterLayer): LayerParameterDescriptor[];
}
