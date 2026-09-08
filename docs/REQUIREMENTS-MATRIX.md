# Lyric Reader 要件トレーサビリティ

基準は[`LYRIC_READER_REQUIREMENTS.md`](LYRIC_READER_REQUIREMENTS.md)と、添付引継ぎ資料の確定事項です。旧仕様・旧ADRの記述は履歴として扱います。各行は「要件 → 実装 → テスト → 現在の観測 → 残存リスク」を対応づけます。

## Stage / Gate status

| Stage | Local Gate | Status | 判定根拠 |
| --- | --- | --- | --- |
| A 基盤・文書モデル | Gate 0–1 | PASS | `.nvmrc`、CI quality→deploy、version 3、Generic Variant、Source優先、全Regression |
| B Syntax / Projection | Gate 2 | PASS | vNext Adapter、escape / nested / multiline / fuzz / round-trip、legacy隔離 |
| C Editor / Ruby / Registry | Gate 3–4 | PASS | Ruby部分範囲、Grapheme、Caret bookmark、Palette Bank、Style継承・競合・rename |
| D Presentation / Asset | Gate 5–6 | PASS | Outline、Gradient fallback、Glyph typed resolver、Asset fallback、Combine 3 mode |
| E UI / Release | Gate 7–8 | BLOCKED | Chromiumで主要導線はPASS。WebKit/iOS/Android実機、IME、forced-colors、Clipboard権限等のみ外部検証待ち |

`BLOCKED`はリポジトリ内で代替できない実機・別Browser・外部Asset/CORS・権限境界だけを指します。Unit test、offline contract、Chromium検証、fixture、failure pathの作業はこの判定に含めて完了させています。

## Traceability

