# Changelog

## [Unreleased] - 2026-09-08

現在の`main`までの変更履歴です。正式なPresentation構文は未確定のため、以下の`[] {}`記法はv0.xの暫定実装です。

### 監査後の安定化

- スクロール位置保存・復元の対象を実際の`reader-shell`スクロール領域へ修正。
- 不正Registryを含むReader JSONを文書状態へ反映する前に検証し、現在文書を保持するよう修正。
- Rubyの部分選択で読み情報を失わないよう、Rubyを不可分な単位として保持。
- 5000行の長文、2000件の連続Presentation、Ruby混在Projectionを含む大規模回帰テストを追加。
- 全文コピーの表示名を実際のPortable Text出力に合わせて修正。

### Reader基盤

- 外部TXT / JSON / Reader JSONをブラウザ上で読み込む静的Readerを追加。
- `#m=`による外部Manifest読込と、`#src=`による外部TXT読込に対応。
- Manifestの相対URLをManifest自身のURL基準で解決。
- 外部データのHTTP(S)制限、サイズ制限、CORSエラー表示を追加。
- 任意CSS・HTML・Scriptを外部データから直接適用しない構成に整理。
- GitHub Pages Actionsによる`main`からの公開に対応。

### Source / Ruby / Projection

- なろう・青空文庫系Ruby記法を解析・表示。
- `｜親文字《よみ》`と漢字連続部の暗黙Rubyに対応。
- Unicodeの漢字プロパティを利用し、CJK互換漢字を含むRubyを処理。
- Source上の原文を正本として保持し、表示用の旧字→新字体変換と分離。
- 表示DOMからの原文記法復元と全文コピーを実装。
- Portable TextではPresentation指定を除去し、本文・改行・タイトル・Rubyを保持。
- Plain TextではRuby記法も除去し、本文文字列のみを生成。
- タイトル第1行の自動切り分け、BOM、CRLF / LFの保持に対応。
- タイトル・本文編集時にSourceの改行や本文境界を壊さないよう修正。

### 表示設定

- 横書き / 縦書き切替。
- 歴史的仮名遣 / 現代仮名切替。
- 原字 / 新字体切替。
- Ruby表示切替。
- 文字サイズ変更。
- 背景色、本文文字色、Ruby色の変更。
- Ruby色の有効 / 無効チェックボックスを追加。
- 明朝、ゴシック、等幅、游明朝、Noto Serif JP、Noto Sans JPを選択可能化。
- CORS対応の外部Webフォント読込に対応。
- 読込不能なフォントはFallbackへ戻す設計。
- 作品既定値とユーザー設定を分離し、「作品既定に戻す」を追加。
- 設定パネルのスクロール、Escape閉じ、外側クリック閉じ、フォーカス改善。
- 半透明系のスクロールバーと読書領域のスクロール位置維持。
- 横書き / 縦書きでスクロール方向を調整。
- 読書中のヘッダー / フッター自動収納と画面端での再表示。
- タイトルを本文と同じスクロール領域に含め、常時表示を解除。
- モバイル幅でのヘッダー折返し・設定パネル表示を調整。

### Writer / Viewer

- 同一ページ内でViewerとWriterを切替。
- `?mode=writer`で編集モードを直接開く。
- Writerでタイトル・本文を直接編集。
- Viewerでは編集操作を非表示化。
- モード切替時にSource、Variant、表示設定、Draft、文書識別子を保持。
- 本文・タイトルの未保存変更を検知。
- ファイル読込、D&D、URL読込、Manifest切替、再読込時の未保存Guard。
- `beforeunload`によるページ離脱警告。
- TXT保存とReader JSON保存でDirty状態を分離。
- TXT / Reader JSONの保存、Source URLコピー、共有リンクコピー。
- TXT / Reader JSONの画面全体ドラッグ＆ドロップ読込。
- 同一ファイルの再選択にも対応。

### Draft / History

- 文書識別子ごとのDraft保存・復元・破棄。
- Draft復元後も未保存状態を維持。
- historical / modern Variantを区別したDraft・History。
- 文書切替時に前文書のHistoryを新文書へ適用しない構成。
- Undo / Redoで本文、タイトル、Registryを復元。
- IME・通常入力欄の標準Undo慣習をできる限り維持。

