# Source-backed Writer Design

## Status

Accepted from `Lyric Reader / Writer 要件再定義・構造修正指示書` on 2026-09-11. This design changes Writer only; the Reader Kernel, Syntax Adapter, IR, Registry, and Viewer projection remain the existing contracts.

## Problem

Writer currently exposes `#song-title` and `#lyrics` as separate editable DOM surfaces. Some supported operations are Source/IR transactions, but the remaining input and paste paths can edit the rendered DOM and reconstruct Author Source with `renderedBodySource()`. This makes Ruby, IME, Title/Body boundaries, and mobile selection depend on browser DOM mutations.

## Decisions

1. Author Source is the only Writer document authority. The current active Variant Source string is the input to every edit transaction.
2. Writer uses one `#writer-surface` editing host. Title and body remain separate child projections for visual layout, but neither child is an independent editing surface or state owner.
3. A supported `beforeinput` operation becomes a semantic range transaction: determine Source/IR range, apply `insertText`, deletion, paragraph, paste, or composition text, serialize, parse, then project.
4. DOM-to-Source serialization remains only as a bounded compatibility escape hatch for an explicitly edited Ruby part or an unsupported browser operation. It is not used for ordinary text input, deletion, paragraph insertion, paste, or composition.
5. The Writer surface is a projection of the current Source. A parseable completed Ruby is rendered as Ruby; an incomplete Ruby remains visible literal Source through the existing parser fallback.
6. Title and body use one logical Source range. The first Source line is styled as Title, while the separating newline and all body text remain in the same edit buffer.
7. Writer editing must not call saved-scroll restoration or programmatic caret restoration as part of every ordinary input transaction. Explicit document open, mode switch, and jump actions may restore scroll.
8. Viewer Copy projects the selected rendered range to Portable Text. Writer Copy projects the corresponding Author Source range. Source Mode keeps native textarea behavior.
9. Repeat-mark pairs remain two Source characters and receive two inline advances in vertical layout. Ruby Reading font size is relative to the configured Base font size.
10. A font preset is reported as applied only after its FontFace/resource resolves. If no verified Nishiki-teki Web Font URL and CORS/license contract exists, the preset is unavailable or visibly falls back; it is never reported as successfully loaded.

## Data flow

```text
Writer input / beforeinput
    ↓
Source or semantic IR range
    ↓
Edit transaction {start, end, insertedText}
    ↓
Author Source update
    ↓
Syntax Adapter parse
    ↓
IR + Writer projection update
```

The current `ReaderDocument` remains the state owner. `state.nodes`, `state.titleNodes`, and DOM markers are derived caches and may be replaced after a successful transaction; they are never independently committed as document truth.

## Error and fallback policy

- An invalid intermediate Source is not committed to `ReaderDocument`; the current valid Source remains available and the Writer status reports the parse error.
- A completed valid Ruby is rendered by the same Adapter used by Source Mode. Explicit `｜` Ruby is not restricted to kanji.
- Plain-text HTML paste reads only `text/plain`, inserts that text into Source, and lets the Adapter parse it. Paste code does not create Ruby or Presentation DOM nodes.
- Asset/font failure keeps Source text visible and adds the existing display-only warning marker.
- Native clipboard failure does not cancel the browser's default Copy fallback.

## Compatibility boundary

The first implementation keeps the existing Viewer projection and existing IR range operations. It introduces the single Writer host and routes ordinary input through the existing `replaceText` / `replaceDocumentRange` primitives before removing redundant DOM reconstruction paths. No Parser rewrite, TypeScript migration, framework, or Reader Kernel redesign is part of this change.

## Acceptance gates

- Writer surface has one editable host; Title and body are not independently contenteditable.
- `｜3ペウコ《ピョコ》`, `｜ABC《エービーシー》`, `｜123《ひゃくにじゅうさん》`, and `｜ペウコ《ピョコ》` round-trip through Writer and Source Mode using the existing Adapter.
- Ordinary text, deletion, paragraph, paste, and composition tests do not invoke DOM-wide Source reconstruction.
- Title/body cross-boundary selection and replacement use one logical Source transaction.
- Writer input does not restore saved scroll or replace the entire editing host during composition.
- Reader, Shared, Writer Unit, Writer Browser, Presentation, and Mobile gates remain green.
- Real iPhone Safari, Native Clipboard/IME, stable branch rulesets, and official Nishiki-teki Web Font delivery remain separately recorded as external release smoke items until directly observed.
