/**
 * ツールエリアに並ぶ「ツールインスタンス」。
 * 同じ形 (kind) のツールを複数持て、色・太さを個別に記憶する。
 * kind 固有設定は settings に載せる (各ツール記述子が normalize する)。
 * sizeMm は作品上の物理太さ (mm)。描画時に現在ページの ppi で px へ変換する。
 */
export interface ToolInstance {
  id: string;
  kind: string;
  name: string;
  sizeMm: number;
  color: string;
  settings?: unknown;
  /** パレットから使ったあと選択を外す。未指定はワンショットツールではオン。 */
  autoDeactivateAfterUse?: boolean;
}

export interface ToolStack {
  id: string;
  name: string;
  toolIds: string[];
}

export type ToolLayoutItem =
  | { type: 'tool'; toolId: string }
  | { type: 'stack'; stackId: string };

export function newToolStackId(): string {
  return `TS${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

let toolIdCounter = 0;
export function newToolInstanceId(): string {
  return `T${Date.now().toString(36)}-${(toolIdCounter++).toString(36)}`;
}