### Reader JSON / Registry

- historical / modern両VariantをReader JSONへ保存。
- Metadata、Theme、Default View、Link、Registry領域をReader JSONへ保存。
- Palette / Style / Glyph / Font / Gradient / Outline Registryの受け皿を追加。
- Palette、Style、Glyphの許可済みデータのみを検証・正規化。
- 不正な色、名前、Presentation属性を拒否。
- 任意HTML、Script、CSSを実行・適用しない。
- 登録済みPaletteを文字色へ解決。
- 登録済みGlyphを表示上の文字へ差し替え。
- 未登録GlyphはSource文字列へFallback。

### 暫定Presentation記法

以下をSyntax AdapterでTyped IRへ変換します。

```text
[文字]{c=2}
[文字]{style=shout}
[文字]{glyph=hare-special}
[12]{combine}
[如何《どう》]{style=title,c=2}
```

- `c=N`：Palette参照。
- `style=X`：Named Style参照。
- `glyph=X`：Named Glyph参照。
- `combine`：組文字指定。
- Presentation付きSourceの再シリアライズ。
- Style / Glyph / CombineのWriter操作。
- 選択範囲の着色・装飾解除をAuthor Source内Markupへ移行。
- 既存のRange Annotationは互換的に読み込めるが、現在のWriter操作ではSource内Markupを優先。

### Syntax Adapter / 内部構造

- `syntax-adapter.js`を追加し、Parser固有記法をReader Coreから分離。
- `parse`、`serialize`、`toPortableText`、`toPlainText`、`validate`の契約を追加。
- `registry.js`を追加し、Registry検証とPresentation解決を分離。
- Reader表示、Copy Projection、Editor操作が直接Ruby Parserへ依存しない構成へ移行。
- 将来のParser・記法差替えをAdapter内に限定できる土台を追加。

### テスト・検証

- Node標準テストランナーによる回帰テストを追加。
- Parser、Ruby互換、Sourceラウンドトリップを検証。
- Portable Text / Plain TextのProjectionを検証。
- 不正Presentation属性の拒否を検証。
- Palette / Style / Glyph解決とGlyph fallbackを検証。
- Registry正規化と履歴復元用のDeep Cloneを検証。
- Presentation適用・解除の範囲処理を検証。
- JavaScript各モジュールの`node --check`を実行。
- `git diff --check`を実行。

実行コマンド：

```text
node --test tests/*.test.mjs
```

直近の結果：11 tests passed / 0 failed。

## 既知の未完了項目

- 実機のMobile Safari / Chromeでの最終統合検証。
- 実際のReader JSONにRegistry定義を含めたブラウザ表示テスト。
- Palette / Style / Glyph Registry編集UIの本格化。
- GlyphのSVG・Font asset解決と安全な表示。
- Nishiki-tekiのライセンス確認・self-host対応。
- Range Annotationの互換読込を含む完全廃止。
- Parser候補比較と正式Syntax仕様の確定。
- Typed IRの型検査・Schema validator導入。
- `app.js`のDocument State / Editor / I/O / View Preference分割。

## 主なコミット

| Commit | 内容 |
| --- | --- |
| `94ba09e` | Initial commit |
| `d4770e3` | 静的Lyrics Reader MVP |
| `3b4b62a` | 表示設定 |
| `4cd644a` | ローカル本文入力 |
| `1f26d64` | Portable Reader Document |
| `c77c442` | Reader本文Annotation |
| `8197ffb` | スクロール挙動修正 |
| `b434660` | Writer mode・表示設定保存 |
| `f85b7de` | Writer・文書操作UX改善 |
| `2ff37e2` | 編集時のSource保護 |
| `90d58cf` | コンパクトUI・Syntax Adapter導入 |
| `7aee1b0` | 暫定Presentation IR |
| `7ddbe7d` | Registry検証・解決 |
| `13a4546` | Source中心Presentation編集 |
| `fa4ee80` | Style / Glyph / Combine編集操作 |
| `4ad3d8f` | 暫定Presentation記法の文書化 |
| `1350722` | Source移行安定化・大規模回帰テスト |
