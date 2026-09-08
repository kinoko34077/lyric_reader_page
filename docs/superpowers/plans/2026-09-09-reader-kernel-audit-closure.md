# Reader Kernel Audit Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the locally actionable Reader Kernel audit findings without expanding Writer or presentation scope.

**Architecture:** Keep the current Syntax Adapter → IR → Resolver → Renderer → Projection path. Remove obsolete Range Annotation runtime/state/persistence paths, preserve recovery data until a download checkpoint is only reported as started, and align defaults/documentation/tests with Reader-first policy.

**Tech Stack:** Browser JavaScript modules, Node built-in test runner, Markdown documentation, GitHub Actions.

**Spec:** `docs/READER-KERNEL-ROADMAP.md`, `docs/QUALITY-GATES.md`, and the audit supplied in the task.

## Global Constraints

- Author Source remains the semantic source of truth.
- Reader failures are fail-soft unless they cause source loss, parser hang, unsafe execution, or irreversible corruption.
- Download status means browser download started; it does not confirm disk persistence.
- Runtime safety limits remain, but normal Reader support is approximately 50,000 characters and larger inputs are best effort.
- Do not add new presentation features, Writer completeness work, or broad refactors in this closure slice.

### Task 1: Remove obsolete Range Annotation runtime path

**Files:**
- Modify: `assets/js/runtime-integrity.js`
- Modify: `assets/js/app.js`
- Modify: `assets/js/document-state.js`
- Modify: `assets/js/reader-view.js` only if an annotation input remains
- Modify: `tests/runtime-integrity.test.mjs`
- Modify: `tests/dom-reader-json.test.mjs`
- Modify: `tests/document-state.test.mjs` if present

**Interfaces:**
- Preserve scroll capture/restore, ruby range normalization, and atomic document candidate validation.
- Remove `annotations` from live state, payloads, draft/history snapshots, and renderer inputs.
- The Source Presentation path remains the only runtime presentation path.

- [x] **Step 1: Write failing tests** asserting document payloads do not contain `annotations`, app state does not import or merge annotations, and legacy annotation input cannot affect render or saved Reader JSON.
- [x] **Step 2: Run focused tests and confirm they fail because annotation compatibility is still present.**
- [x] **Step 3: Remove annotation normalization/merge and all live/payload wiring while preserving unrelated runtime-integrity helpers.
- [x] **Step 4: Run focused tests, then the complete suite.**
- [x] **Step 5: Commit and push `refactor: remove legacy range annotations`.

### Task 2: Preserve recovery state across download initiation

**Files:**
- Modify: `assets/js/app.js`
- Modify: tests covering download wiring or add `tests/download-state.test.mjs`

**Interfaces:**
- `download()` remains a browser-start checkpoint.
- TXT, Reader JSON, and `.lyric.txt` downloads must not call `clearDirty()` or `clearDraft()` merely because `a.click()` was invoked.

- [x] **Step 1: Add failing source-level behavior tests for all three download handlers.**
- [x] **Step 2: Run focused tests and confirm the handlers currently clear recovery state.**
- [x] **Step 3: Remove those cleanup calls and retain the existing start-status messages.**
- [x] **Step 4: Run focused and full tests.**
- [x] **Step 5: Commit and push `fix: preserve draft after download start`.

### Task 3: Align external Font defaults and supported-range policy

**Files:**
- Modify: `assets/js/app.js`
- Modify: `tests/app-input-boundary.test.mjs` or the existing app behavior test
- Modify: `README.md`
- Modify: `docs/READER-KERNEL-ROADMAP.md`
- Modify: `docs/QUALITY-GATES.md`
- Modify: `docs/LYRIC_READER_REQUIREMENTS.md`

**Interfaces:**
- Document-declared remote Registry Fonts are attempted automatically when they pass the existing URL/security checks; failures fall back without hiding Source text.
- User preferences may still disable remote font loading explicitly.
- Normal supported Source range is approximately 50,000 characters; current larger safety limits are best-effort bounds, not a 500,000-character performance guarantee.

- [x] **Step 1: Add failing tests for automatic document-font loading and the policy wording.**
- [x] **Step 2: Run the focused tests and confirm the current default is false.
- [x] **Step 3: Set the document-load default to enabled, while keeping explicit user opt-out intact; update policy documents.
- [x] **Step 4: Run full tests and documentation consistency checks.
- [x] **Step 5: Commit and push `docs: align reader kernel policy and font defaults`.

### Task 4: Replace the small Golden fixture with a realistic Reader fixture

**Files:**
- Modify or create: `tests/fixtures/reader-kernel-golden.json`
- Modify: `tests/reader-kernel-golden.test.mjs`
- Modify: `docs/QUALITY-GATES.md`

**Interfaces:**
- Fixture remains offline and deterministic.
- It must exercise Ruby, legacy characters, Palette, Named Style, Outline, Glyph, Combine, Variant, remote Font definition, unknown Registry extension, and missing-asset fallback with a long multi-section Japanese source.

- [x] **Step 1: Add assertions requiring a substantial fixture and every listed capability.
- [x] **Step 2: Run the Golden test and confirm the current tiny fixture fails the size/coverage assertions.
- [x] **Step 3: Replace/extend the fixture using the existing real-work sample text and bounded local definitions.
- [x] **Step 4: Run Golden, full, syntax, and diff checks.
- [x] **Step 5: Commit and push `test: strengthen reader kernel golden fixture`.

### Task 5: Re-evaluate the remaining locally executable Viewer gate

**Files:**
- Modify: `docs/QUALITY-GATES.md`
- Modify: `docs/READER-KERNEL-ROADMAP.md`
- Modify: `README.md` only if the observed status requires it

**Interfaces:**
- Record automated and available local browser evidence separately from unavailable WebKit/iOS/Android/live deployment evidence.
- Do not claim Mobile/WebKit PASS without observation.

- [x] **Step 1: Run the current full automated suite and available local Viewer smoke.
- [x] **Step 2: Record only observed results and remaining external-only blockers.
- [x] **Step 3: Commit and push `docs: record reader kernel audit closure evidence`.

### Final verification

- [x] Run `node --test tests/*.test.mjs`.
- [x] Run `node --check assets/js/*.js` for every JavaScript file.
- [x] Run `git diff --check`.
- [ ] Confirm `git status --short --branch` is clean and `main` is synchronized with `origin/main` after the final push.
