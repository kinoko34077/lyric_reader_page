# ADR 0001: Syntax Adapter boundary

## Status

Accepted for v0.x.

## Decision

Author Source is parsed by a replaceable Adapter before it reaches Reader Core. The current `narou-text` Adapter owns the provisional `[] {}` Presentation mapper and the existing Narou/Aozora-style Ruby parser. Reader Core consumes only the typed IR (`document`, `text`, `ruby`, `span`, and Presentation references).

`content.format` is resolved through `getSyntaxAdapter()`. Unknown formats fail explicitly; they are never silently interpreted as the default format.

## Why the parser remains local for now

The project needs the provisional Presentation syntax and its exact Source/Portable/Plain projections. No dependency in the current static Pages target provides that combined contract, and adding a general parser would not remove the project-specific mapper. The local implementation is therefore limited to the Adapter boundary, covered by round-trip and range-operation tests, and documented with JSDoc IR types so a future library-backed Adapter can replace it without changing Renderer or Editor code.

## Invariants

- Author Source remains the only editable semantic source.
- Presentation is removed from Portable Text and Plain Text.
- Ruby is an indivisible selection unit in v0.x.
- Unsupported Presentation attributes are rejected instead of dropped.
