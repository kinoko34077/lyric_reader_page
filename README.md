# 歌詞リーダー

外部のTXT / Reader JSON / `.lyric.txt`をブラウザから読み込み、歌詞・ルビ・各種Presentationを表示する静的Readerです。Writerでは本文を直接編集できます。ローカル本文はサーバーへ送信・保存しません。

Reader優先の現在ロードマップは[`docs/READER-KERNEL-ROADMAP.md`](docs/READER-KERNEL-ROADMAP.md)、最新の確定要件は[`docs/LYRIC_READER_REQUIREMENTS.md`](docs/LYRIC_READER_REQUIREMENTS.md)、実装と検証の対応表は[`docs/REQUIREMENTS-MATRIX.md`](docs/REQUIREMENTS-MATRIX.md)、現在のQuality Gate証跡は[`docs/QUALITY-GATES.md`](docs/QUALITY-GATES.md)を参照してください。Reader読込時の一部不正Presentationは原文表示へFallbackし、Warningを残して文書全体の表示を継続します。Desktop Chromeと自動Mobile Gate（Chromium Pixel 5 / WebKit iPhone 13 emulation）でViewerを確認済みです。実機iPhone Safari / Android ChromeはRelease Smokeとして別扱いです。

## 使い方

- デモ: `index.html`。実作品本文にReader Smoke用のPalette / Style / Outline / Combine / Glyph / Asset fallbackを少量含め、`tests/demo-smoke.test.mjs`で公開Manifest経路を回帰確認します。
- 外部Manifest: `index.html#m=https%3A%2F%2Fexample.com%2Freader.json`
- 外部TXT: `index.html#src=https%3A%2F%2Fexample.com%2Flyrics.txt`。Manifestでformatを指定しない直接TXT URLは、ローカルTXTと同じく現行 / Legacy Syntaxを自動判定します。
- Writer: `index.html?mode=writer`
- Source Editor: `index.html?mode=source` または画面上部の`Source`。Author Sourceを直接編集し、parse成功時だけ現在のVariantへ反映します。無効なPresentationは現在文書へ反映せず、Source Editor上で行・列・失敗位置付近の文脈付き警告を示し、可能な場合は該当位置を選択します。
- ローカルTXT / JSON: 「開く」または画面全体へのドラッグ＆ドロップ。TXTは現行`[対象:指定]`と旧`[対象]{指定}`を自動判定して読み込みます。
- `.lyric.txt`: JSON HeaderとAuthor SourceをまとめたCanonical Containerとして読み込み・書き出し

Manifest内の相対URLはManifest自身のURLを基準に解決します。外部サーバーはブラウザから読めるCORSヘッダーを返す必要があります。

## Author SourceとSyntax Adapter

Author Sourceを本文・Title・Ruby・局所Presentationの正本として扱います。Viewの字体変換、Glyph、Font、Palette、Outline、Gradient、Combine、縦横書きはSourceへ逆流しません。

```text
[文字:c=2]
[文字:style=shout]
[晴:glyph=hare-special]
[12:combine=parallel]
[如何《どう》:c=2,style=title]
[如何《どう》:base-range=0-1,base-c=3]
```

既定のvNext Adapterは`[対象:指定]`形式です。旧`[対象]{指定}`形式は`narou-legacy`（旧`narou` alias）Adapterで読み込みます。ローカルTXT、直接URL、format未指定のReader JSON / Container / Manifestでは旧記法を自動検出し、Reader Documentへ保持したうえで、保存時は読み込んだAdapterの形式を使います。明示されたformatは自動判定より優先します。Parser、Serializer、Portable Text、Plain Text、Editor操作は[`assets/js/syntax-adapter.js`](assets/js/syntax-adapter.js)の交換可能な境界に閉じ込めています。

Backslash U+005Cで`[ ] : { } ｜ 《》`等をescapeできます。Presentationは複数属性、Nested、改行跨ぎ、RubyのBase/Reading個別範囲に対応し、Writerが生成したSourceは同じAdapterで再読込できることを検証します。Parser / Registry libraryは現行のbounded local実装をv0.xでfreezeしており、比較理由は[`docs/adr/0004-reader-kernel-library-freeze.md`](docs/adr/0004-reader-kernel-library-freeze.md)に記録しています。

## Title・Metadata・Variant

通常は各VariantのAuthor Source第1行をTitleとして表示し、残りを本文として表示します。BOM、CRLF、空行、1行だけのSourceも境界規則に従います。明示TitleやArtist/Credit/Noteの表面Markupは未確定ですが、IRと同期用`sourceMetadata`はSource優先で扱います。

Reader Coreは`historical` / `modern`へ固定せず、文書定義のGeneric Variant Setを保持します。旧形式は入口でGeneric Variantへ移行します。VariantはID・label・role・独立Sourceを持ち、Semantic Linkの共有PresentationとVariant単位Overrideを保持できます。対応関係の正本はLink ID/anchorであり、offsetではありません。

