/**
 * ツールエリアに並ぶ「ツールインスタンス」。
 * 同じ形 (kind) のツールを複数持て、色・太さを個別に記憶する。
 * kind 固有設定は settings に載せる (各ツール記述子が normalize する)。
 */
export interface ToolInstance {
  id: string;
  kind: string;
  name: string;
  size: number;
  color: string;
  settings?: unknown;
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
