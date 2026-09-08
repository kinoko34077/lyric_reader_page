# Changelog

## [Unreleased] — 2026-09-09

### Reader Kernel優先への方針転換

- 完成条件を汎用Writer全体から、Input → Syntax Adapter / Parser → IR → Registry Resolver → Renderer → ProjectionのReader Kernelへ切り替え。
- Parser停止・Source破壊・本文欠落・安全性・Glyph失敗時Fallback・Portable欠落をP0として優先する。
- Writer、Draft、History、複雑なVariant編集、IME / Caret / Native Undo、Style rename UI、3つ以上のStyle競合表示はReader完成後のBeta改善へ移動。
- 旧字・Ruby・複合Presentation・Combine・Glyph・Escape・複数行Presentationを含む`reader-kernel-golden.txt`をKernel回帰fixtureとして追加。
- URL / ManifestのFetch本文をストリーム単位でサイズ制限し、`Content-Length`が無い過大入力も全量展開前に拒否。超過時はStreamもcancelする。
- 画像Glyphの読込失敗をDOM Integration testで検証し、Ruby付きPortable Sourceへ確実に戻ることを回帰保護。
- Golden fixtureをWriter Renderer→DOM→Author Source→再Parseへ通すIntegration testを追加し、属性順のcanonical化を越えた意味Round-tripを検証。
- 現在HEADをDesktop Chromiumのlocal Viewerでsmoke確認し、設定Panelの単独開閉、縦書き時のTitle/本文方向同期、Console error/warn 0件をQuality Gateへ記録。Mobile/WebKitは未検証のまま。
- Canonical Container `LYRIC-READER/1`（JSON Header + 空行delimiter + Author Source Body）を追加し、active Variant以外のSource、未知Header、未知Version警告を保持。
- `.lyric.txt`またはmagic検出されたローカル入力をContainerとしてReader Documentへ変換し、既存TXT / Reader JSON経路と共存させた。
- `.lyric.txt`のCanonical Container書き出しUIを追加し、既存のTXT / Reader JSON / Portable Copy操作を維持。
- ローカルTXTの入力時に現行Syntaxと旧`[対象]{指定}`Syntaxを自動判定し、旧文書をLegacy Adapterのまま読込・編集できるようにした。
- format未指定の直接TXT URLもローカルTXTと同じSyntax自動判定を通し、Legacy本文をvNextとして誤解釈しないようにした。
- format未指定のReader JSON / Container / ManifestもSourceからAdapterを検出し、明示formatを優先するRead-many入力境界へ揃えた。
- Reader JSONの未知トップレベルFieldを不活性な拡張として保持し、Document state・Draft・Historyを経由したCanonical保存でも消さないようにした。
- URL Manifest読込でも同じ未知トップレベルField保持を適用し、入力経路による情報欠落をなくした。
- 欠損Style / Palette / Glyph / Font / Assetを本文表示継続のまま`⚠` Warning markerへ統一し、markerをPortable Copy・Author Source投影から除外。
- 未知のReader Document versionを本文・Variantが解釈可能な範囲で現行versionへBest-effort変換し、`unknown-version`警告を保持。現行形式での保存を促す。
- Registryの未知最上位Field・Style属性を文書拒否ではなく不活性`extensions`へ保持し、既知の安全な定義だけをResolverへ渡す。
- Registry Fontが未許可・未ロードのときも本文を標準Fontで表示し、Font fallbackをWarning markerへ記録。
- Reader読込時の一部不正Presentationを原文テキストへFail-soft Fallbackし、表示用Warning markerを残すようにした。Editorのstrict parse / round-trip契約は維持。
- 不正Presentationを含むSourceのPortable Copyもsafe projectionへ切り替え、例外ではなく原文を保全して返すようにした。
- 公開quality fixtureへ未知Registry extension、欠損Style / Font参照を追加し、Variant・Asset failureと合わせてFail-soft経路を常時検証。
- 旧Range Annotationの描画を停止し、Reader上のPresentationはAuthor Source / IR経路へ一本化。旧Annotation payloadは移行・保存用に保持するが、Source Presentationへ二重適用しない。
- 詳細は[`docs/READER-KERNEL-ROADMAP.md`](docs/READER-KERNEL-ROADMAP.md)を参照。

## [Unreleased] — 2026-09-08

この節は現在の作業ツリーへ実装・検証済みの変更だけを記録します。Quality Gateの判定とBrowser手動証跡は[`docs/QUALITY-GATES.md`](docs/QUALITY-GATES.md)で管理し、未検証項目を完了扱いにしません。

### Source / Document model

- Author Sourceを本文・Title・局所Presentationの正本として維持し、ViewのGlyph・字体変換・Font・Palette・Outline・Gradient・Combine・Writing ModeをSourceへ逆流させない構造に整理。
- Reader CoreをGeneric Variant Setへ移行。Document-definedなVariant ID / label / role / Source、Semantic Link、共有Presentation、Variant単位Overrideを保持し、旧`historical` / `modern`は入口Migrationへ限定。
- Title第1行の自動切り分け、BOM、LF / CRLF、空Source、1行Sourceを保持。本文編集時にTitleと本文を連結・欠落させない境界ヘルパーを追加。
- Reader Document / Draftをversion 3へ統一し、旧versionの明示Migration、将来versionのfail-closed、Source Metadataの保存、Registry / Variant / AnnotationのAtomic復元を実装。
- `data/demo/reader.json`をGeneric Variant形式へ更新し、品質検証用の長文・Presentation fixtureを追加。

