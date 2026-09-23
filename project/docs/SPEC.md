# Project Specification

Status: active — first repository-local Base adoption

## Purpose

`lyric_reader_page` provides a browser lyric reader and writer. Its existing
document model, reader presentation, authoring flow, mobile gates, and browser
tests remain the Project's domain implementation.

## Acceptance

1. Existing Reader, Writer, mobile, and shared test behavior remains unchanged.
2. `knt doctor` validates the local Project Overlay and Base.
3. `knt verify` reaches the existing `npm test` suite.
4. GitHub Pages and deployment behavior remain Project-owned.
5. No Domain file is moved merely to satisfy the Base structure.

## Ownership boundary

- Reader, Writer, document state, browser presentation, and quality gates remain
  in the existing repository root.
- KiNoTch Base files and repository operations live under `.kinotch/`.
- The Project Manifest, contracts, and adoption state live under `project/`.
- Existing deployment workflow, Pages policy, and release behavior remain
  Project-owned.

## Commands

- Setup: `npm ci`
- Test: `npm test`
- Verify: `knt verify` (test fallback)

## Constraints

The Base does not impose a framework, PWA structure, generated artifact format,
or browser data model on this Project. Existing implementation and release
boundaries remain authoritative.
