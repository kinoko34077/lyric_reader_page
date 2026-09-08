# Lyric Reader 確定要件（v0.x）

この文書は、現行実装へ組み込む要件のリポジトリ内正本です。添付の引継ぎ資料および直近の確定要件を要約しています。旧README・旧ADR・旧実装と衝突する場合は本書を優先します。`HOLD` は未確定事項であり、実装側で仕様を確定しません。

## 1. 最上位原則

- Author Sourceを本文・タイトル・Metadata・Ruby・Variant対応Link・局所Presentationの正本とする。Reader JSONの同値情報は同期される派生情報であり、競合時はSourceを優先する。
- View / DOMの表示結果をAuthor Sourceへ逆流させない。Glyph、Font、Palette、Outline、Gradient、Combine、縦横書き、字体変換は表示上の表現である。
- `Source → Syntax Adapter → Syntax非依存IR → Reader Core` の境界を維持する。Renderer、Editor、Registry、Variant処理へ表面SyntaxのDelimiter知識を持ち込まない。
- Author Source、Portable Text、Plain Textを分離する。Portable TextはPresentationを除去してRuby等の意味を残し、Plain TextはRuby記法も除去する。
- 失敗途中の状態をCurrent Documentへcommitしない。Source保存、Round-trip、文書分離、Unicode/Grapheme境界、参照整合性、進捗表示を共通Invariantとする。

## 2. 文書・Title・Metadata

- 標準TitleはAuthor Source第1行。BOM、CRLF、空行、1行のみを定義された境界規則で扱う。
- 明示的Title範囲では複数行Titleを保持できるIRを用意する。ただし表面Markupは未確定。
- Artist、Credit、Note等のMetadataはSource内記述を正式対応対象とする。具体Syntaxが確定するまで、同期用`sourceMetadata`/JSON側表現を使う。
- Source MetadataとJSON Metadataの競合はSource優先。UI・Draft・Reader Documentもこの優先順位を維持する。

## 3. Variant

- Reader Coreは`historical`/`modern`へ固定せず、Document-definedなGeneric Variant Set（A/B/N）を保持する。旧形式は入口でのみ移行する。
- Variantは安定ID、表示label、任意role、独立Author Sourceを持つ。UIの切替はIDで行い、表示名は文書定義を使う。
- Variant間の対応はLink ID/semantic anchorで表現し、文字列長やoffsetをidentityにしない。
- Link範囲のPresentationは共有Defaultを原則同期し、Variant単位Overrideで上書きできる。未確定のanchor表面Syntaxを実装側で発明しない。

## 4. 保存・Projection

- 標準TXT保存はPresentation Markupを含むAuthor Sourceそのもの。
- Portable Text専用の保存/Export UIは置かない。通常の本文CopyがPortable Projectionを使う。
- `toPortableText()`等のProjection APIは内部境界として維持する。
- Reader Document/Draftはversionを持ち、既知versionのみ明示Migrationし、未知の将来versionはfail-closedする。DownloadはOSへの保存完了ではなく「ダウンロード開始」のcheckpointと表示する。

## 5. 暫定Syntax Adapter

v0.xの既定表面は次の形式とする。

```text
[文字:c=2]
[文字:style=shout]
[12:combine]
[晴:glyph=hare-special]
[文字:c=2,style=shout]
```

- 旧`[文字]{c=2}`は`narou-legacy`（旧`narou` alias）でのみ扱い、既定Adapterへ混在させない。
- Backslash U+005Cで構文文字をescapeする。少なくとも`\[`, `\]`, `\:`, `\{`, `\}`, `\｜`, `\《`, `\》`, `\\`をLiteralとして保持する。
- 複数属性、Nested Presentation、改行を跨ぐPresentation、Rubyとの共存をサポートする。
- 未知指定は黙って捨てずLiteralとして保持する。安全なAllowlist/Registry契約にない任意CSS、HTML、JavaScript、Event Handler、危険protocol、未検証Resourceは受け付けない。
- Editorが生成したSourceは必ず同じAdapterで再parseできる。`edit → serialize → parse → semantic IR`を全操作のInvariantとする。
- Parserは最大depth、node数、attribute数、Source長を制限し、malformed inputをfail-safeに扱う。

## 6. Ruby

- Base文字列とReading文字列を別のGrapheme範囲として選択・装飾できる。Ruby Nodeを一体固定しない。
- 通常範囲へのPresentationはBase/Reading双方へ同じ既定を適用する。
- ReadingまたはBaseの部分選択は個別Overrideとして保持する。
- Reader全体のRuby専用文字色設定は廃止し、一般Presentation/Paletteへ統合する。既定はBaseとReadingを同色にする。
- Portable標準は当面Narou/Aozora系Rubyとする。

