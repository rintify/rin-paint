import type { ShapePaintMode, ShapeParams, ShapePoint, StrokePoint } from '../../../model';
import type { ShapeBounds } from '../geometry';

/** fill-outside の外枠に使うアートボードサイズ */
export interface ShapePageFrame {
  w: number;
  h: number;
}

/** 新しい図形を作るときに共有するスタイル */
export interface ShapeStyle {
  color: string;
  strokeWidth: number;
  paintMode: ShapePaintMode;
}

/** 自由変形が渡す座標写像 */
export interface ShapeTransform {
  transform(x: number, y: number): ShapePoint;
  scale: number;
  angle: number;
}

/** レイヤー設定パレットに並べる数値フィールド */
export interface ShapeControlField {
  label: string;
  value: number;
  min?: number;
  /** true なら内部は px、UI は現在ページ ppi で mm 表示・入力する */
  pageLength?: boolean;
  make(value: number, shape: ShapeParams): ShapeParams;
}

/** 汎用パラメータ一覧へ足す、種類固有の数値パラメータ */
export interface ShapeParameterField {
  key: string;
  label: string;
  min?: number;
  /** true なら内部は px、UI は現在ページ ppi で mm 表示・入力する */
  pageLength?: boolean;
  read(shape: ShapeParams): number;
  write(shape: ShapeParams, value: number): ShapeParams;
}

/** パレットの 3 点メニューに出す種類固有の操作 */
export interface ShapePanelAction {
  id: 'convertToPolygon';
  label: string;
}

export type ShapeEditMode = 'move' | 'rotate' | 'start' | 'end' | 'nw' | 'ne' | 'sw' | 'se' | 'vertex';

/** ハンドルの当たり判定。半径は呼び出し側の UI スケール込み */
export interface ShapeHitTest {
  point: StrokePoint;
  near(x: number, y: number): boolean;
}

export interface ShapeHit {
  mode: ShapeEditMode;
  vertexIndex?: number;
  /** ヒットと同時に図形が変わる場合 (多角形の頂点追加) の新しい図形 */
  shape?: ShapeParams;
}

export interface ShapeDrag<S extends ShapeParams = ShapeParams> {
  mode: ShapeEditMode;
  /** ドラッグ開始時の図形 */
  before: S;
  /** レイヤーが持つ最新の図形 (頂点追加後など before より進んでいる) */
  current: ShapeParams;
  vertexIndex?: number;
  point: StrokePoint;
}

export interface ShapeDragResult {
  shape: ShapeParams;
  /** 自己交差など確定できない状態か。undefined なら判定しない */
  invalid?: boolean;
}

export interface ShapeVertexDelete {
  shape?: ShapeParams;
  /** shape が無いときに利用者へ伝える理由 */
  error?: string;
}

/** 種類ごとの編集操作 (ヒットテスト・ドラッグ・頂点) */
export interface ShapeKindEdit<S extends ShapeParams = ShapeParams> {
  /** 種類固有のハンドル。共通の回転ハンドルは呼び出し側が先に判定する */
  hitHandle(shape: S, test: ShapeHitTest): ShapeHit | null;
  /** move を始められる内側か。slack はハンドル半径 */
  containsPoint(shape: S, point: ShapePoint, slack: number): boolean;
  /** ハンドルドラッグ後の図形。扱えないモードなら null */
  dragHandle(drag: ShapeDrag<S>): ShapeDragResult | null;
  /** 頂点を編集できる図形の頂点数。持たない種類は 0 */
  vertexCount(shape: S): number;
  /** 頂点を増やせる位置 (辺の中点)。描画とヒットテストで共有する */
  insertionPoints(shape: S): ShapePoint[];
  /** 頂点削除。できない場合は null、理由を伝えたい場合は error を返す */
  deleteVertex(shape: S, index: number): ShapeVertexDelete | null;
  /** invalid な位置から戻したときの通知文 */
  invalidMessage?: string;
}

/**
 * 図形の種類ごとの知識をまとめた実装。幾何・描画・編集・パラメータの分岐は
 * すべてここに閉じ、呼び出し側は registry 越しにディスパッチするだけにする。
 */
export interface ShapeKindHandler<S extends ShapeParams = ShapeParams> {
  kind: S['kind'];
  /** 既定のレイヤー名 */
  label: string;
  /** 塗り方 (paintMode) を選べるか */
  fillable: boolean;

  /** 2 点ドラッグで作れる種類だけが持つ */
  fromDrag?(a: StrokePoint, b: StrokePoint, style: ShapeStyle): ShapeParams | null;
  /** 省略可能フィールドを既定値で埋める */
  normalize(shape: S): ShapeParams;

  /** 色・線幅を設定済みの ctx へ輪郭を描く */
  draw(ctx: CanvasRenderingContext2D, shape: S, pageFrame: ShapePageFrame): void;
  /** 塗り方。輪郭しか持たない種類は常に stroke */
  paintMode(shape: S): ShapePaintMode;
  /** 塗り方の変更。選べない種類は素通しする */
  setPaintMode(shape: S, mode: ShapePaintMode): ShapeParams;

  bounds(shape: S): ShapeBounds;
  center(shape: S): ShapePoint;
  /** ハンドルと当たり判定に使う代表点 (線は両端、矩形は四隅、多角形は頂点) */
  points(shape: S): ShapePoint[];

  /** 現在の回転角 (ラジアン)。線は両端から求める */
  rotation(shape: S): number;
  setRotation(shape: S, angle: number): ShapeParams;
  rotate(shape: S, angle: number, pivot: ShapePoint): ShapeParams;
  translate(shape: S, dx: number, dy: number): ShapeParams;
  /** 解像度変更に伴う実寸スケール */
  scale(shape: S, factor: number): ShapeParams;
  /** 自由変形 */
  transform(shape: S, context: ShapeTransform): ShapeParams;

  parameterFields(shape: S): ShapeParameterField[];
  controlFields(shape: S): ShapeControlField[];
  /** パレットに添える補足 (多角形の頂点数など) */
  panelNote(shape: S): string | null;
  panelActions(shape: S): ShapePanelAction[];

  edit: ShapeKindEdit<S>;
}
