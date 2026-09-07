# 歌詞リーダー

外部のTXT / JSONをブラウザから直接読み込んで表示する、静的な歌詞Readerです。Reader側は歌詞本文を保存しません。

詳細な実装履歴は[`CHANGELOG.md`](./CHANGELOG.md)を参照してください。

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
- `assets/js/syntax-adapter.js`: Author Sourceの構文とReader Coreの境界。現行は青空文庫系Ruby Adapterを提供し、Portable Text / Plain Text / validationの契約を分離します。
- `assets/js/registry.js`: Palette / Style / Glyph等の許可済みRegistryを検証・解決します。外部定義から任意CSSやHTMLは受け付けず、未登録Glyphは原文へフォールバックします。

Writerでは、次の仮Presentation記法をAuthor Sourceへ保存できます。正式構文は未確定のため、Syntax Adapter交換を前提としたv0.x仕様です。

```text
[文字]{c=2}
[文字]{style=shout}
[文字]{glyph=hare-special}
[12]{combine}
[如何《どう》]{style=title,c=2}
```

全文CopyはPresentationを除去し、本文とRubyだけをPortable Textとして出力します。回帰テストは`node --test tests/*.test.mjs`で実行できます。
- `assets/js/app.js`: UI状態と各責務の接続
- `data/demo/`: ローカルで動作確認できるmanifestとサンプル本文

表示設定では、横書き / 縦書き、旧字 / 新字体、歴史的仮名 / 現代仮名、ルビ、文字サイズ、背景色、文字色、ルビ色、標準フォントを切り替えられます。「作品既定に戻す」でmanifestの既定表示へ戻せます。Readerは原文記法のSourceを正本として保持し、閲覧モードと`?mode=writer`の編集モードを同一ページ内で切り替えます。TXT / Reader JSONの読込、本文の直接編集、全文コピー、TXT / Reader JSON保存、Draft復元にも対応します。Reader JSONはhistorical / modernの両Variantを保持します。manifestの`theme`で初期テーマを指定でき、`theme.font`に`{"type":"remote","url":"https://example.com/font.woff2"}`を指定すると、CORSを許可した外部Webフォントを直接読み込めます。Readerは任意CSSを読み込みません。

ローカルのTXT / Reader JSONは画面全体へドロップするか、ヘッダーの「開く」からブラウザ内だけで読み込めます。編集モードではタイトルと本文をその場で編集でき、入力元の原文記法を正本として保持します。ローカル本文はサーバーへ送信・保存しません。

「Reader文書を保存」では、本文・メタデータ・テーマ・表示状態・リンクを`reader.reader.json`として保存できます。同ファイルは「Reader JSONを読み込む」からブラウザ内へ復元できます。

本番公開時は、`index.html` のCSS / JSクエリと `assets/js/config.js`・`assets/js/data-loader.js` のビルドIDを揃えて更新してください。

## GitHub Pages

`main` へpushすると `.github/workflows/deploy-pages.yml` が静的サイトをGitHub Pagesへ公開します。GitHubリポジトリの Settings → Pages で、Sourceを「GitHub Actions」に設定してください。