## 7. Palette / Style

- Palette Slotは内部固定数を設けず、UIは見やすい範囲を列挙する。Slotには番号と任意名を持たせる。
- Palette Bankを持ち、同じSlot番号をBank単位で切替できる。Sourceから明示Bank参照も可能とする。
- Slot値の編集は同じBank/Slotの全参照へ反映し、局所変更で暗黙の別Slotを作らない。
- Slot 0/1は常在・削除不可。定義欠落時のDefaultは`0=#ffffff`、`1=#000000`。2以上の欠損参照はSlot 1へFallbackする。標準ForegroundはSlot 0と統合する。
- Named Styleは任意階層継承、cycle検出、安全な深度制限、決定論的Cascadeを持つ。Direct PropertyはNamed Styleより優先する。
- 複数Named StyleはIRで保持し、同一Propertyの競合をlast-winsで隠さない。Warning Markと確認可能なVisual fallbackを出す。3つ以上の分割規則はHOLD。
- RenameはRegistryだけを変更せず、全Variant Source、Link、Override、継承参照を一つのDocument Transactionで更新する。

## 8. Outline / Gradient

- Outline幅は固定pxではなく`em`等の文字サイズ相対を標準とし、多重Layerの順序を決定論的にする。
- Gradientは現在のexperimental実装をAdapter/Registry境界内に保持する。Writing Modeに追従する論理方向、Fallback、強制色での可読性を壊さない。
- Gradientの最終意味、通常Colorとの競合、Outlineとの関係は`HOLD-GRADIENT`として未確定。実装側で最終仕様へ昇格させない。

## 9. Glyph / Combine

- Glyph Resolverはtext、SVG、raster image、font glyphをTyped definitionとして扱える。Glyphは常にSource文字列を意味上の基準とする。
- 複数文字/複数Graphemeを一つのVisual Objectへ置換できる。Asset失敗・未登録・未許可Font時は元Source文字列を表示する。
- 外部AssetはHTTPS/安全なURL検証、サイズ・件数制限、Image contextへの隔離、失敗時Fallbackを行う。Font生成はReaderの責務外。
- CombineはStraight、Parallel、Z arrangementの3Mode以上を持ち、縦書き・横書きへRendererが適応する。非対応時は元文字列へFallbackし、Sourceへ縦横別記法を重複保存しない。
- GlyphのScreen Reader Accessible Nameは`HOLD-G5`。Sourceを意味基準とすることだけ確定する。

## 10. State / UX / Security

- localStorage失敗は編集失敗に波及させず、自動復元不可を通知して編集を継続する。Draftは永続保存を保証しない。
- Local Draft identityはファイル名だけでなくsize、mtime、content hashを含め、同名別文書を分離する。別Tab更新は警告し、現在の編集を優先する。
- Historyは件数・概算メモリを制限する。Document、Variant、Registryを跨いで復元しない。
- 外部HTML pasteはplain textへ限定し、IME中のUndo横取りを避け、caretを可能な範囲で維持する。Clipboard拒否時は選択コピーFallbackを示す。
- 任意Script、Event Handler、HTML、CSS injection、危険protocol、inline SVG実行を許可しない。Prototype-sensitive Registry keyを拒否する。
- Header/Footerは自動収納し、設定Panelは独立スクロール領域とする。縦横切替時もTitle・Metadata・本文の向きを同期し、本文のSourceを変更しない。

## 11. 現行Runtime制限

以下は本RepositoryのRuntime上限であり、別Repositoryの数値を仕様上限へ昇格させない。

- Source: 500,000 UTF-16 code units / 2,000,000 UTF-8 bytes
- Manifest JSON: 200,000 code units / 512,000 bytes
- Reader Document JSON: 2,000,000 code units / 4,500,000 bytes
- Registry: 1,000,000 bytes、各定義/Assetにも個別上限
- History: 最大40件、概算8,000,000 bytes

Source、Manifest、Reader Document、Registry、Assetはそれぞれ別のvalidation pipelineを通す。

## 12. HOLD

- `HOLD-B7`: Serializerのlexical losslessとsemantic canonicalの最終選択
- `HOLD-GRADIENT` / `HOLD-F6`: Gradientの意味および通常Colorとの競合
- `HOLD-G2-detail`: External SVGのOrigin/CORSの詳細規則
- `HOLD-G5`: GlyphのAccessible Name契約
- `HOLD-STYLE-3PLUS`: 3つ以上のStyle競合の具体的Visual分割
- Title/Metadata/Variant Linkの表面Markupおよび元質問票I〜Sの未回答事項

HOLDを理由に確定済みのSource保存、Parser安全性、Registry検証、Fallback、State isolation、Browserで可能な検証を止めない。
