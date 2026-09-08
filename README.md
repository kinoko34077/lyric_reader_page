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

Writerでは、Author Sourceを正本として編集します。表面SyntaxはSyntax Adapterの責務であり、Reader Coreへ散らしません。現在の旧v0.x記法はGate 2の移行完了までは現行Adapterで読めますが、最新仕様の正本Syntaxではありません。

```text
[文字]{c=2}
[文字]{style=shout}
[文字]{glyph=hare-special}
[12]{combine}
[如何《どう》]{style=title,c=2}
```

全文CopyはPresentationを除去し、本文とRubyだけをPortable Textとして出力します。WriterのPalette操作は「Slot色の更新」と「選択範囲へSlotを適用」を分離しています。回帰テストは`node --test tests/*.test.mjs`で実行できます。
- `assets/js/app.js`: UI状態と各責務の接続
- `data/demo/`: ローカルで動作確認できるmanifestとサンプル本文

表示設定では、横書き / 縦書き、文書定義Variant、旧字 / 新字体、ルビ、文字サイズ、背景色、文字色、標準フォントを切り替えられます。「作品既定に戻す」でmanifestの既定表示へ戻せます。ReaderはAuthor Sourceを正本として保持し、閲覧モードと`?mode=writer`の編集モードを同一ページ内で切り替えます。TXT / Reader JSONの読込、本文の直接編集、Portable Textの全文コピー、TXT / Reader JSON保存、Draft復元に対応します。Reader Document/Draftはversion 3のGeneric Variantモデルを使用し、旧versionは明示移行、未知の将来versionは拒否します。SourceとJSON Metadataが競合した場合はSourceを優先します。manifestの`theme`で初期テーマを指定でき、外部Webフォントは初期状態では自動読込せず、表示設定の明示許可後に読み込みます。Readerは任意CSS/HTML/Scriptを読み込みません。

ローカルのTXT / Reader JSONは画面全体へドロップするか、ヘッダーの「開く」からブラウザ内だけで読み込めます。編集モードではタイトルと本文をその場で編集でき、入力元の原文記法を正本として保持します。ローカル本文はサーバーへ送信・保存しません。

「Reader文書のダウンロード開始」では、本文・メタデータ・テーマ・表示状態・リンクを`reader.reader.json`としてダウンロード開始します。これはOSへの保存完了ではなく、ブラウザへダウンロードを開始したcheckpointです。同ファイルは「開く」からブラウザ内へ復元できます。

本番公開時は、`index.html` のCSS / JSクエリと `assets/js/config.js`・`assets/js/data-loader.js` のビルドIDを揃えて更新してください。

## 品質境界とサイズ仕様

- Author SourceはSyntax Adapterを介してTyped IRへ変換します。旧`[] {}`表記の扱いと、次期`[対象:指定]`表記への移行はGate 2で行います。SerializerのLexical lossless/canonical方針は`HOLD-B7`として未確定です。
- Writer操作後のSourceはParserへ再読込できることを必須とします。Nested Presentation、Ruby部分操作、Escapeの詳細は各Gateで閉じます。Unicode境界はgraphemeを基準に扱います。
- Sourceは最大500,000文字 / 2MB、Manifest JSONは最大200,000文字 / 512KB、Reader Document JSONは最大2,000,000文字 / 4.5MBです。historicalとmodernは個別Source上限で検証します。
- Draftは自動復元用の一時Recoveryであり永続保存を保証しません。localStorage失敗時も本文編集は継続し、同一文書を別タブで更新した場合はlast-writer-winsの可能性を警告します。Historyは最大40件・約8MBです。
- VariantはGeneric Variant Setとして保持します。Semantic Linkには共有Presentationを設定でき、Variant単位のOverrideで上書きできます。保存操作の表示はダウンロード開始を意味し、ディスク保存完了を保証しません。

最新の要件・Gate対応表は[`docs/REQUIREMENTS-MATRIX.md`](docs/REQUIREMENTS-MATRIX.md)、設計判断は[`docs/adr/0002-generic-semantic-document-model.md`](docs/adr/0002-generic-semantic-document-model.md)を参照してください。

回帰テストは`node --test tests/*.test.mjs`、構文検査はCIの`node --check`で実行します。Browser / Mobile / IME / forced-colors / Clipboard権限は別途実機確認するGateであり、Unit test greenだけでは完了扱いにしません。

## GitHub Pages

`main` へpushすると `.github/workflows/deploy-pages.yml` が静的サイトをGitHub Pagesへ公開します。GitHubリポジトリの Settings → Pages で、Sourceを「GitHub Actions」に設定してください。