## 表示・編集

表示設定では横書き / 縦書き、Variant、字体、ルビ、文字サイズ、背景色、文字色、フォント、Palette Bankを切り替えられます。Header/Footerは読書中に自動収納され、設定Panelは独立してスクロールします。縦横切替時もTitle・Metadata・本文の向きが同期します。

WriterではTitle・本文を直接編集し、外部HTML pasteはplain textとして扱います。`Source`モードではAuthor Sourceをそのまま編集し、parse成功時だけ現在のVariantへ反映します。parse失敗時は行・列・失敗位置付近の文脈を含む警告を表示し、可能な場合はtextareaの該当位置を選択したうえでCurrent Documentを変更しません。Viewer上のStyle / Palette適用とPresentation解除もAuthor Sourceへ再parse可能な形式で反映します。Writerは現段階ではBeta扱いで、Reader KernelのSource保全・Projection・安全性を優先します。EditorのCaret、IME、Draft完全復旧、複雑なVariant編集はReader完成後に必要性を見て強化します。画面上のGlyphや新字体をSourceへ書き戻さない原則と、Rubyの通常Presentation / 部分Overrideは維持します。

全文CopyはPortable Text（Presentation除去・Ruby保持）です。正常なSourceではPresentationだけを除去し、不正Presentationを含むReaderでも例外にせず原文を保全してCopyできます。標準TXTダウンロードはPresentation入りAuthor Sourceそのもの、`.lyric.txt`ダウンロードはJSON Headerとactive VariantのAuthor SourceをまとめたCanonical Containerです。旧Range AnnotationはReaderのruntime/state/payloadから撤去し、入力に残っていてもPresentationとして扱いません。Reader文書ダウンロードはOSへの保存完了ではなく、ブラウザがダウンロードを開始したcheckpointです。ダウンロード開始後も未保存状態とDraft Recoveryは維持します。Portable Text専用の保存UIは置いていません。

## Registry

RegistryはPalette / Palette Bank / Named Style / Outline / Gradient / Glyph / Fontを型付き・許可リスト付きで検証します。Palette 0/1は常在し、欠落時は`#ffffff` / `#000000`、2以上の欠損SlotはSlot 1へFallbackします。Styleは継承・cycle検出・複数指定Conflict Warningに対応し、Direct PropertyがStyleより優先されます。Outlineは相対幅と複数Layer、CombineはStraight / Parallel / Zを扱います。未知Fieldは安全な拡張領域へ保持しますが、解釈・実行はしません。

Glyphはtext、SVG、raster image、font glyphを受け付け、未登録・未読込・Asset失敗時は元Source文字列へFallbackします。欠損Registry参照、Font未読込、Asset失敗は本文を止めず、表示専用の右肩`⃠` Warning markerへ集約します。文書指定の外部Fontは初期状態で自動読込し、ユーザーが明示的にOFFにした場合だけ停止します。URL本文の再読込・切替後もRegistry Fontの解決を再実行します。SVGはinline DOMへ挿入せずImage contextで表示し、任意HTML / CSS / Script / Event Handler / 危険protocolは受け付けません。

## State・サイズ・互換性

Reader Document / Draftはversion 3です。既知の旧versionは明示Migrationし、未知versionも理解可能な本文・VariantをBest-effortで現行versionへ変換し、警告を出します。Reader JSON / Manifestの未知トップレベルFieldも不活性な拡張として保持し、Canonical Reader JSON保存で消さないようにします。Draftは永続保存ではなくRecovery用途です。localStorage失敗時も編集は継続します。不正文Draftの復元操作もCurrent Documentを置換せず、本文を保持したまま警告します。Historyは最大40件・概算8MBです。Writer Betaでは、全Variant・Registry・Metadata・Themeを含むDraft復元、TabごとのDraft分離（`K6`）、文書Open前checkpointによる文書切替Undo（`K1`）を実装済みです。K6は一方のTabでDraftを破棄しても他方のTabのDraftを保持するところまでBrowser Gateで確認します。いずれもReader v0.xの完成条件外で、別Tab間のDraft共有や競合警告は提供しません。

通常のReader対応目安はSource約50,000文字までです。それを超えるSourceは処理を試みるBest Effortで、性能保証には含めません。現行Runtimeには極端に巨大・悪意ある入力を止める安全上限としてSource 500,000 code units / 2MB、Manifest JSON 200,000 code units / 512KB、Reader Document JSON 2,000,000 code units / 4.5MBがあります。これらは本Repositoryの安全上限であり、Source、Manifest、Reader Document、Registry、Assetを同一上限で扱いません。

## 開発・検証

```text
node --check assets/js/app.js
npm run test:reader
npm run test:shared
npm run test:writer-unit
npm run test:mobile
npm run test:writer
npm run test:writer-presentation
npm run test:writer-mobile
git diff --check
```

