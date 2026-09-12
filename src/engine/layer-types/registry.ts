import type { LayerType } from '../../model';
import type { LayerProps, LayerSnapshot } from '../history/historyTree';
import type { Layer } from '../layers';
import type { SavedLayer } from '../persistence/db';
import { adjustLayerType } from './adjust';
import { clipLayerType } from './clip';
import { outlineLayerType } from './outline';
import { rasterLayerType } from './raster';
import { shapeLayerType } from './shape';
import { textLayerType } from './text';
import type {
  LayerContentEnv,
  LayerParameterDescriptor,
  LayerParameterLayer,
  LayerScaleEnv,
  LayerSnapshotEnv,
  LayerStoredScaleEnv,
  LayerTypeHandler,
  StoredLayer,
} from './types';

let cache: Record<LayerType, LayerTypeHandler> | null = null;

/**
 * 遅延構築。ハンドラは設定パネル (React) を参照し、そこから再びこのモジュールへ
 * 戻る輪ができるため、読み込み順に依存しないよう初回アクセスまで待つ。
 */
function handlers(): Record<LayerType, LayerTypeHandler> {
  return (cache ??= {
    raster: rasterLayerType,
    adjust: adjustLayerType,
    outline: outlineLayerType,
    clip: clipLayerType,
    shape: shapeLayerType,
    text: textLayerType,
  });
}

export function layerTypeHandler(type: LayerType): LayerTypeHandler {
  return handlers()[type];
}

/** レイヤー実体からハンドラを引く。コア側のディスパッチはすべてここを通る。 */
export function layerHandler(layer: Layer): LayerTypeHandler {
  return handlers()[layer.type];
}

function knownType(type: string): type is LayerType {
  return type in handlers();
}

/** 共通フィールド + 型固有フィールドのスナップショット */
export function buildLayerSnapshot(layer: Layer, env: LayerSnapshotEnv): LayerSnapshot {
  const snapshot: LayerSnapshot = {
    id: layer.id,
    type: layer.type,
    name: layer.name,
    opacity: layer.opacity,
    blend: layer.blend,
    visible: layer.visible,
    parentId: layer.parentId,
    childIds: [...layer.childIds],
  };
  layerHandler(layer).snapshot(layer, snapshot, env);
  return snapshot;
}

/**
 * 履歴スナップショット・保存データ・クリップボードのいずれからでもレイヤーを
 * 復元する。データが足りない場合は null を返し、呼び出し側が読み飛ばす。
 * index は名前を持たないデータへ連番名を振るときだけ使う。
 */
export async function restoreLayerFrom(
  source: StoredLayer,
  env: LayerContentEnv,
  index = 0,
): Promise<Layer | null> {
  if (!knownType(source.type)) return null;
  const handler = handlers()[source.type];
  const layer = await handler.restore(source, {
    artboard: env.artboard,
    name: source.name ?? handler.defaultName(index),
  });
  if (!layer) return null;
  layer.opacity = source.opacity ?? 1;
  layer.blend = source.blend ?? 'source-over';
  layer.visible = source.visible ?? true;
  layer.parentId = source.parentId;
  layer.childIds = [...source.childIds];
  return layer;
}

/**
 * 保存用の 1 レイヤー。ラスター内容は呼び出し時点の見た目を同期でコピーし、
 * PNG エンコードだけを待たせるので、保存中の描画と競合しない。
 */
export function savedLayerFrom(layer: Layer, env: LayerContentEnv): Promise<SavedLayer> {
  const saved: SavedLayer = {
    id: layer.id,
    type: layer.type,
    name: layer.name,
    opacity: layer.opacity,
    blend: layer.blend,
    visible: layer.visible,
    parentId: layer.parentId,
    childIds: [...layer.childIds],
  };
  return layerHandler(layer).toSaved(layer, env).then(fields => Object.assign(saved, fields));
}

/** 型固有プロパティの現在値 */
export function layerTypeProps(layer: Layer): LayerProps {
  return layerHandler(layer).captureProps(layer);
}

/** オブジェクト変形の履歴に残す値。変形できない種別は空。 */
export function objectTransformProps(layer: Layer): LayerProps {
  const handler = layerHandler(layer);
  return handler.objectTransform ? handler.captureProps(layer) : {};
}

export function scaleLayer(layer: Layer, factor: number, env: LayerScaleEnv): void {
  layerHandler(layer).scale(layer, factor, env);
}

export function scaleStoredLayer(source: StoredLayer, env: LayerStoredScaleEnv): Promise<void> {
  if (!knownType(source.type)) return Promise.resolve();
  return handlers()[source.type].scaleStored(source, env);
}

/** 補正レイヤーのマスク元に使えるか */
export function canMaskLayerType(type: LayerType): boolean {
  return handlers()[type].canMask;
}

export function maskSourceLabel(type: LayerType): string {
  return handlers()[type].maskSourceLabel ?? '';
}

export function supportsBlendMode(type: LayerType): boolean {
  return handlers()[type].supportsBlend;
}

/** 自由変形で動かせる種別 (図形・文字) か */
export function canTransformObjectType(type: LayerType): boolean {
  return !!handlers()[type].objectTransform;
}

export function layerTypeParameterDescriptors(layer: LayerParameterLayer): LayerParameterDescriptor[] {
  return handlers()[layer.type].parameterDescriptors(layer);
}