### Syntax / Editor / Projection

- 既定Surface Syntaxを`[対象:指定]`へ移行。旧`[対象]{指定}`は`narou-legacy`（旧`narou` alias）でのみ扱い、Adapter Routerで形式を分離。
- Balanced scanner型Parserで複数属性、Nested Presentation、改行跨ぎ、Backslash escape、Ruby共存、未知指定のLiteral保持を実装。
- max depth / node / attribute / Source lengthを設け、空指定・Scoped Ruby指定の誤用・malformed入力を明示拒否。
- `edit → serialize → parse`のRound-trip Closureを、通常文字・Ruby・Nested・Multiline・Escape・Grapheme・複数Style・部分範囲で回帰テスト化。
- Editor範囲操作をIR上で行い、Span split / merge / unwrap、Ruby Base/Readingの部分Presentation、複数Styleを正規化。予約語Registry keyをUIとParserで共通拒否。
- DOMからAuthor Sourceを復元するEditor projectionをAdapter-aware化し、legacy文書の編集でvNext記法を誤出力しないよう修正。Ruby部分装飾を表示Markerから保持。
- Portable Text APIはPresentationを除去しつつRuby・Source文字を保持。全文CopyはPortable、標準TXT保存はAuthor Sourceそのものとした。
- 外部HTML pasteをplain textへ限定し、Caret復元、IME / Undo境界、autocorrect / autocapitalize / spellcheck抑制、Clipboard失敗時のfallbackを維持。

### Registry / Renderer

- Palette Slot / Palette Bank / Slot名、必須Slot 0/1、欠損Slotの1 fallback、Sourceからの明示Bank参照を実装。
- Named Styleの直接指定優先、任意階層継承、循環・深度検出、複数Style Conflict、Style rename transactionを実装。
- Outlineの相対`em`幅・複数Layer、GradientのRegistry HEX stop・logical direction・Palette 0 fallback・forced-colors fallbackを実装。ColorとGradientの最終優先規則はHOLDのまま。
- Glyphをtext / SVG / raster image / font glyphのTyped definitionとして検証・解決。複数文字Source、missing asset、未読込Fontでは元Sourceへfallbackし、SVGをinline DOMへ入れない。
- CombineをStraight / Parallel / Zの3Modeへ拡張し、縦書き・横書きで同じ意味指定をRenderer側で適応。
- 任意HTML / CSS / Script / Event Handler / 危険protocolを拒否し、Registry総量・Asset数・Asset総量・URL・Style keyを検証。

### State / UX / Delivery

- local Draft identityへfilename / size / mtime / SHA-256（非対応時は決定的fallback）を組み込み、同名別ファイルの衝突を低減。
- localStorage失敗時も編集を継続し、自動復元不可を通知。別TabのDraft更新を検知して現在の編集を優先する警告を表示。
- Historyを最大件数・概算UTF-8 bytesでbounded化し、Document identity変更時に履歴を初期化。
- Manifest JSON、Reader Document JSON、Source、Registry、Assetを個別validation pipelineへ分離。Local JSONもRemoteと同じJSON parser / size validationを通す。
- Header / Footerの自動収納、設定Panelの独立スクロール、半透明Scrollbar、縦横書き時の本文・Title向き同期を維持。
- 外部Web Fontの自動読込を初期OFFとし、明示許可・失敗時fallback・古いFont requestの上書き防止を実装。
- Node 22.14.0を`.nvmrc`で固定。CIはsyntax check / testをquality jobで行い、成功時のみPages deploy jobへ進む。Build ID整合テストを維持。

### Verification

- `node --check`で`assets/js`のJavaScriptを検査。
- `node --test tests/*.test.mjs`でUnit / Property / Integration / Regressionを実行。
- `git diff --check`でWhitespaceを検査。
- ChromiumでGeneric Variant、Registry表示、Style Conflict、Glyph fallback、Combine、Settings scroll、Writer実選択、縦横切替を手動確認。WebKit / iOS / Android実機、IME、forced-colors、Clipboard権限、外部CORSはQuality Gateへ未検証として記録。

### HOLD（未確定・実装側で確定しない）

- `HOLD-B7`: Serializerのlexical losslessとsemantic canonicalの最終選択。
- `HOLD-GRADIENT` / `HOLD-F6`: Gradientの最終意味および通常Colorとの競合。
- `HOLD-G2-detail`: External SVGのOrigin / CORS詳細。
- `HOLD-G5`: GlyphのScreen Reader Accessible Name。
- `HOLD-STYLE-3PLUS`: 3つ以上のStyle競合の具体的Visual分割。
- Title / Metadata / Variant Linkの表面Markupおよび元質問票I〜Sの未回答事項。

## Historical implementation record

以下は過去の実装単位を示す履歴です。現在の要件・検証状態は上記UnreleasedとQuality Gate文書を参照してください。

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
| `1350722` | Source移行安定化・大規模回帰テスト |
| `e7cd61e` | Generic semantic document model |
