# ADR 0005: Source-backed Writer editing surface

## Status

Accepted — 2026-09-11

## Context

Author Source is the canonical document representation. The existing Writer has separate editable Title and body elements and still contains fallback paths that reconstruct Source from rendered DOM. That makes normal editing depend on browser mutations to Ruby, Presentation, block elements, selection, and IME composition. The Reader Kernel and Syntax Adapter already provide the required parse, IR, range operation, serialization, and projection contracts.

## Decision

Writer will use one `#writer-surface` editing host backed by the active Variant's Author Source. Title and body remain visual child projections only. Supported user operations are converted into semantic Source/IR range transactions, then parsed and rendered through the existing Adapter. DOM serialization is restricted to an explicit Ruby-edit/unsupported-browser compatibility escape hatch and is not the normal input path.

The existing Viewer remains a projection and may keep separate Title and body layout elements. Source Mode remains the canonical container textarea projection. Neither View DOM nor the Source Mode textarea becomes a second document authority.

## Consequences

### Positive

- Ruby, Presentation, IME, paste, and Title/Body boundary operations share one Source edit model.
- A valid completed Ruby is recognized by the same Parser in Writer and Source Mode.
- Browser-specific DOM mutations cannot silently rewrite unrelated Source nodes during ordinary input.
- The browser can maintain the active selection inside one editing host instead of moving focus between Title and body elements.

### Costs

- The Writer markup and selection mapping require a migration from two independent roots to one host.
- Title/body cross-boundary ranges need explicit semantic mapping around the first newline.
- Incremental projection can be introduced later; the first implementation may reproject the Writer children after a successful Source transaction, but it must not restore saved scroll or use DOM serialization for that transaction.
- Existing compatibility fallback remains temporarily for unsupported Ruby-internal editing until Source-range mapping covers it.

## Rejected alternatives

- Keeping separate Title/body contenteditable elements and strengthening the focus bridge: this preserves the boundary problem rather than making the Source range continuous.
- Treating the rendered DOM as a richer Source representation: this loses distinctions such as Ruby Base/Reading and display-only Glyph fallback.
- Adding Ruby-specific Paste DOM construction: this duplicates Parser semantics and violates the plain-text Source insertion requirement.
- Rewriting the Reader Kernel or Parser: the current contracts already provide the required behavior and are outside this correction.

## Verification

The migration is accepted only when focused Source-backed Writer tests, Reader/Shared/Writer Unit tests, Writer Browser sub-gates, Presentation and Mobile gates pass. Real-device Safari, Native Clipboard/IME, stable branch protection, and official Nishiki-teki Web Font delivery are release-smoke obligations and cannot be claimed from Playwright alone.
