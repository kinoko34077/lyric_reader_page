# Changelog

## [Unreleased] — 2026-09-10

### Reader Kernel優先への方針転換

- Source ModeをActive Variant本文だけの編集面からCanonical Container全体の編集面へ変更した。`LYRIC-READER/1`のJSON HeaderとAuthor Source Bodyをまとめて検証し、全Variant・Registry・Theme・Metadata・Extensionsをparse成功時だけDocumentへtransaction反映する。Source Modeの失敗時はCurrent Documentを保持し、Container本文内のParser位置をtextareaの行・列・Caretへ写像する。
- Source EditorのVariant切替ではDocument全体を誤って再利用せず、Variantごとの入力Sourceを分離して保持する。別Variantの編集がOriginal Sourceへ混入しないことをBrowser Gateで確認する。
- Draftへschema/base document hash/source identity/dirty timestampを記録し、実際のDocument変更時だけ保存するようにした。Viewerの表示設定だけでDraftを生成せず、基準文書と一致しないstale Draftは通常の復元通知へ出さない。
- Viewerの本文色変更をSession/User View Overrideへ分離し、Document registry/theme・dirty・Draftを変更しないようにした。非表示要素へ`[hidden]`契約を適用し、stale Draft通知がCSSの`display:flex`で誤表示される経路も修正した。
- Canonical Source編集後も元文書のSource identity / nameを保持し、再読込時にDraft keyが変わって復元候補を見失う問題を修正した。
- WriterのRuby編集経路をSource-SSOTへ寄せ、表示DOMがSafari相当の平坦化を受けても編集対象外のRubyを`data-source-raw`から復元するようにした。縮約Caret入力はsemantic IR rangeへ直接挿入し、Ruby境界での隣接入力による平文化を防止する。
- Portable RubyのCopy→PasteをWriter Browser Gateへ追加し、`｜親文字《ルビ》`をParser / Renderer経由で貼り付けてAuthor SourceへRubyとして再構成する。Ruby直前・直後入力、Reading編集、flattened DOM保護をUnit / DOM / Browserで回帰検証する。
- 完成条件を汎用Writer全体から、Input → Syntax Adapter / Parser → IR → Registry Resolver → Renderer → ProjectionのReader Kernelへ切り替え。
- Parser停止・Source破壊・本文欠落・安全性・Glyph失敗時Fallback・Portable欠落をP0として優先する。
- Writer、Draft、History、複雑なVariant編集、IME / Caret / Native Undo、Style rename UI、3つ以上のStyle競合表示はReader完成後のBeta改善へ移動。
- 旧字・Ruby・複合Presentation・Combine・Glyph・Escape・複数行Presentationを含む`reader-kernel-golden.txt`をKernel回帰fixtureとして追加。
- URL / ManifestのFetch本文をストリーム単位でサイズ制限し、`Content-Length`が無い過大入力も全量展開前に拒否。超過時はStreamもcancelする。
- 画像Glyphの読込失敗をDOM Integration testで検証し、Ruby付きPortable Sourceへ確実に戻ることを回帰保護。
- Golden fixtureをWriter Renderer→DOM→Author Source→再Parseへ通すIntegration testを追加し、属性順のcanonical化を越えた意味Round-tripを検証。
- 現在HEADをDesktop Chromiumのlocal Viewerと自動Mobile Gate（Chromium Pixel 5 / WebKit iPhone 13相当）でsmoke確認し、設定Panelの単独開閉、縦書き時のTitle/本文方向同期、Console error/warn 0件をQuality Gateへ記録。実機iPhone Safari / Android ChromeはRelease Smokeとして別扱い。
- Canonical Container `LYRIC-READER/1`（JSON Header + 空行delimiter + Author Source Body）を追加し、active Variant以外のSource、未知Header、未知Version警告を保持。
- `.lyric.txt`またはmagic検出されたローカル入力をContainerとしてReader Documentへ変換し、既存TXT / Reader JSON経路と共存させた。
- `.lyric.txt`のCanonical Container書き出しUIを追加し、既存のTXT / Reader JSON / Portable Copy操作を維持。
- ローカルTXTの入力時に現行Syntaxと旧`[対象]{指定}`Syntaxを自動判定し、旧文書をLegacy Adapterのまま読込・編集できるようにした。
- format未指定の直接TXT URLもローカルTXTと同じSyntax自動判定を通し、Legacy本文をvNextとして誤解釈しないようにした。
- format未指定のReader JSON / Container / ManifestもSourceからAdapterを検出し、明示formatを優先するRead-many入力境界へ揃えた。
- URL本文の新規読込・再読込後も、外部Font許可時はRegistry Fontの取得・Fallback判定を再実行するようにした。
- 文書指定の外部Fontを既定で自動取得するようにし、ユーザーが明示的にOFFにした場合だけ停止する。取得失敗時は標準Fontと元Source表示へFallbackする。
- 欠損Registry参照・Font・Assetの表示用Warning markerを旧`⚠`から右肩の`⃠`へ統一し、Copy / Author Source projectionからは引き続き除外する。
- TXT / Reader JSON / `.lyric.txt`のダウンロード開始時にDirty状態やDraft Recoveryを消去しないよう修正した。保存完了ではなく開始checkpointという表示契約を維持する。
- Writer BetaのK6 Tab Draft分離を独立`writerTab`下位Gateとして記録し、Requirements MatrixとReader/Writer別の検証コマンドを現行CI構成へ同期した。
- Writer Browser GateにSource Editor専用の`writerSource`下位Gateを追加し、Variant隔離、valid Source→Viewer往復、parse error位置、Current保護、textarea native Undoを通常Writerシナリオから独立検証するようにした。
- Writer Browser Gateに`writerDocument`下位Gateを追加し、初期Source確定後の不正文書投入、URL/File失敗時のCurrent保護、成功後のエラー解除、K1文書Open Undoを通常Writerシナリオから独立検証するようにした。
- Writer Browser Gateに`writerWysiwyg`下位Gateを追加し、Presentation範囲内の本文置換をApplication Undo→Redoボタン→Author Source投影まで独立検証するようにした。
- Writer Browser Gateのランナーを失敗継続型へ変更し、一つの下位Gateが失敗してもSource／Document／WYSIWYG／Tab／故障系の残りを実行して結果を集約するようにした。
- 下位Gate集約ランナーをWriter専用Unitで検証し、先頭Gateの失敗後も後続Gateを実行しつつ最終終了コードへ失敗を反映する契約を固定した。
- Writerの表示面をReader Mobile Gateから分離した`writer-mobile-beta` Gateとして追加し、Chromium `Pixel 5`相当とWebKit `iPhone 13`相当でWriter起動、Title / 本文、Ruby、設定Panel、Variant / Ruby切替、縦書き同期、横overflow、Source→Viewer→Writer往復を検証する。Writer Browser Gateと同じくadvisory jobとして実行し、Reader Pages公開の依存にはしない。
- WriterのPresentation操作を独立した`writer-presentation-beta` Gateへ切り出し、Palette / Palette Bank、Named Style、Ruby Base / Reading、Glyph、Combine、Outline、Font fallback、複数Style conflictのAuthor Source往復と表示を通常Writerの状態遷移から分離して検証する。
- Writer Betaの通常Browser Gateを、確定SourceのViewer往復と不正Source時のCurrent保護に絞ったCore smokeへ整理した。Source Editor、Document transaction、WYSIWYG、Tab isolation、Storage故障、不正文Draftの詳細Gateは引き続き独立実行し、長大な状態依存シナリオの連鎖失敗で結果を隠さず、各結果を集約して終了コードへ反映する。
- WYSIWYG下位Gateへ縮約Caret入力、Presentation範囲の置換、改行、Plain Text貼付、削除、1行Title編集を移し、各操作後のAuthor Source再Parseと元Source復元まで独立検証するようにした。旧巨大シナリオ本体は削除し、実行されない重複Gateを残さない。
- Reader JSONの未知トップレベルFieldを不活性な拡張として保持し、Document state・Draft・Historyを経由したCanonical保存でも消さないようにした。
- URL Manifest読込でも同じ未知トップレベルField保持を適用し、入力経路による情報欠落をなくした。
- 欠損Style / Palette / Glyph / Font / Assetを本文表示継続のまま右肩`⃠` Warning markerへ統一し、markerをPortable Copy・Author Source投影から除外。
- 未知のReader Document versionを本文・Variantが解釈可能な範囲で現行versionへBest-effort変換し、`unknown-version`警告を保持。現行形式での保存を促す。
- Registryの未知最上位Field・Style属性を文書拒否ではなく不活性`extensions`へ保持し、既知の安全な定義だけをResolverへ渡す。
- Registry Fontが未許可・未ロードのときも本文を標準Fontで表示し、Font fallbackをWarning markerへ記録。
- Reader読込時の一部不正Presentationを原文テキストへFail-soft Fallbackし、表示用Warning markerを残すようにした。Editorのstrict parse / round-trip契約は維持。
- 不正Presentationを含むSourceのPortable Copyもsafe projectionへ切り替え、例外ではなく原文を保全して返すようにした。
- 公開quality fixtureへ未知Registry extension、欠損Style / Font参照を追加し、Variant・Asset failureと合わせてFail-soft経路を常時検証。
- text Glyphの置換結果をHTMLとして解釈せず、危険なMarkup文字列もテキストノードのまま表示するDOM安全境界を回帰テストへ追加。
- 旧Range Annotationをruntime state、History、Draft、payload、Rendererから撤去し、Reader上のPresentationをAuthor Source / IR経路へ一本化した。入力に残る旧フィールドは無視する。
- Readerの通常対応目安をSource約50,000文字までとし、現行500,000 code units等の制限は極端な入力を止める安全上限としてBest Effort範囲と分離した。
- Writer系の正本をReader優先方針へ同期し、`K1`（文書OpenのUndo）と`K6`（Tab単位Draft分離）をWriter Beta側の要件としてReader Release Gateから分離した。現行Readerの完成条件とは混同しない。
- Parser generator / Schema validatorを一度比較し、Static PagesのNo-build配布、独自Projection、Fail-soft Registry policyを理由に現行bounded local実装をv0.xでfreezeした。判断を[`docs/adr/0004-reader-kernel-library-freeze.md`](docs/adr/0004-reader-kernel-library-freeze.md)へ記録した。
- 公開Demoの実作品本文末尾へReader SmokeセクションとRegistry定義を追加し、Palette/Bank、Style、Outline、Combine、Glyph、missing Asset/Font、Variantの実入力経路を`tests/demo-smoke.test.mjs`で回帰確認するようにした。
- 現行Demoを新規Desktop Chrome tabで再確認し、Reader Smoke、設定Panel単独スクロール、縦書きTitle/本文同期、Variant切替、欠損Asset時の本文継続を観測した。iPhone Safari / Android Chromeは実行環境外として未検証のまま記録した。
- Playwrightを開発専用依存として追加し、`npm run test:mobile`でChromium Pixel 5相当とWebKit iPhone 13相当のAutomated Mobile Viewer Gateを追加した。本文、Ruby、Presentation、Fallback、Variant、設定Panel、縦書きTitle/本文同期、横overflow、Portable Copyを各環境で確認する。
- Mobile Gateの実機境界を明文化した。Playwright WebKitはSafari本体ではないため、実機iPhone Safari / Android Chrome、IME、soft keyboard、Clipboard権限はReader自動Gateと分離したRelease Smokeとして扱う。
- GitHub Actionsのquality jobへPlaywrightブラウザ導入とAutomated Mobile Viewer Gateを追加し、Mobile Gate成功をPages deployの前提へ組み込んだ。
- Writer Betaの第1段階としてSource Editorを追加した。`?mode=source`またはヘッダーの`Source`からAuthor Sourceを直接編集でき、parse成功時だけ現在のVariantへ反映し、無効なPresentationはCurrent Documentへcommitしない。Source Editorの確認はReader Mobile Gateから分離した`npm run test:writer`へ移した。
- Source Editorのparse失敗へParser由来のSource indexを伝播し、行・列付きのエラー表示へ改善した。既存のCurrent Document保護とWriter Beta Gateを維持する。
- Source Editorのparse失敗時にエラー位置へcaretを移動し、失敗箇所付近の短い改行安全なcontextを表示するようにした。Parser本体のerror contractは変更せず、Current Document保護を維持する。
- Reader Release GateとWriter Beta GateをCIジョブとして分離した。Pages deployは`reader-quality`だけに依存し、Writer Betaの失敗は記録しつつReader公開を止めない。Productionはno-build / runtime dependencyなし、Playwrightはdevelopment-only依存という方針をADR 0004へ同期した。
- Reader専用、Shared Contract、Writer専用Unitのテストスクリプトを分離し、Reader Pages deployはReader / Shared / Mobile Gateだけに依存する構成へ整理した。Writer Unit / Browser Gateは独立した助言ジョブとして常時実行する。
- Writer BetaのViewer範囲操作へFont指定（`font=name`）を追加し、欠損FontでもAuthor Sourceと元本文を保ったまま表示用WarningへFallbackするBrowser Gateを追加した。
- Source Editorのtextarea native UndoをApplication Historyと分離したWriter Browser回帰へ追加し、入力→Ctrl+ZでAuthor Sourceを復元できることを確認するようにした。
- Writer Browser GateへVariantごとのViewer編集往復を追加し、現代表記だけへのStyle適用・解除、原文Variantの非変更、Variant再切替後のPresentation保持を確認するようにした。既存属性順の差異はHOLD-B7のSemantic canonical方針に合わせて比較する。
- Ruby Base全体の選択をRuby Node全体へ昇格させず、`base-range` / `base-style`のScoped PresentationとしてAuthor Sourceへ保存・表示・解除できるようにした。Reading側の独立指定と合わせてBrowser Gateで確認する。
- Reader安定点`925cfc7`へ`stable`ブランチと`reader-v0.1.0`タグを作成し、Reader v0.xのFreeze checkpointを固定した。`main`はWriter Betaの継続開発に使用する。
- Writer Betaの`K6`を実装し、`sessionStorage`由来のタブ固有IDをDraftキーへ含めた。同一文書を複数Tabで編集してもDraftが上書き・復元候補へ混入せず、同一Tabのreloadではキーを維持する。`K1`は次のWriter Beta sliceで実装した。
- Writer Betaの`K1`を実装し、文書Open前のSnapshotへSource URL / name / identityを保持するようにした。URL本文を開いた後のUndoで元文書のAuthor Source・文書Identity・表示状態へ戻れることを`tests/writer-beta-gate.mjs`で確認する。
- Writer BetaのDraft復元を全Variant・Registry・Metadata・Theme・Source routing fieldsへ拡張し、Source Editorのreload→Draft復元でVariant別編集も戻ることを`tests/writer-beta-gate.mjs`で確認する。
- Writer Beta GateへStorage故障注入を追加し、localStorageの読込・書込・削除が失敗しても自動復元不可の通知だけで編集・Viewer反映を継続することを確認する。
- `K6`のTab単位Draft分離と矛盾する別Tab共有警告経路を削除し、別Tab間のDraft共有・競合解消をWriter Betaの未提供範囲として明文化した。
- 不正文書のローカル読込候補をCurrent Documentへ反映せず、正常なDocument / URL読込成功時には以前の読込エラー表示を解除することをWriter Beta Gateで確認する。
- URL本文の取得失敗も`reader-error`へ詳細表示し、既存Documentを保持したまま再試行できるようにした。成功したURL読込では同じエラー表示を解除する。
- URL本文の読込失敗時に試行URLをCurrent Documentのrouting欄へ残さず、文書Open→Undoでactive Variant・routing・Registry Style・Theme表示まで元文書へ戻るWriter状態境界をBrowser Gateへ追加した。
- Writer Browser GateへViewer上の選択範囲へのStyle / Palette / Glyph / Combine適用、Ruby Reading部分のScoped Style適用、Presentation解除、既存Presentation内の本文直接置換・キャレット入力を追加し、GUI操作後もAuthor Sourceの意味文字列が再読込可能な形で保たれることを確認した。欠損Glyphは元文字へFallbackし、Z字Combineでも複数DOM nodeをまたぐ選択を扱える。Ruby scoped属性は`ruby-range` / `ruby-style`として再parse可能な形を確認した。contenteditableの`beforeinput`で既存Presentation wrapperを保全し、Palette Slotの選択値が同期処理でSlot 0へ戻らないよう修正した。
- Writer BetaのPresentation AuthoringへOutline適用を追加し、既存のStyle / Palette / Glyph / Combine / Ruby操作と同じくAuthor Sourceへ再parse可能な`outline=name`として保存し、Resolverの相対em縁取りまでChromium Gateで確認した。
- Writer BetaのWYSIWYG貼り付けをPlain Text経路としてBrowser Gateへ固定し、選択範囲のPresentationを保ったままHTML/DOM情報をAuthor Sourceへ持ち込まないことを確認した。
- WriterのTitle直接編集をBrowser Gateへ追加し、第1行だけを更新して本文・既存Presentationを保持し、Sourceへ往復できることを確認した。
- WriterのPalette Authoringで選択Bank / Slot（例:`night:2`）を明示指定でき、Source・Viewerへ反映後に既定Bankと本文Sourceを復元できることをBrowser Gateへ追加した。
- Writer BetaのK6 Browser Gateを強化し、同一文書を開いた別TabのDraftキー分離だけでなく、一方のTabでDraftを破棄しても他方のDraftが保持されることを確認するようにした。
- Writer Browser Gateのreload直後に初期Author Sourceの確定を待つ同期点を追加し、初期読込競合による不正文書ロールバック検証の不安定さを除去した。不正文Draftの復元候補は本文が空ならCurrentへ反映せず、警告だけを表示して本文を保持するFail-soft境界も追加した。
- Writer Beta GateのK6 Tab/Draftシナリオを独立Browser Contextの`writerTab`下位Gateへ切り出し、通常のSource・Presentationシナリオの状態ずれから分離した。stableのBranch Rulesetは外部設定のため、設定済みと断定せず未確認状態をQuality Gateへ反映した。
- Writer Browser Gateへ既存Presentation内の改行操作を追加し、Serializerの範囲分割後もParser→Portableで改行の意味文字列と既存Styleを保つことを確認した。
- Writerの既存Presentation範囲をWYSIWYGで削除しても結果がparse可能なAuthor Sourceになり、選択文字が残留しないことをBrowser Gateへ追加した。
- Writerで同一範囲へ2つのNamed Styleを適用した場合、Sourceの複数指定を保持し、ViewerでConflict Warningを表示したうえで解除できることをBrowser Gateへ追加した。3つ以上のVisual分割規則はHOLDのまま維持する。
- ADR 0002の未知Reader Document version方針を、現行のBest-effort変換・読込不能時のみCurrent保持する実装と要件書へ同期。
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
