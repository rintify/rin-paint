/** バージョンは変更理由ごとに分ける。項目追加だけでは上げない。 */

/** バイナリ格納や外側のコンテナ構造。 */
export const FILE_CONTAINER_VERSION = 12 as const;
export const PROJECT_MAGIC = 'RINPAINT12';

/** ページ・階層などプロジェクト共通モデル。 */
export const PROJECT_STRUCTURE_VERSION = 12 as const;
export const PROJECT_VERSION = PROJECT_STRUCTURE_VERSION;

/** 履歴操作の記録形式。 */
export const HISTORY_OP_VERSION = 10 as const;
export const HISTORY_VERSION = HISTORY_OP_VERSION;

/** IndexedDB のオブジェクトストア構成。 */
export const DB_VERSION = 8;

export const CLIPBOARD_VERSION = 5 as const;

/** 設定ファイルの外側コンテナ。 */
export const SETTINGS_CONTAINER_VERSION = 2 as const;
