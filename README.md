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

全文CopyはPresentationを除去し、本文とRubyだけをPortable Textとして出力します。WriterのPalette操作は「Slot色の更新」と「選択範囲へSlotを適用」を分離しています。回帰テストは`node --test tests/*.test.mjs`で実行できます。
- `assets/js/app.js`: UI状態と各責務の接続
- `data/demo/`: ローカルで動作確認できるmanifestとサンプル本文

表示設定では、横書き / 縦書き、旧字 / 新字体、歴史的仮名 / 現代仮名、ルビ、文字サイズ、背景色、文字色、ルビ色、標準フォントを切り替えられます。「作品既定に戻す」でmanifestの既定表示へ戻せます。Readerは原文記法のSourceを正本として保持し、閲覧モードと`?mode=writer`の編集モードを同一ページ内で切り替えます。TXT / Reader JSONの読込、本文の直接編集、全文コピー、TXT / Reader JSON保存、Draft復元にも対応します。Reader JSONはhistorical / modernの両Variantを保持し、version 1をversion 2へ移行、未知の将来versionは拒否します。manifestの`theme`で初期テーマを指定でき、外部Webフォントは初期状態では自動読込せず、表示設定の明示許可後に読み込みます。RegistryのNamed StyleはPalette、Outline、Gradientを参照できます。Readerは任意CSS/HTML/Scriptを読み込みません。SVG assetはv0.xでは非対応です。

ローカルのTXT / Reader JSONは画面全体へドロップするか、ヘッダーの「開く」からブラウザ内だけで読み込めます。編集モードではタイトルと本文をその場で編集でき、入力元の原文記法を正本として保持します。ローカル本文はサーバーへ送信・保存しません。

「Reader文書のダウンロード開始」では、本文・メタデータ・テーマ・表示状態・リンクを`reader.reader.json`としてダウンロード開始します。これはOSへの保存完了ではなく、ブラウザへダウンロードを開始したcheckpointです。同ファイルは「開く」からブラウザ内へ復元できます。

本番公開時は、`index.html` のCSS / JSクエリと `assets/js/config.js`・`assets/js/data-loader.js` のビルドIDを揃えて更新してください。

## 品質境界とサイズ仕様

- Author SourceはSyntax Adapterを介してTyped IRへ変換します。`[] {}`はv0.x暫定記法で、属性順は`c, style, glyph, combine`へcanonicalizeされます。文字としての括弧は`\\[`, `\\]`, `\\{`, `\\}`, `\\\\`でescapeします。
- Writer操作後のSourceはParserへ再読込できることを必須とし、Presentation重複はflatな属性集合へ正規化します。Rubyはgraphemeではなくsemantic nodeとして選択範囲を拡張します。
- Sourceは最大500,000文字 / 2MB、Manifest JSONは最大200,000文字 / 512KB、Reader Document JSONは最大2,000,000文字 / 4.5MBです。historicalとmodernは個別Source上限で検証します。
- Draftは自動復元用の一時Recoveryであり永続保存を保証しません。localStorage失敗時も本文編集は継続し、同一文書を別タブで更新した場合はlast-writer-winsの可能性を警告します。Historyは最大40件・約8MBです。
- Variantは独立Sourceとして編集し、自動同期しません。保存操作の表示はダウンロード開始を意味し、ディスク保存完了を保証しません。

回帰テストは`node --test tests/*.test.mjs`、構文検査はCIの`node --check`で実行します。Browser / Mobile / IME / forced-colors / Clipboard権限は別途実機確認するGateであり、Unit test greenだけでは完了扱いにしません。

## GitHub Pages

`main` へpushすると `.github/workflows/deploy-pages.yml` が静的サイトをGitHub Pagesへ公開します。GitHubリポジトリの Settings → Pages で、Sourceを「GitHub Actions」に設定してください。
