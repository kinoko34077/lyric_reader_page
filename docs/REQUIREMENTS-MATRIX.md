# Lyric Reader requirements matrix

基準仕様は、添付の `LYRIC_READER_CODEX_HANDOFF.md` と同内容の確定要件です。旧README・旧ADR・旧実装と衝突する場合は基準仕様を優先します。`HOLD` は実装側で確定しません。

## Gate status

| Gate | Status | Evidence |
| --- | --- | --- |
| Gate 0 Baseline Truth Freeze | PASS | `.nvmrc`, CI quality→deploy dependency, 既存回帰テスト、build-id test、本文/JSON制限テスト |
| Gate 1 Semantic Document Model | PASS | `document-model.js`, `document-state.js` v3、`tests/document-model.test.mjs`、Generic Variant回帰 |
| Gate 2 Syntax Adapter vNext | BLOCKED | Gate 1後に着手。旧Syntaxは現行互換として残るが、新Syntax移行は未実施 |
| Gate 3 Ruby Semantic Editing | BLOCKED | Gate 2後に着手 |

## Gate 1 traceability

| Requirement | Current implementation | Test |
| --- | --- | --- |
| Author Source / Source precedence | `document-model.js`: `resolveTitle`, `resolveMetadata`; appはVariant Sourceを編集正本として扱う | Source title/metadata precedence, source replacement |
| Generic Variant Set | `normalizeVariants`, `activeVariant`, appの`activeVariantId`; legacy `historical/modern`は入口移行のみ | Generic A/B labels, legacy migration |
| Variant Link | `links[].id` + `members[].variantId/anchor`; offsetをidentityにしない | 異なる本文長でshared Presentationを確認 |
| Shared Presentation | `links[].presentation` | link resolution |
| Per-Variant Override | `variantOverrides` + `setVariantOverride` | overrideが他Variantへ漏れないこと |
| First-line / explicit multiline title model | `resolveTitle({source, explicitTitle})`;具体表面Syntaxは未確定 | empty/first-line/multiline explicit title |
| Draft / History isolation | generic `documentPayload`、Draft/Reader document v3 migration、既存bounded history | document-state regression suite |
| Syntax replaceability | Core stateはVariant Source/IR意味モデルを参照し、Adapter routerを維持 | adapter capability/router regression |

## Deferred requirements

Gate 1では以下を実装・確定しない。

- `HOLD-B7`: SerializerのLexical lossless vs canonical
- `HOLD-GRADIENT`: Gradientの意味、color/outlineとの競合
- `HOLD-G2-detail`: 外部SVGのOrigin/CORS詳細
- `HOLD-G5`: GlyphのAccessible Name
- `HOLD-STYLE-3PLUS`: 3つ以上のStyle conflict visual rule
- Syntax vNext、Ruby部分編集、Palette Bank、Style継承、Glyph/Combine等の後続Gate機能

コードだけを追加して完了扱いにせず、各Gateで Unit → Property/Round-trip → Integration → Browser → Regression → Evidence の順に検証する。
