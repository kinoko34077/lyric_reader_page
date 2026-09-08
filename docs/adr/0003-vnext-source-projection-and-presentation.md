# ADR 0003: vNext Source projection and Presentation boundary

## Status

Accepted for v0.x. The surface grammar remains provisional and may change
without promising v0.x lexical compatibility.

## Decision

The default `narou-text` Adapter accepts `[target:attributes]`. The legacy
`[target]{attributes}` grammar is isolated behind `narou-legacy` and is never
silently mixed with the default format. Both adapters emit the same typed IR:

```text
Author Source
    ↓
Syntax Adapter
    ↓
document / text / ruby / span / Presentation
    ├ Renderer
    ├ Editor commands
    └ Portable / Plain projection
```

The Author Source is the semantic source of truth. Renderer output, including
font substitution, glyph replacement, kanji transformation, palette, outline,
gradient, combine, and writing mode, is never written back into Source.

## Source contract

- Backslash U+005C escapes syntax characters.
- Presentation attributes may be repeated for named styles, nested, or span
  line breaks. Scoped `base-*` and `ruby-*` attributes require a Ruby target.
- Unknown Presentation attributes remain literal rather than being silently
  discarded.
- Parser depth, node count, attribute count, and Source length are bounded.
- Every Editor operation must satisfy `serialize → parse` closure. The
  Serializer currently canonicalizes semantic IR; lexical preservation is
  `HOLD-B7`.

## Ruby contract

Ruby Base and Reading use independent grapheme ranges. A normal Presentation
on a Ruby applies to both parts by default; selecting one part creates a local
decoration. The old global Ruby-color setting is not part of the model.

## Projection contract

- Author Source projection preserves Presentation markup.
- Portable Text removes Presentation but keeps Ruby.
- Plain Text removes Ruby notation as well.

The UI exposes normal Copy for Portable Text and standard TXT download for
Author Source. There is no Portable Text-only save button. Reader Document
download reports a download-start checkpoint, not confirmed OS persistence.

## Safety

Registry definitions are typed and allowlisted. Arbitrary HTML, JavaScript,
event handlers, CSS injection, dangerous protocols, and inline SVG execution
are rejected. SVG/image assets are rendered in image context. Missing assets
always display the original Source text.

## Deliberately unresolved

The final lexical Serializer policy, Gradient meaning and Color precedence,
External SVG origin/CORS detail, Glyph Accessible Name, three-plus-style
conflict layout, and Title/Metadata/Link surface markup remain HOLD items in
`docs/LYRIC_READER_REQUIREMENTS.md`.
