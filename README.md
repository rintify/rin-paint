# rin-paint

React + TypeScript で動く高速ペイントアプリです。

## 機能

- 筆圧対応ブラシ / 消しゴム（Pointer Events + 補間）
- 複数レイヤー（並べ替え・削除・新規・透明度・合成モード）
- 色補正レイヤー（明るさ / コントラスト / 彩度 / 色相）
- 樹状履歴（Undo 後に描いても分岐を保持、変更領域の WebP パッチで容量を抑制）
- タイムラプス（描画確定時のみ録画、Undo は含めない / WebM 書き出し）
- 図形ツール（直線・矩形・楕円）
- 投げ縄選択（移動・拡大縮小・回転・複製）
- ダブルタップでスポイト（ルーペプレビュー付き）
- IndexedDB 自動保存 + PNG 書き出し

## 起動

```bash
npm install
npm run dev
```

## 操作

| 操作 | 内容 |
|------|------|
| ドラッグ | 描画 / 図形 / 選択 |
| ダブルタップ | スポイト（ドラッグで参照位置変更、離すと色確定） |
| ⌘/Ctrl+Z | 戻る |
| ⌘/Ctrl+Shift+Z または ⌘/Ctrl+Y | 進む |
| Shift+図形 | 正方形 / 正円に拘束 |

左サイドバーにツール・色・レイヤー・書き出しをまとめ、右側を広くキャンバスにしています。

## 設計メモ

- 描画エンジン（`src/engine`）は React から分離。UI は zustand で状態を購読するだけです。
- ツールは共通 `Tool` インターフェース（`src/engine/tools`）なので、今後の機能追加がしやすい構成です。
- 履歴は領域パッチの WebP Blob をツリーで保持し、合計サイズ上限を超えた古い枝から破棄します。

## ブラウザ要件

- モダンブラウザ（Chrome / Edge / Safari 推奨）
- タイムラプスには [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) `VideoEncoder` が必要です
