# Context Dock

状況（自宅・職場・イヤホン・車・カレンダー・時間帯）に応じて、ホーム画面の 2×2 ウィジェットに
アプリ4つを出し分ける仕組み。Android の Tasker（判定）と KWGT（表示）で動く。

- **エディタ**: https://tmhys.github.io/context-dock/ （Chrome で開いて「ホーム画面に追加」）
- **gen.js**: モード表から Tasker のプロジェクト XML と KWGT のプリセット（.kwgt）を作る生成器。
  外部ライブラリなし。エディタと、設定を置いている非公開リポジトリの Actions が同じこのファイルを使う

## このリポジトリに置かないもの

SSID・BT 名などの設定データ（`config.json`）は非公開の `tmhys/my_apps`
（`apps/context-dock/`）にある。エディタはトークンを使ってそこを読み書きする。
トークンは端末のブラウザ（localStorage）にだけ保存され、このリポジトリには入らない。

## 流れ

```
エディタで編集 → 「GitHub に保存」→ my_apps の config.json を更新
  → my_apps の Actions が gen.js（このリポジトリ）で XML と .kwgt を作り直す
  → Tasker の「ContextDock 更新」が Tasker/ と Kustom/widgets/ に取ってくる
  → Tasker で Import Project（KWGT はプリセットを選び直すだけ）
```

## 起動先の書き方

KWGT はパッケージ名だけではアプリを起動できない（実機で確認）。起動先は
`パッケージ名/起動画面`（`cmd package resolve-activity --brief -c android.intent.category.LAUNCHER <pkg>`
の出力と同じ形）で書く。エディタの「起動画面の名前」欄が、足りないアプリの分だけ
このコマンドを作り、出力を貼れば全モードにまとめて反映する（Shizuku + aShell でスマホだけで調べられる）。

## ファイル

| ファイル | 中身 |
|---|---|
| `index.html` | エディタ本体 |
| `gen.js` | 生成器（唯一の実装） |
| `manifest.webmanifest` / `sw.js` / `icon-*.png` | ホーム画面に置くための設定 |
| `tools/make-icons.cjs` | アイコンを作り直すスクリプト |
