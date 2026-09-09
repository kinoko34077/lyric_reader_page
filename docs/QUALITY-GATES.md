# Quality Gate 証跡

## Current priority profile — Reader Kernel

2026-09-09以降は、汎用Writer完成ではなくReader Kernelを優先する。厳格対象はInput → Syntax Adapter / Parser → IR → Registry Resolver → Renderer → Projectionであり、WriterのCaret / IME / Undo、Draft / History高度化、複雑なVariant編集UI、Style rename UI、3つ以上のStyle競合表示はReader完成条件から外し、Beta改善へ回す。旧Stage A〜Eの表は既存実装の監査履歴として残し、Reader Kernelの判定は[`READER-KERNEL-ROADMAP.md`](READER-KERNEL-ROADMAP.md)とGolden Fixtureを正本とする。

### Reader Kernel Gate

| Check | Evidence | Status |
| --- | --- | --- |
| Parse / serialize / reparse closure | `tests/syntax-adapter.test.mjs`, `tests/reader-kernel-golden.test.mjs` | PASS |
| Portable / Plain projection preserves intended text | Syntax / Golden tests | PASS |
| Renderer DOM → Author Source → Reader JSON | `tests/dom-reader-json.test.mjs` | PASS |
| Registry validation / typed resolution | `tests/registry.test.mjs`, Golden test | PASS |
| Malformed input / parser bounds / unsafe Registry | fuzz, limits, security tests | PASS |
| Browser / mobile Reader smoke | Desktop Chromium plus automated Chromium mobile / WebKit iPhone emulation | PASS (Automated Mobile Gate) |
| Download recovery truthfulness | `tests/build-id.test.mjs` | PASS |

判定は現在の作業ツリーで実行した結果に基づきます。`PASS`は実装・自動テスト・必要なBrowser観測が揃った範囲だけに付け、外部Browser・実機・権限が必要な確認は`BLOCKED`へ分離します。Stage A〜Eは別Repositoryの指示に合わせた呼称で、Local Gateとの対応は以下の通りです。

## Historical Stage A–E summary

| Stage | Local Gate | Status | Evidence |
| --- | --- | --- | --- |
| A | Gate 0–1: Baseline / Semantic Document | PASS | `.nvmrc`、CI dependency、Document v3、Generic Variant、Source precedence、全回帰テスト |
| B | Gate 2: Syntax / Projection | PASS | vNext/legacy Adapter、escape、nested、multiline、unknown、fuzz、round-trip |
| C | Gate 3–4: Editor / Ruby / Registry | PASS | Grapheme/Ruby範囲、Editor bookmark、Palette Bank、Style inheritance/conflict/rename |
| D | Gate 5–6: Outline / Glyph / Combine | PASS | relative/multiple Outline、Gradient fallback、typed Glyph、asset fallback、Combine 3 mode |
| E | Gate 7–8: UI / release | PASS (Automated Viewer) | Desktop Chromium、Chromium mobile、WebKit iPhone emulationで主要Viewer導線を確認。実機iPhone/Android、IME、forced-colors、Clipboard権限、live deployはRelease Smokeとして外部確認 |

## Automated evidence

実行日時: 2026-09-09 JST

```text
node --check assets/js/app.js
node --test tests/*.test.mjs
npm run test:mobile
git diff --check
```

- `node --check`は`assets/js`全ファイルへ実施。
- `node --test tests/*.test.mjs`はUnit、Property/Round-trip、Integration、Regression fixtureを含む。
- `tests/build-id.test.mjs`はHTML、JS、CSS、`config.js`のcache-busting ID一致を確認する。
- `tests/large-source.test.mjs`は長文、連続Presentation、Ruby混在Projectionの保全を確認する。
- `git diff --check`はWhitespace errorなしを確認する。
- 固定test件数は記録値を正本にしない。最終判定時の現在HEADの実行ログおよびCI quality jobを正本とする。

### 2026-09-09 Chromium local Viewer smoke

- `python -m http.server 8765`で公開した現在HEADを`http://localhost:8765/?mode=viewer`から読み込み、AX tree上でデモ本文・Ruby・Variant・設定Panelを確認。
- Consoleの`error` / `warn`は0件。
- 「表示設定」は単独で開閉し、縦書き切替後に`#song-title`と`#lyrics`がともに`is-vertical` / `vertical-rl`となることを確認。
- これはDesktop Chromiumのlocal smokeであり、Mobile / WebKit / 実配信PagesのPASS証跡ではない。
- 今回の監査ターンでは既存Chrome local tabの再接続を試みたが、CDPが`Debugger unattached`を返し、別tabもtimeoutしたため、新しいBrowser PASS証跡は追加していない。
- 今回は新規Chrome tabの`http://127.0.0.1:4173/?mode=viewer`で現行Demoを再確認した。Reader Smoke本文・欠損Asset警告付きの継続表示、表示設定Panelの単独展開と内部スクロール、縦書き時のTitle/本文同期、Variantの原文→現代表記切替をAX treeと画面で確認した。

