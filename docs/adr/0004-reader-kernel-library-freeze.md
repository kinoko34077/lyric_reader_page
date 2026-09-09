# ADR 0004: Reader Kernel library evaluation and v0.x freeze

## Status

Accepted for v0.x on 2026-09-09. Re-evaluate only when a Reader Kernel
requirement cannot be met safely or when the delivery model changes from the
current static, no-build Pages target.

## Context

The Reader Kernel currently has a local Syntax Adapter / parser and a local
Registry normalizer / validator. The open policy question was whether to
replace either boundary with a general parser library or a JSON Schema
validation library before declaring the Reader complete.

The relevant constraints are:

- the public target is a static browser deployment with no build step and no
  runtime npm dependency;
- development and CI tooling may use a package manifest and development-only
  dependencies such as Playwright;
- the Source syntax is a small, application-specific language with balanced
  presentation ranges, Ruby, escapes, nested presentation, multiline ranges,
  and Source / Portable / Plain projections;
- Reader input is fail-soft: unknown fields stay inert, missing Registry
  references warn and fallback, and malformed presentation must not hide the
  source text;
- the renderer and projections must consume syntax-independent IR rather than
  a library-specific AST.

## Options considered

### Parser

| Option | Benefit | Cost for this Reader |
| --- | --- | --- |
| Existing bounded local scanner | Direct control of balanced ranges, Ruby, escapes, limits, IR mapping, and canonical projections; no runtime dependency | Domain parser remains locally maintained |
| General grammar generator / parser-combinator library | Formal grammar tooling and generated parsing machinery | Adds dependency and usually a build or generated artifact; still requires custom Ruby, presentation validation, safety limits, IR mapping, and projections |
| Markdown / HTML parser | Mature text parsing ecosystem | Syntax and security model do not match the Author Source DSL; would add an unrelated AST and unsafe projection surface |

The current `assets/js/syntax-adapter.js` is 547 lines and already owns the
bounded scanner, adapter routing, typed IR, serializer, projections, and range
operations. The focused syntax suite covers escapes, Ruby, nested and
multiline presentation, grapheme boundaries, hostile limits, fuzz input, and
editor output closure.

### Registry / schema validation

| Option | Benefit | Cost for this Reader |
| --- | --- | --- |
| Existing local normalizer / validator | Keeps allowlisted data-only definitions, inert extensions, prototype-key rejection, asset limits, warnings, fallback, and resolver-specific semantics together | Schema rules remain local and must stay covered by tests |
| JSON Schema validator such as Ajv | Strong general-purpose structural validation and reusable schemas | Does not replace normalization, unknown-field retention, fail-soft warnings, prototype checks, or asset/resource policy; adds a browser dependency and schema/build integration |
| Code-schema validator such as Zod | Convenient application-side schemas and inferred types | Same missing domain policy as JSON Schema; adds runtime dependency without reducing resolver code in this no-build target |

The current `assets/js/registry.js` is 382 lines and the Registry suite covers
Palette fallback, Banks, Style inheritance/cycles, conflicts, Outline,
Gradient, Glyph/Font definitions, extension retention, reserved keys, asset
limits, and concrete resolution.

## Decision

Keep the local bounded parser and local Registry normalizer / validator for
v0.x. Do not add a parser library or JSON Schema runtime dependency solely to
close this policy question. The repository may keep `package.json` and a
lockfile for development and CI tooling; those files must not become a
production runtime or build requirement.

This is a deliberate freeze, not an assertion that local code is universally
better. The replacement boundary remains the Syntax Adapter and Registry
Resolver contracts, so a future library-backed implementation may be added
behind the same interfaces if it reduces code or is required for a new
requirement.

## Verification required by this decision

- Parser changes must keep the Syntax Adapter focused suite and Reader Kernel
  Golden / fuzz tests green.
- Registry changes must keep the Registry focused suite and fail-soft DOM
  integration tests green.
- A future dependency proposal must show lower code/maintenance cost, preserve
  the same IR and projections, and pass the same safety and fallback tests
  before replacing the frozen implementation.

## Consequences

- The Reader can remain directly deployable as a static Pages site.
- No parser or schema runtime dependency or browser bundle is introduced for
  v0.x.
- `package.json` / `package-lock.json` and a development-only Playwright
  dependency are allowed for automated Gates; they are test infrastructure and
  do not change the frozen Reader Kernel runtime/library policy.
- Parser and Registry maintenance remains a local responsibility.
- Writer refactors, TypeScript migration, and package architecture remain
  explicitly outside this Reader completion slice.
