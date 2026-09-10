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
- `.lyric.txt` and magic-detected local files route through the existing transactional Reader Document loader; legacy TXT and Reader JSON remain readable. Plain local TXT automatically selects the legacy Adapter when the pre-vNext `[対象]{指定}` form is detected.
- Canonical Container export is available beside the existing TXT, Reader JSON, and Portable Copy actions; the legacy export paths remain unchanged.

### 必須

- TXT / URL / Reader JSONの入力境界（format未指定のTXT URL / JSON / Container / ManifestもLegacy Adapterを自動判定）
- vNext / Legacy Syntax Adapter分離
- Ruby、Escape、Nested、Multiline、Presentation参照
- Typed IR、Serializer、Portable / Plain Projection
- Parserの深度・要素数・属性数・Source長制限
- URL / Manifest入力のストリーム本文を上限前に打ち切るサイズ境界
- Registry validation / resolution
- RendererのSource非破壊、Glyph失敗時の元文字Fallback
- 欠損Registry参照・Asset失敗の表示用Warning marker（Copy / Author Source投影から除外）
- 一部不正PresentationはReader表示時に原文へFail-soft Fallbackし、表示用Warningを残す（Editorのstrict parse契約は維持）
- Reader Documentの未知versionは理解可能な本文を現行形式へBest-effort変換し、未知version警告を保持
- Reader JSON / Manifestの未知トップレベルFieldは不活性拡張として保持し、Draft / History経由のCanonical保存でも消さない
- Registryの未知Fieldは不活性拡張として保持し、既知のAllowlist外の処理を実行しない
- Registry Fontの未ロード時は標準FontへFallbackし、右肩`⃠`の表示用Warning markerを残す。文書指定Fontは既定で自動取得し、ユーザーがOFFにした場合を除き、URL本文再読込・切替後もRegistry Font解決を再実行する
- 旧Range Annotationはruntime state、History、Draft、payloadから撤去し、入力に残る旧フィールドもPresentationとして扱わない
- 任意HTML / JavaScript / 危険protocolの実行禁止

### Gate

- Parseで本文文字が消失しない
- Serialize後に再Parseできる
- PortableはPresentationだけを除去し、Rubyと本文を保持する
- 不正Presentationを含むSourceでもPortable Copyは例外・本文欠落を起こさず、原文Fallbackを返す
- PlainはPortableからRubyだけを除去する
- View変換結果をAuthor Sourceへ逆流させない
- Malformed入力がhang・無限再帰・巨大展開を起こさない

### 現在地

既存のAdapter、IR、Projection、Registry、Renderer、Fallbackに加え、実作品相当の長文Golden Fixtureを追加済み。Variant、Remote Font、Asset failure、未知Registry extension、欠損Style / Font参照もfixtureへ含め、Reader Release GateはChromium mobile / WebKit iPhone emulationまで自動化済み。Parser / Registry libraryは比較の結果、現行のbounded local実装をv0.xでfreezeした（[`ADR 0004`](adr/0004-reader-kernel-library-freeze.md)）。安定点`925cfc7`は`stable`ブランチと`reader-v0.1.0`タグで固定し、以後の`main`はWriter Betaを進める。

## Stage 2 — 最低限のPresentation

Palette、Style、Glyph、Combine、Font、Outlineを閲覧用途として維持する。Gradientは暫定扱いとし、意味論の確定まで拡張しない。Style Rename UI、3つ以上のConflict分割などは後回し。

## Stage 3 — Readerとしての実用化

横書き、縦書き、Ruby表示、Variant切替、字体、文字サイズ、Palette、Copy、TXT download、URL/File open、Desktop閲覧、およびChromium mobile / WebKit iPhone emulationによるReader Mobile Release Gateを確認する。実機iPhone Safari / Android ChromeはRelease Smokeへ分離し、EditorはBetaとして扱う。

## Stage 4 — Editor改善

### Writer Beta — current implementation and next boundary

Reader Kernelは`stable` / `reader-v0.1.0`の`925cfc7`で凍結し、`main`はWriter Betaを進める。Source Editorは`?mode=source`とヘッダーの`Source`切替からAuthor Sourceを直接編集し、parse成功時だけ現在のVariantへ反映する。無効なPresentationはCurrent Documentへcommitせず、行・列・失敗位置付近のcontextを表示する。初期reload完了前の置換操作はBrowser Gateで確定Sourceを待ってから実行し、不正文書・不正文DraftはCurrentを保持する。

Writer Stateでは、全Variant・Registry・Metadata・Theme・Source routingを含むDraft、`K6`（Tab単位Draft分離と片側破棄保護）、`K1`（文書を開く操作自体のUndo）を実装済み。Presentation AuthoringはPalette、Style、Ruby Base/Reading、Glyph、Combine、Outline、Fontまで、WYSIWYGは本文置換・Caret入力・削除・Plain Text paste・Title編集・Variant isolationまでBrowser Gateで確認済み。`npm run test:writer`は通常Writer、Source Editor、Document、独立Tab、Storage故障、不正文Draftの下位Gateを報告し、Reader Release Gateからは分離する。

次のWriter作業は、既存Gateを壊さない範囲でSource / Document / Presentation / WYSIWYGのBrowserシナリオをさらに独立実行単位へ分割すること。Caret、IME、Touch selection、soft keyboard、Style rename UI、Gradient最終仕様、HOLD群はReaderの再設計理由にせず、Writer Betaの後段へ残す。

## Severity

| Severity | Reader優先での扱い |
| --- | --- |
| P0 | Source破壊、本文欠落、意味変化、XSS、Parser hang、Portable欠落、Glyph失敗時の文字消失。即修正 |
| P1 | Ruby不可視、縦書き崩壊、Palette不動作、入力不能、Variant切替不能。Reader完成前に修正 |
| P2 | EditorのCaret、Undo、Draft、Touch選択など。回避策があれば後回し |
| P3 | UI polish、細かなAccessibility、Animation、性能改善。後回し |

## 検証コマンド

```text
npm run test:reader
npm run test:shared
npm run test:writer-unit
npm run test:mobile
npm run test:writer
node --check assets/js/*.js
git diff --check
```

`tests/fixtures/reader-kernel-golden.txt` は旧字・Ruby・複合Presentation・Combine・Glyph・Escape・複数行指定を含むReader KernelのGolden入力とする。