| Requirement | Implementation | Test / command | Observed result | Remaining risk / blocker |
| --- | --- | --- | --- | --- |
| Author Sourceが正本 | `document-model.js`, `app.js`, `reader-view.js`, `editor-source.js` | `syntax-adapter`, `editor-source`, `large-source` | View変換・Glyph・Font・Setting変更でSource意味文字列を置換しない | 実機のcontenteditable挙動はGate 8対象 |
| 第1行Title / BOM / CRLF / 空Source | `content-boundary.js`, `resolveTitle`, `sourceInfo` | `content-boundary.test.mjs` | 1行Titleと本文の境界を保持。1行Titleへの本文連結事故を修正 | 明示Titleの表面MarkupはHOLD |
| Source / JSON Metadata precedence | `resolveMetadata`, `sourceMetadata`, Reader/Draft payload | `document-model`, `document-state`, `data-loader` | Source側値を優先し、Reader Document/Draftへ保持 | Artist/Credit/NoteのSource表面SyntaxはHOLD |
| Generic Variant Set | `normalizeVariants`, `activeVariant`, loader/app | `document-model`, `data-loader`, browser quality fixture | Document-defined ID / label / role、複数Variant切替を確認 | 旧形式Migrationは互換入口のみ |
| Semantic Link / shared presentation | `linkedPresentation`, `setVariantOverride`, normalized `links` | `document-model.test.mjs` | 異なる本文長でもoffsetに依存せず共有値とOverrideを分離 | anchorの表面MarkupとRendererへの範囲適用は仕様未確定 |
| Draft / History isolation | `document-state.js`, `app.js` | `document-state.test.mjs`, full suite | version 3、旧version migration、unknown version拒否、count/byte bounded | localStorage evictionはBrowser環境依存 |
| vNext `[target:attrs]` | `narouTextAdapter`, `syntax-adapter.js` | `syntax-adapter.test.mjs` | color/style/glyph/combine/weight等をTyped IRへ変換 | v0.xの表面互換は保証しない |
| Legacy syntax isolation | `legacyNarouTextAdapter`, `getSyntaxAdapter` | adapter router test、legacy editor serialization test | `narou-legacy`だけが`{}`形式を出力。既定Adapterへ混在しない | 旧文書の実機編集をGate 8で確認 |
| Escape / unknown literal | bounded scanner、`isSafePresentationName` | syntax fuzz / escape / reserved-name tests | escapeは意味保持、未知属性はLiteral、予約名は拒否 | 正式Escape対象一覧はSyntax v1で再確認 |
| Nested / multiline / multiple attrs | balanced scanner、`mergePresentation`, `normalizeNodes` | nested/multiline/Style/round-trip tests | 入れ子・改行跨ぎ・複数Styleが再parse可能 | HOLD-B7によりLexical losslessは未確定 |
| Parser safety | `PARSER_LIMITS`, bracket pair scanner | depth / attr / fuzz corpus | 深い入力・属性過多・不正Scoped targetをfail-safe拒否 | 数値は本RepositoryのRuntime上限 |
| Editor Round-trip Closure | IR range ops → adapter serialize → parse | all editor output closure、full suite | Editorが生成したSourceは同じAdapterで再読込可能 | IME・Browser native selectionはGate 8対象 |
| Grapheme-safe selection | `Intl.Segmenter`, `graphemes`, range functions | combining mark / IVS / ZWJ tests | 1 Graphemeを途中分割しない | Segmenter未対応Browserはcode point fallback |
| Ruby Base / Reading partial | scoped Ruby decorations、`selectionOffsets`, `applyRubyPresentation` | Ruby range / clearing / projection tests、Chrome Writer | Base/Readingを別範囲で装飾。通常適用は双方、部分選択はOverride | iOS/Androidのtouch+IME未検証 |
| Ruby dedicated color removal | UIから専用色を撤去、`rt{color:inherit}` | HTML grep、browser settings AX | Ruby色専用Controlなし。一般Presentationへ統合 | Accessibility NameはHOLD-G5 |
| Portable / Plain projection | Adapter `toPortableText`, `toPlainText`, `rawText` | projection tests、Chrome Copy path | PortableはRuby保持/Presentation除去、PlainはRuby除去 | Clipboard権限failureの実機確認待ち |
| Palette 0/1 / missing fallback | `normalizeRegistry`, `paletteValue` | registry tests | `#fff/#000`常在、2以上欠損はSlot 1へfallback | UIの追加Slot表示は安全上限内 |
| Palette Bank / names / explicit ref | `banks`, `paletteNames`, `bank` Presentation、settings UI | registry tests、Chrome fixture | Bank切替と名前表示、Source explicit bank resolve | 同時編集のmulti-tab UXは警告のみ |
| Named Style precedence / inheritance | `resolvedStyle`, `resolvePresentation` | registry tests | Direct > Style、cycle/depth/missing refを検出 | Style property別の詳細Cascadeは今後拡張 |
| Multiple Style conflict | `styles[]`, `conflictColors`, warning mark/CSS split | registry tests、Chrome source selection | Conflictをlast-winsで隠さずWarningと二色splitを表示 | 3+ conflictのVisual規則はHOLD |
| Style rename transaction | `renameStyleInDocument` | registry rename test | Registry、Source、Variant、Link、Override、extendsを一括更新 | UI rename dialogは未提供（API境界は実装済み） |
| Outline relative / multiple | Registry outline layers、Renderer `em` stroke/shadow | registry tests、quality fixture browser | HEX/Pallette参照、多重Layer、決定的順序を確認 | 印刷・forced-colorsはGate 8対象 |
| Gradient provisional safety | Registry stops、logical direction、fallback、forced-colors CSS | registry tests、quality fixture browser | HEX stopとPalette stop、Palette 0 fallbackを確認 | `HOLD-GRADIENT`/`HOLD-F6`を最終仕様化しない |
| Typed Glyph / source fallback | `normalizeGlyph`, `reader-view` image/font/text branches | registry tests、editor-source tests、Chrome missing asset/font fixture | text/SVG/image/font、複数字列、失敗時元Sourceを確認 | External Origin/CORSはHOLD-G2-detail |
| Combine 3 modes | `normalizeCombine`, Renderer/CSS `straight/parallel/z` | syntax/registry tests、Chrome fixture | 横/縦とも同じSource指定でmode classとunit mappingを生成 | Browser差異・長大Combineの性能はGate 8対象 |
| Security allowlist | Registry validation、safe URL、safe annotation CSS、image-context SVG | registry security tests、full suite | Script/HTML/CSS injection/dangerous protocol/prototype keyを拒否 | 外部CORS/MIMEのlive probeは外部依存 |
| Storage / draft failure atomicity | `storageGet/Set/Remove`, staged load/restore | state tests、app failure paths | Storage失敗を編集失敗へ波及させず通知。不正文書はCurrentを保持 | Private mode/evictionの実機確認待ち |
| Input size separation | `parseJsonText(kind)`, `validateSourceText`, local preflight | data-loader/large-source tests | Manifest、Reader JSON、Sourceを個別上限で検証。Local JSONも同一pipeline | Browser File APIの異常実装はGate 8対象 |
| CI / build truth | `.nvmrc`, `.github/workflows/deploy-pages.yml`, build-id test | `node --check`, full test, build-id, `git diff --check` | Quality成功をDeploy jobへ依存。ID不整合を検出 | Push後のGitHub Actions/Pages live run確認が外部依存 |
| UI / responsive / chrome | `reader.css`, `index.html`, auto-hide/settings scroll | Chromium screenshot/AX and DOM observation | Settings独立scroll、Header/Footer収納、縦横切替、mobile幅表示を確認 | Safari/iOS/Android実機とsoft keyboard未検証 |

## Required commands

```text
node --check assets/js/app.js
node --test tests/*.test.mjs
git diff --check
```

固定test件数はこの文書へ手書きしません。最終判定では現在HEADで実行したコマンド出力とCI runを証跡とします。
