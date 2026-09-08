# Reader Kernel優先ロードマップ

2026-09-09時点の優先順位を、汎用Editor完成からReader実用化へ切り替える。

## 対象範囲

厳格に守る層は次の一経路とする。

```text
TXT / URL / Reader JSON
    ↓
Syntax Adapter / Parser
    ↓
Normalized IR
    ↓
Registry Resolver
    ↓
Renderer
    ↓
Portable / Plain / Author Projection
```

この経路では、本文保全・安全性・決定性をP0として扱う。Writer、Draft、History、複雑なVariant編集はReaderの完成条件から分離し、Beta / 便利機能として扱う。

## Stage 1 — Reader Kernel

### Phase 1 Container progress

- Canonical `LYRIC-READER/1` parser / serializer is implemented in `assets/js/lyric-container.js`.
- The format is `magic line + compact JSON Header line + blank-line delimiter + exact active Author Source body`.
- `.lyric.txt` and magic-detected local files route through the existing transactional Reader Document loader; legacy TXT and Reader JSON remain readable.
- Canonical Container export is available beside the existing TXT, Reader JSON, and Portable Copy actions; the legacy export paths remain unchanged.

### 必須

- TXT / URL / Reader JSONの入力境界
- vNext / Legacy Syntax Adapter分離
- Ruby、Escape、Nested、Multiline、Presentation参照
- Typed IR、Serializer、Portable / Plain Projection
- Parserの深度・要素数・属性数・Source長制限
- URL / Manifest入力のストリーム本文を上限前に打ち切るサイズ境界
- Registry validation / resolution
- RendererのSource非破壊、Glyph失敗時の元文字Fallback
- 任意HTML / JavaScript / 危険protocolの実行禁止

### Gate

- Parseで本文文字が消失しない
- Serialize後に再Parseできる
- PortableはPresentationだけを除去し、Rubyと本文を保持する
- PlainはPortableからRubyだけを除去する
- View変換結果をAuthor Sourceへ逆流させない
- Malformed入力がhang・無限再帰・巨大展開を起こさない

### 現在地

既存のAdapter、IR、Projection、Registry、Renderer、Fallbackに加え、実データ相当のGolden Fixtureを追加済み。現段階はKernel Gateの回帰を継続しながらReader実用化へ進める状態。

## Stage 2 — 最低限のPresentation

Palette、Style、Glyph、Combine、Font、Outlineを閲覧用途として維持する。Gradientは暫定扱いとし、意味論の確定まで拡張しない。Style Rename UI、3つ以上のConflict分割などは後回し。

## Stage 3 — Readerとしての実用化

横書き、縦書き、Ruby表示、Variant切替、字体、文字サイズ、Palette、Copy、TXT download、URL/File open、Desktop/Mobile閲覧を確認する。EditorはBetaとして扱い、Reader閲覧を優先する。

## Stage 4 — Editor改善

実利用でReader Kernelを壊すP0が発生した場合だけ即時修正する。Caret、IME、Native Undo、Draft完全復旧、Style rename transaction、複雑なVariant authoring、詳細Accessibility、印刷・forced-colorsはReader完成後に必要性を見て対応する。

## Severity

| Severity | Reader優先での扱い |
| --- | --- |
| P0 | Source破壊、本文欠落、意味変化、XSS、Parser hang、Portable欠落、Glyph失敗時の文字消失。即修正 |
| P1 | Ruby不可視、縦書き崩壊、Palette不動作、入力不能、Variant切替不能。Reader完成前に修正 |
| P2 | EditorのCaret、Undo、Draft、Touch選択など。回避策があれば後回し |
| P3 | UI polish、細かなAccessibility、Animation、性能改善。後回し |

## 検証コマンド

```text
node --test tests/*.test.mjs
node --check assets/js/*.js
git diff --check
```

`tests/fixtures/reader-kernel-golden.txt` は旧字・Ruby・複合Presentation・Combine・Glyph・Escape・複数行指定を含むReader KernelのGolden入力とする。
