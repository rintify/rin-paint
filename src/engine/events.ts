export interface EngineEventMap {
  /** テキスト編集中の内容を確定させたい時にエンジンが発火 (TextEditor が購読) */
  textCommitRequest: void;
  /** newProject / importProject / switchPage 後 */
  projectReset: void;
  /** UI が選択対象に応じて処理するショートカット */
  shortcutCommand: { command: 'rename-selection' | 'delete-selection' };
}

type Handler<T> = T extends void ? () => void : (payload: T) => void;

/** 型付きイベントバス。window カスタムイベントの代わり。 */
export class EngineEvents {
  private listeners = new Map<keyof EngineEventMap, Set<(payload: unknown) => void>>();

  on<K extends keyof EngineEventMap>(type: K, handler: Handler<EngineEventMap[K]>): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler as (payload: unknown) => void);
  }

  off<K extends keyof EngineEventMap>(type: K, handler: Handler<EngineEventMap[K]>): void {
    this.listeners.get(type)?.delete(handler as (payload: unknown) => void);
  }

  emit<K extends keyof EngineEventMap>(
    type: K,
    ...args: EngineEventMap[K] extends void ? [] : [EngineEventMap[K]]
  ): void {
    const payload = args[0];
    for (const handler of [...(this.listeners.get(type) ?? [])].reverse()) {
      handler(payload);
    }
  }
}
