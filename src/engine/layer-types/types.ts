import type {
  AdjustParams,
  BlendMode,
  LayerMeta,
  LayerType,
  OutlineParams,
  ShapeParams,
  TextParams,
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
  text?: TextParams;
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
  /** マスク元・消しゴム子レイヤーの解決 */
  layerById(id: string): Layer | null;
  /** 他レイヤーを描くためのハンドラ解決 */
  handlerFor(layer: Layer): LayerTypeHandler;
  /** 再帰合成でも衝突しない貸出式作業キャンバス。使用後は必ず release する。 */
  borrowCanvas(): CanvasLease;
  /** 現在ページの解像度。mm指定の効果をpxへ変換する。 */
  ppi: number;
  /** 指定レイヤー自身のアルファをOR合成する。表示状態は無視する。 */
  maskCanvas(ids: string[]): CanvasLease | null;
  /** ラスターレイヤー直上に描くツールのプレビュー */
  drawAboveLayer?(ctx: CanvasRenderingContext2D, layerId: string): void;
}

export interface CanvasLease {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  release(): void;
}

export interface EffectScope {
  canvas: HTMLCanvasElement;
  coverage: HTMLCanvasElement;
}

export interface LayerEffectHandler<L extends Layer> {
  apply(scope: EffectScope, layer: L, env: LayerDrawEnv): void;
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

export type LayerParameterValue = number | string | boolean;
export type LayerParameterLayer = Layer | LayerMeta;

export interface LayerParameterDescriptor {
  key: string;
  label: string;
  control: 'number' | 'color' | 'select' | 'switch';
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  allowTransparent?: boolean;
  /** switch の ON/OFF 表示。未指定なら「表示／非表示」 */
  trueLabel?: string;
  falseLabel?: string;
  /** true なら内部は px、UI は現在ページ ppi で mm 表示・入力する */
  canvasLength?: boolean;
  read(layer: LayerParameterLayer): LayerParameterValue | null;
  write(layer: LayerParameterLayer, value: LayerParameterValue): LayerProps;
}

/**
 * レイヤー種別ごとの知識をまとめた実装。コアはこのインターフェイス越しに
 * ディスパッチするだけで、`layer.type` を見た分岐を持たない。
 */
export interface LayerTypeHandler<L extends Layer = Layer> {
  type: L['type'];
  /** マスク元レイヤーとして使えるか (補正レイヤーだけ不可) */
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
