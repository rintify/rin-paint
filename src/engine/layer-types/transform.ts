import {
  IDENTITY_HOMOGRAPHY,
  homographyDeterminant,
  composeHomography,
  decomposeHomography,
  multiplyHomography,
  invertHomography,
  transformedBounds,
  type Homography,
  type TransformState,
} from '../../model';
import { createTransformLayer } from '../layers';
import { buildCatalog } from '../parameters/catalog';
import { mmHomographyToPixels, warpCanvas2DMesh, warpCanvasWebGL2 } from '../transform/projectiveWarp';
import type { LayerDefinition } from './definition';
import type { ParameterEditor } from '../parameters/types';

function normalizeMatrix(value: unknown): Homography {
  if (!Array.isArray(value) || value.length !== 9 || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    return [...IDENTITY_HOMOGRAPHY];
  }
  const matrix = [...value] as unknown as Homography;
  return Math.abs(homographyDeterminant(matrix)) < 1e-10 ? [...IDENTITY_HOMOGRAPHY] : matrix;
}

function normalizeState(value: unknown): TransformState {
  const source = value && typeof value === 'object'
    ? value as Partial<TransformState>
    : {};
  const pivot = source.pivotMm && Number.isFinite(source.pivotMm.x) && Number.isFinite(source.pivotMm.y)
    ? { ...source.pivotMm }
    : { x: 0, y: 0 };
  const interpolation = source.interpolation === 'nearest' || source.interpolation === 'cubic'
    ? source.interpolation
    : 'linear';
  return { matrix: normalizeMatrix(source.matrix), pivotMm: pivot, interpolation };
}

type TransformField = keyof ReturnType<typeof decomposeHomography>;
const TRANSFORM_FIELDS: readonly { key: TransformField; label: string; groupId: string; editor: ParameterEditor }[] = [
  { key: 'translateXmm', label: '位置 X', groupId: 'transform', editor: { kind: 'number', unit: { kind: 'mm' } } },
  { key: 'translateYmm', label: '位置 Y', groupId: 'transform', editor: { kind: 'number', unit: { kind: 'mm' } } },
  { key: 'rotationDeg', label: '回転', groupId: 'transform', editor: { kind: 'number', min: -3600, max: 3600, unit: { kind: 'degree' } } },
  { key: 'scaleX', label: '横倍率', groupId: 'transform', editor: { kind: 'number', min: .001, unit: { kind: 'none', suffix: '倍' } } },
  { key: 'scaleY', label: '縦倍率', groupId: 'transform', editor: { kind: 'number', min: .001, unit: { kind: 'none', suffix: '倍' } } },
  { key: 'shearXDeg', label: '横せん断', groupId: 'transform', editor: { kind: 'number', min: -89, max: 89, unit: { kind: 'degree' } } },
  { key: 'shearYDeg', label: '縦せん断', groupId: 'transform', editor: { kind: 'number', min: -89, max: 89, unit: { kind: 'degree' } } },
  { key: 'perspectiveX', label: '射影 X', groupId: 'projection', editor: { kind: 'number', unit: { kind: 'none' } } },
  { key: 'perspectiveY', label: '射影 Y', groupId: 'projection', editor: { kind: 'number', unit: { kind: 'none' } } },
];

