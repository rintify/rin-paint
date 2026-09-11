import type { AdjustParams, BlendMode, LayerType, ShapeParams, ToolInstance, TextParams, CanvasSpec, ProjectFont } from '../../types';
import { validateCanvasSpec } from '../canvasSpec';

export interface ProjectFileLayer {
  id: string;
  type: LayerType;
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  parentId: string | null;
  childIds: string[];
  params?: AdjustParams;
  shape?: ShapeParams;
  text?: TextParams;
  /** ラスター内容の PNG data URL */
  png?: string;
}

export interface ProjectFile {
  app: 'rin-paint';
  version: 3;
  canvasSpec: CanvasSpec;
  fonts: ProjectFont[];
  rootLayerIds: string[];
  activeLayerId: string;
  penColor: string;
  penSize: number;
  colorHistory: string[];
  layers: ProjectFileLayer[];
  /** アートボードサイズ (古いファイルには無い) */
  width?: number;
  height?: number;
  tools?: ToolInstance[];
  activeToolId?: string;
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('failed to read blob'));
    r.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

export function parseProjectFile(text: string): ProjectFile {
  const data = JSON.parse(text) as ProjectFile;
  if (data?.app !== 'rin-paint' || data.version !== 3 || !Array.isArray(data.layers) || !Array.isArray(data.rootLayerIds) || !data.canvasSpec || validateCanvasSpec(data.canvasSpec) || !Array.isArray(data.fonts)) {
    throw new Error('rin-paint のプロジェクトファイルではありません');
  }
  return data;
}
