# ADR 0002: Generic Variant and Author Source semantic model

## Status

Accepted for the Gate 1 migration. Supersedes the historical/modern assumptions in ADR 0001 where they conflict; ADR 0001 remains a historical record of the original Adapter boundary.

## Decision

Reader Core stores a document as a generic Variant Set. Each Variant has a stable document-defined `id`, display `label`, optional `role`, and an Author Source. Legacy `historical` / `modern` fields are accepted only by migration code and are not the Core model.

Author Source is the semantic source of truth for title, body, Ruby, links, and local presentation. JSON metadata is derived/supporting data; when the two disagree, Source wins. The DOM is never used as the source of truth.

Variant correspondence uses semantic link IDs and member anchors, not character offsets. A link can carry shared Presentation. A Variant may carry an explicit override, which is merged over the shared default without mutating other Variants.

Reader Document and Draft payloads use model version 3. Versions 1 and 2 migrate explicitly; future versions fail closed.

## Consequences

- The current Variant selector is populated from document-defined labels.
- Existing two-Variant documents remain readable through a boundary migration.
- Surface Syntax remains an Adapter concern and is intentionally unchanged until Gate 2.
- Explicit title markup is represented in the semantic model, but its surface spelling remains undecided.
