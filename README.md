# 歌詞リーダー

外部のTXT / JSONをブラウザから直接読み込んで表示する、静的な歌詞Readerです。Reader側は歌詞本文を保存しません。

## 使い方

- デモ: `index.html`
- 外部manifest: `index.html#m=https%3A%2F%2Fexample.com%2Freader.json`
- 外部TXT: `index.html#src=https%3A%2F%2Fexample.com%2Flyrics.txt`

manifest内の相対URLはmanifest自身のURLを基準に解決します。外部サーバーはブラウザからの読み取りを許可するCORSヘッダーを返す必要があります。

## ディレクトリ

- `assets/js/data-loader.js`: 外部データの取得とサイズ制限
- `assets/js/ruby-parser.js`: なろう式ルビのAST化
- `assets/js/transformer.js`: 旧字体から新字体への変換
- `assets/js/reader-view.js`: DOM描画と原文記法への復元
- `assets/js/app.js`: UI状態と各責務の接続
- `data/demo/`: ローカルで動作確認できるmanifestとサンプル本文

本番公開時は、`assets/css/reader.css` と `assets/js/app.js` のクエリにある `BUILD_ID` を更新してください。