export const transformLayerType: LayerDefinition<'transform'> = {
  info: {
    type: 'transform', canMask: false, maskSourceLabel: null, supportsBlend: false,
    defaultName: index => `トランスフォーム ${index}`,
  },
  state: {
    initial: () => createTransformLayer('tmp').state,
    clone: state => structuredClone(state),
    normalize: normalizeState,
    applyPatch: (state, patch) => normalizeState({ ...state, ...patch }),
    scale: state => structuredClone(state),
  },
  codec: { encode: structuredClone, decode: normalizeState },
  renderer: {
    draw() {},
    bakeOnto() {},
    contentCanvas: () => null,
    effect: {
      sourceRegion(layer, output, env) {
        const inverse = invertHomography(mmHomographyToPixels(layer.state.matrix, env.ppi));
        const bounds = inverse ? transformedBounds(inverse, output) : null;
        if (!bounds) return null;
        const pad = layer.state.interpolation === 'nearest' ? 0 : 2;
        const x = Math.floor(bounds.x) - pad, y = Math.floor(bounds.y) - pad;
        return {
          x, y,
          w: Math.max(1, Math.ceil(bounds.x + bounds.w) + pad - x),
          h: Math.max(1, Math.ceil(bounds.y + bounds.h) + pad - y),
        };
      },
      apply(scope, layer, env) {
        if (layer.opacity <= 0) return;
        const transformed = env.borrowCanvas(scope.width, scope.height);
        const pixelMatrix = mmHomographyToPixels(layer.state.matrix, env.ppi);
        const sourceX = scope.sourceX ?? scope.x, sourceY = scope.sourceY ?? scope.y;
        const sourceCanvas = scope.sourceCanvas ?? scope.canvas;
        const translateSource: Homography = [1, 0, sourceX, 0, 1, sourceY, 0, 0, 1];
        const translateTarget: Homography = [1, 0, -scope.x, 0, 1, -scope.y, 0, 0, 1];
        const localMatrix = multiplyHomography(translateTarget, multiplyHomography(pixelMatrix, translateSource));
        const options = { interpolation: layer.state.interpolation } as const;
        const gpu = document.createElement('canvas');
        gpu.width = scope.width; gpu.height = scope.height;
        const usedGpu = warpCanvasWebGL2(sourceCanvas, gpu, localMatrix, options);
        const warped = usedGpu
          ? (() => { transformed.ctx.clearRect(0, 0, scope.width, scope.height); transformed.ctx.drawImage(gpu, 0, 0); return true; })()
          : warpCanvas2DMesh(sourceCanvas, transformed.ctx, localMatrix, options);
        if (!warped) {
          transformed.release();
          return;
        }
        const target = scope.canvas.getContext('2d')!;
        target.save();
        target.setTransform(1, 0, 0, 1, 0, 0);
        target.clearRect(0, 0, scope.width, scope.height);
        target.globalAlpha = layer.opacity;
        target.drawImage(transformed.canvas, 0, 0);
        target.restore();
        transformed.release();
      },
    },
  },
  parameters: buildCatalog(
    [{ id: 'transform', label: 'トランスフォーム' }, { id: 'projection', label: '射影' }],
    [...TRANSFORM_FIELDS.map(({ key, label, groupId, editor }) => ({
      id: `transform.${key}`,
      semanticId: `transform.${key}`,
      groupId,
      label,
      editor,
      surfaces: ['single', 'multi', 'link'] as const,
      read: (state: TransformState) => decomposeHomography(state.matrix)[key],
      write: (state: TransformState, value: unknown) => {
        const parts = decomposeHomography(state.matrix);
        Object.assign(parts, { [key]: Number(value) });
        return { ...state, matrix: composeHomography(parts) };
      },
    })), {
      id: 'transform.pivotX', semanticId: 'transform.pivotX', groupId: 'transform', label: 'ピボット X',
      editor: { kind: 'number', unit: { kind: 'mm' } }, surfaces: ['single', 'multi', 'link'] as const,
      read: (state: TransformState) => state.pivotMm.x,
      write: (state: TransformState, value: unknown) => ({ ...state, pivotMm: { ...state.pivotMm, x: Number(value) } }),
    }, {
      id: 'transform.pivotY', semanticId: 'transform.pivotY', groupId: 'transform', label: 'ピボット Y',
      editor: { kind: 'number', unit: { kind: 'mm' } }, surfaces: ['single', 'multi', 'link'] as const,
      read: (state: TransformState) => state.pivotMm.y,
      write: (state: TransformState, value: unknown) => ({ ...state, pivotMm: { ...state.pivotMm, y: Number(value) } }),
    }, {
      id: 'transform.interpolation', semanticId: 'transform.interpolation', groupId: 'projection', label: '補間',
      editor: { kind: 'select', options: { kind: 'static', options: [
        { value: 'nearest', label: 'ニアレスト' },
        { value: 'linear', label: 'リニア' },
        { value: 'cubic', label: 'バイキュービック' },
      ] } }, surfaces: ['single', 'multi', 'link'] as const,
      read: (state: TransformState) => state.interpolation,
      write: (state: TransformState, value: unknown) => ({
        ...state,
        interpolation: value === 'nearest' || value === 'cubic' ? value : 'linear',
      }),
    }, {
      id: 'transform.reset', semanticId: 'transform.reset', groupId: 'transform', label: 'リセット',
      editor: { kind: 'switch', trueLabel: 'リセット', falseLabel: 'リセット' }, surfaces: ['single', 'multi'] as const,
      read: () => false,
      write: (state: TransformState) => ({ ...state, matrix: [...IDENTITY_HOMOGRAPHY] as Homography }),
    }],
  ),
  capabilities: {
    objectTransform: {
      bounds: (_layer, env) => ({ x: 0, y: 0, w: env.pageFrame.w, h: env.pageFrame.h, width: env.pageFrame.w, height: env.pageFrame.h }),
      apply(layer, context) {
        const source = { x: context.width ? context.width / 2 : 0, y: context.height ? context.height / 2 : 0 };
        const target = context.transform(source.x, source.y);
        const pxPerMm = context.ppi / 25.4;
        const cx = source.x / pxPerMm, cy = source.y / pxPerMm;
        const tx = target.x / pxPerMm, ty = target.y / pxPerMm;
        const rotateScale = composeHomography({ rotationDeg: context.angle * 180 / Math.PI, scaleX: context.scale, scaleY: context.scale });
        const delta = multiplyHomography(
          composeHomography({ translateXmm: tx, translateYmm: ty }),
          multiplyHomography(rotateScale, composeHomography({ translateXmm: -cx, translateYmm: -cy })),
        );
        layer.state.matrix = multiplyHomography(delta, context.before.matrix);
      },
    },
  },
};
