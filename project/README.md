# lyric_reader_page Project Overlay

このファイルは既存 `lyric_reader_page` に追加したKiNoTch Project Overlayの入口です。利用者向けのRepository READMEとDomain実装はrootに残します。

## 概要

このRepositoryは、ブラウザ上の歌詞閲覧・編集体験を提供し、Reader、Writer、共有Document処理、モバイル品質ゲートを保持します。

- 個別情報・仕様・実装: project/
- 個別プロジェクト定義: project/project.json
- 個別仕様索引: project/docs/INDEX.md
- 現在状態: project/docs/CURRENT_STATE.md
- 共通操作: .kinotch/README_BASE.md

## 所有境界

- Reader / Writer / mobile gate / browser test はProject側の既存実装を正本とします。
- GitHub Pagesとdeploy workflowはProject固有のrelease policyとして保持します。
- KiNoTch Baseはrepository構造、診断、verify入口を提供します。

## 最短利用方法

```powershell
.\knt.cmd doctor
.\knt.cmd setup
.\knt.cmd verify
```

既存の利用方法・開発用コマンドはroot READMEとpackage.jsonを参照してください。