`npm run test:mobile`はローカルの公開Demoを検証し、PlaywrightのChromium mobile / WebKit iPhone emulationを実行します。公開Pagesなど別の配信先を検証する場合は、PowerShellで`$env:MOBILE_GATE_URL="https://example.com/lyric_reader_page/?mode=viewer"; npm run test:mobile`のように指定します。実機ブラウザ、IME、soft keyboardはこの自動Gateに含めません。
`npm run test:writer`はWriter BetaのCore Browser Gateです。Readerの自動Mobile Gateとは独立しており、確定したAuthor Sourceを起点にvalid Source→Viewer→Writerの正本保持、parse不能なSourceをViewerへ反映しないCurrent Document保護を最小往復で確認します。Source Editor、Document transaction、WYSIWYG、Tab isolation、Storage故障、不正文Draftの詳細確認は同じランナーの独立下位Gateとして継続実行します。Source EditorのVariant隔離、valid Source→Viewer往復、parse errorの位置選択・Current保護、textarea native Undoは`writerSource`、不正文書投入前の初期Source確定、URL/File失敗時のCurrent保護、成功後のエラー解除、K1文書Open Undoは`writerDocument`、既存Presentation内の置換・改行・削除・隣接Rubyのsemantic削除を対象にApplication Undo→Redoボタン→Author Source投影は`writerWysiwyg` / `writerRuby`、K6のTab Draft分離・片側破棄保護は`writerTab`として独立実行します。Presentation操作は`npm run test:writer-presentation`、Writer表示面は`npm run test:writer-mobile`で別Gateとして実行します。Ruby部分指定はBaseが`base-range` / `base-style`、Readingが`ruby-range` / `ruby-style`、縁取りは`outline=name`、範囲Fontは`font=name`として保存され、欠損Fontでも元文字とWarningを維持し、解除後も元Sourceへ戻ることを詳細Gateで確認します。Writer Beta Gateの失敗は現段階ではReader Pages公開を止めません。

`npm run test:writer-presentation`はPalette／Palette Bank、Named Style、Ruby Base / Reading、Glyph、Combine、Outline、Font fallback、複数Style conflictのAuthor Source往復を、通常Writerの状態遷移から独立したChromium Gateとして確認します。失敗してもReader Release Gate、Writer State Gate、Writer Mobile Gateへ波及しないadvisory checkです。

`npm run test:writer-mobile`はWriterの表示面だけをPlaywrightのChromium `Pixel 5`相当とWebKit `iPhone 13`相当で確認します。Writer modeでのTitle / 本文表示、contenteditable表示、Ruby、Variant・Ruby切替、設定Panelのviewport内表示と内部scroll、縦書き時のTitle / 本文writing-mode同期、意図しない横overflow、Source→Viewer→Writer往復を検証します。さらに、表示DOMがRubyを平坦化した場合の隣接入力と、Portable RubyのCopy→PasteがAuthor SourceへRubyとして戻ること、Title末尾Enter／本文先頭Backspaceの境界操作、表示設定によるDocument Dirty非発生を両環境で確認します。IME、Caret、soft keyboard、touch selection、Clipboard権限、実機Safari / Android ChromeはこのGateの対象外です。Reader Mobile GateおよびWriter Browser Gateとは独立したadvisory checkで、Writerの失敗はPages公開を止めません。

CIでは`.nvmrc`のNode 22.14.0を使い、`reader-quality`（JavaScript構文検査、Reader専用Unit / Integration、Shared Contract、Reader自動Mobile Gate）が成功した場合だけPages Deployへ進みます。`writer-unit`、`writer-beta`、`writer-presentation-beta`、`writer-mobile-beta`は常に実行する別の助言的ジョブで、Writerの失敗はReader Pages公開を止めません。Unit / IntegrationのPASSとPages公開、Chromium以外の実機・IME・forced-colors・Clipboard権限検証は別状態として記録します。

## 未確定事項

Serializerのlexical lossless方針、Gradientの最終意味とColor競合、External SVGのOrigin/CORS詳細、GlyphのAccessible Name、3つ以上のStyle競合Visual規則、Title/Metadata/Linkの表面MarkupはHOLDです。これらを推測で仕様化せず、確定済みの安全性・Source保存・Projection・State isolationの実装を優先します。

## 主なディレクトリ

- `assets/js/syntax-adapter.js`: Surface SyntaxとTyped IR、Editor範囲操作、Projection
- `assets/js/document-model.js`: Generic Variant、Title、Metadata、Semantic Link
- `assets/js/document-state.js`: Draft、History、Document identity、Migration
- `assets/js/registry.js`: Palette / Style / Assetの検証・解決
- `assets/js/reader-view.js`: Safe Renderer、Ruby、Glyph、Combine、Source mapping
- `assets/js/editor-source.js`: Renderer DOMからAuthor SourceへのAdapter-aware projection
- `assets/js/app.js`: UIイベント、I/O、State境界の接続
- `tests/`: Unit、Property/Round-trip、Integration、Regression fixture
