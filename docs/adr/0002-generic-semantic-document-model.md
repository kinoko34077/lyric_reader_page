# ADR 0002: Generic Variant and Author Source semantic model

## Status

Accepted. Supersedes the historical/modern assumptions in ADR 0001 where they conflict; ADR 0001 remains a historical record of the original Adapter boundary. Surface Presentation decisions are further specified by ADR 0003.

## Decision

Reader Core stores a document as a generic Variant Set. Each Variant has a stable document-defined `id`, display `label`, optional `role`, and an Author Source. Legacy `historical` / `modern` fields are accepted only by migration code and are not the Core model.

Author Source is the semantic source of truth for title, body, Ruby, links, and local presentation. JSON metadata is derived/supporting data; when the two disagree, Source wins. The DOM is never used as the source of truth.

Variant correspondence uses semantic link IDs and member anchors, not character offsets. A link can carry shared Presentation. A Variant may carry an explicit override, which is merged over the shared default without mutating other Variants.

Reader Document and Draft payloads use model version 3. Versions 1 and 2 migrate explicitly; future versions are converted best-effort when their Source / Variant content is understandable, with a warning retained. Candidates that cannot produce a readable Variant Set fail closed without replacing the current document.

## Consequences

- The current Variant selector is populated from document-defined labels.
- Existing two-Variant documents remain readable through a boundary migration.
- Surface Syntax remains an Adapter concern. The vNext Adapter is now implemented separately from this model; explicit title/metadata/link surface spellings remain undecided.
- Explicit title markup is represented in the semantic model, but its surface spelling remains undecided.