### Automated Mobile Viewer Gate

- `npm run test:mobile`で、現在のViewerをChromium `Pixel 5`相当とPlaywright WebKit `iPhone 13`相当の2環境から検証する。
- 各環境で、Page / Console error、Ruby、Palette / Style / Outline / Combine、欠損Glyph / Fontの本文Fallback、Variant切替、設定Panelのviewport内表示と内部scroll、縦書き時のTitle / 本文writing-mode同期、意図しない横overflow、Portable Copy経路を確認する。
- ローカル実行時は一時ディレクトリへ横書き・縦書き・失敗時のScreenshotを保存する。`MOBILE_GATE_OUTPUT`で保存先を変更できる。
- `MOBILE_GATE_URL`を指定すれば公開Pages等の配信先へ同じGateを実行できる。
- 同じGate内でSourceモードを開き、Author Sourceの原文表示、parse成功後のVariant反映、Viewer復帰後の本文表示まで確認する。無効入力をCurrent Documentへ反映しない契約は`tests/source-editor.test.mjs`で確認する。
- Playwright WebKitはSafari本体ではないため、実機iPhone Safari / Android ChromeはReader v0.xの自動Gateとは分離したRelease Smokeとして扱う。Writer、IME、Caret、soft keyboardはこのGateの対象外。
- 2026-09-09にPowerShellで`$env:MOBILE_GATE_URL='https://kinoko34077.github.io/lyric_reader_page/?mode=viewer'; npm run test:mobile`を実行し、公開Pagesでも`chromium-pixel-5` / `webkit-iphone-13`がPASSした。公開HTMLとローカルのbuild markerは`20260908-019`で一致している。
- GitHub Actionsの`quality` jobでもPlaywright依存・Chromium / WebKitを導入して同じGateを実行し、成功時だけPages deployへ進む。
- [`ebe1db4`のGitHub Actions run](https://github.com/kinoko34077/lyric_reader_page/actions/runs/34304668464)で、quality（全Test・syntax check・Automated Mobile Viewer Gate）と後続Pages deployがPASSした。

## Stage A — Baseline / semantic model

### PASS conditions

- Node baselineが`.nvmrc`で固定され、CIのquality成功がdeployの前提になっている。
- Author Source、Generic Variant、Source Metadata、Title、Draft、Historyが同じDocument identity境界にある。
- Reader JSON version migrationは未知versionでも理解可能なSource / Variantを現行形式へBest-effort変換し、警告を保持する。不正文書は従来どおりCurrentへ反映しない。

### Observed

- `tests/document-model.test.mjs`でGeneric A/B、異なる本文長のSemantic Link、Shared Presentation、Variant Override、Title/Metadata precedenceを確認。
- `tests/document-state.test.mjs`でversion 3 payload、旧version migration、unknown versionのBest-effort変換、同名ファイルのidentity差、History boundedを確認。
- `tests/data-loader.test.mjs`でManifest Variant metadata、duplicate ID、BOM付きJSON、Local/Reader JSONのvalidation分離を確認。

### Remaining

Title/Metadata/Variant LinkのAuthor Source表面Markupは要件が未確定であり、IR/同期フィールドまで実装して待機する。

## Stage B — Syntax / Projection

### PASS conditions

- 既定`narou-text`は`[target:attrs]`、legacyは明示`narou-legacy`だけで`[target]{attrs}`を扱う。
- Escape、Nested、Multiline、複数属性、Ruby共存、Unknown literalが同じAdapter境界で閉じる。
- Editorが生成するSourceが必ず再parseできる。

### Observed

- `tests/syntax-adapter.test.mjs`でParser、Serializer、Portable/Plain Projection、範囲split、Nested/Multiline/Escape、Grapheme境界、深度/属性制限、fuzz corpusを確認。
- `tests/editor-source.test.mjs`でlegacy/vNextの形式別復元とRuby装飾Marker保持を確認。
- Chromiumのquality fixtureでvNext Sourceが読み込まれ、Reader errorが発生しないことを確認。

### Remaining

Serializerの属性順・空白・Lexical lossless方針は`HOLD-B7`。現行はSemantic canonical serializerとして扱う。

## Stage C — Editor / Ruby / Registry

### PASS conditions

- Base/ReadingのGrapheme範囲を個別に装飾でき、通常Presentationは双方へ適用できる。
- Palette 0/1、Bank、Slot名、Style継承・Direct precedence・Conflict・Rename transactionが決定論的である。
- Toolbarへフォーカスを移しても直前の本文選択を失わず、装飾適用後のSourceが保全される。

### Observed

- `tests/registry.test.mjs`でPalette fallback、Bank、Style inheritance/cycle/depth、multiple conflict、Outline/Gradient/Glyph definition、reserved key、rename transactionを確認。
- `tests/syntax-adapter.test.mjs`でRuby Base/Readingの範囲、clear、Portable保持、全Editor output closureを確認。
- Chromium Writerで本文`ABCDE`をAX選択し、Style名入力へフォーカスを移した後も選択範囲へStyleが適用され、`data-source-raw`が保持されることを確認。
- 画面設定にはRuby専用Color Controlがなく、Ruby色は一般Presentation/継承へ統合されている。

### Remaining

IME、touch selection、OSのsoft keyboard下でのCaretはWebKit/iOS/Android実機でのみ再確認可能。

## Stage D — Outline / Glyph / Combine

### PASS conditions

- Outlineは相対幅・複数Layer、GradientはRegistry stop・fallback・logical directionを持つ。
- Glyphはtext/SVG/image/fontの型を保持し、Asset・Font失敗時にSource文字が消えない。
- CombineはStraight/Parallel/Zを縦横の表示方向へ適応し、Sourceへ表示結果を保存しない。

### Observed

- `tests/registry.test.mjs`でHEX/Palette Outline、複数Layer、Gradient stop、fallback、Glyph 4型、missing reference、Asset上限を確認。
- Chromium quality fixtureでTitleのOutline/Gradient、missing SVGの`glyph-failed`と元文字、文書指定remote Fontの自動取得失敗時の元文字、欠損Style / FontのWarning marker、未知Registry extensionの不活性保持、Parallel/Zの`.combine-unit`を確認。
- 公開デモの`data/demo/reader.json`は実作品本文にReader Smokeセクションを含み、`tests/demo-smoke.test.mjs`でPalette/Bank、Style、Outline、Combine、Glyph、missing Asset/Font、Author Source round-tripを同じManifest経路から確認する。
- `reader.css`のforced-colors fallbackはGradientを解除しCanvasTextへ戻す規則を持つ。

### Remaining

Gradientの最終意味・通常Colorとの競合は`HOLD-GRADIENT`/`HOLD-F6`。External SVGのOrigin/CORS詳細は`HOLD-G2-detail`。3つ以上のStyle分割は`HOLD-STYLE-3PLUS`。

## Stage E — UI / release

### Chromium PASS evidence

Local quality fixture:

```text
http://127.0.0.1:4173/?mode=writer#m=%2Ftests%2Ffixtures%2Fquality-manifest.json
```

- AX treeでVariantが文書定義の「原文」「現代表記」として表示され、Reader errorなし。
- Settings Panelの`scrollHeight`が`clientHeight`を超え、Panel内スクロールバーで下部の編集操作まで到達できる。
- Settingsに「ルビ色」専用Controlがなく、Combine選択肢が直行・併置・Z字で表示される。
- Header/Footerは`chrome-hidden`で収納され、スクロール・画面端pointerで復帰する。
- 縦書きでShellの横方向overflowが生じ、横書きへ戻すと`writing-mode: horizontal-tb`へ戻る。Title/本文は同じShell内で向きが同期する。
- Writer本文の実選択→Style名入力→適用、Palette、Conflict Warning、Glyph fallback、Combineを確認。
- 既定ブラウザのClipboard APIが使えない場合でも、実装に`execCommand("copy")` fallbackと選択コピー案内がある。

### BLOCKED: external-only checks

以下は現在のRepository、Node offline test、利用可能なChromiumだけでは証明できません。代替fixtureとfailure pathは実施済みです。

1. WebKit系Browser、iOS Safari、Android Chromeの実機/実エミュレータでの縦書き、safe-area、soft keyboard、touch selection。
2. 日本語IME composition、smart punctuation/autocorrect、native Undo、Ruby部分選択の各OS実装。
3. Browserのforced-colors/high-contrast実環境、印刷、FontFace/CORS、Clipboard permission拒否の実環境。
4. External SVG/Fontの実配信元によるCORS/MIME/Origin試験。

解除条件は、対象実機/Browserまたは外部配信環境を用意して上記手順を実行し、観測結果をこの文書へ追記することです。これら以外のリポジトリ内作業をこのBLOCKED理由で省略してはいけません。
