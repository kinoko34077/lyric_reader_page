# Source-backed Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Writer from rendered-DOM reconstruction to a single Source-backed editing surface while preserving the frozen Reader Kernel and existing Source/IR contracts.

**Architecture:** `#writer-surface` becomes the only Writer editing host. User operations are mapped to semantic Source/IR ranges, committed through existing Adapter range operations, parsed, and projected back into the surface. Viewer and Source Mode remain separate projections of the same `ReaderDocument`.

**Tech Stack:** No-build browser JavaScript with JSDoc, existing Syntax Adapter/IR, DOM/Playwright Browser Gates, Node `node:test` unit tests.

**Spec:** `docs/superpowers/specs/2026-09-11-source-backed-writer-design.md`

## Global Constraints

- Author Source remains the only Writer document authority.
- Reader Kernel, Parser, Syntax Adapter, IR, Registry, and Viewer contracts are not rewritten.
- Writer ordinary input must not use DOM-wide Source reconstruction.
- Paste reads `text/plain`, inserts it into Source, and lets the existing Parser interpret it.
- Incomplete syntax remains visible literal Source; invalid Source is not committed to Current Document.
- Saved scroll/caret restoration is not performed on every ordinary Writer input.
- Every task ends with focused tests, relevant regression tests, and a logical commit/push.

---

### Task 1: Freeze the Writer Source-backed contract in repository docs

**Files:**
- Create: `docs/superpowers/specs/2026-09-11-source-backed-writer-design.md`
- Create: `docs/adr/0005-source-backed-writer-editing.md`
- Modify: `docs/LYRIC_READER_REQUIREMENTS.md`
- Modify: `docs/READER-KERNEL-ROADMAP.md`
- Test: `tests/gate-separation.test.mjs` or documentation assertions only if existing conventions require them

**Interfaces:**
- Documents the existing `replaceText`, `replaceDocumentRange`, `serializeSource`, and `renderLyrics` contracts without changing their signatures.

- [x] **Step 1: Add the design and ADR documents**
- [x] **Step 2: Add explicit Source-backed Writer, single surface, dynamic Parser, plain Source paste, and no per-input scroll restoration requirements to the requirements matrix**
- [x] **Step 3: Mark the Writer roadmap as structural migration in progress and keep Reader frozen**
- [x] **Step 4: Run `git diff --check` and documentation/unit checks**
- [x] **Step 5: Commit and push `docs: define source-backed writer editing contract`**

### Task 2: Add pure semantic Source transaction helpers

**Files:**
- Create: `assets/js/writer-source.js`
- Test: `tests/writer-source.test.mjs`
- Modify: `package.json` only if the existing writer-unit command needs the new test file

**Interfaces:**
- `normalizeSourceRange(range, length) -> { start, end }`
- `replaceSourceRange(source, range, insertedText) -> string`
- `deleteSourceBackward(source, caret) -> string`
- `deleteSourceForward(source, caret) -> string`
- `sourceLineBoundary(source) -> { titleEnd, bodyStart }`

- [x] **Step 1: Write failing tests for insertion, backward/forward deletion, grapheme-safe boundaries, and Title/body newline boundaries**
- [x] **Step 2: Run `node --test tests/writer-source.test.mjs` and verify the new tests fail because the module is absent**
- [x] **Step 3: Implement the smallest grapheme-safe Source helpers using the existing `graphemes` utility**
- [x] **Step 4: Re-run the focused tests and `npm run test:writer-unit`**
- [x] **Step 5: Commit and push `feat: add source transaction primitives`**

### Task 3: Introduce one Writer editing host without changing Viewer layout

**Files:**
- Modify: `index.html`
- Modify: `assets/css/reader.css`
- Modify: `assets/js/app.js` (`applyMode`, `render`, Writer event binding)
- Modify: `assets/js/reader-view.js` only to support an explicit source offset for projection markers
- Test: `tests/writer-beta-gate.mjs`, `tests/writer-mobile-beta-gate.mjs`, `tests/dom-reader-json.test.mjs`

**Interfaces:**
- DOM: `#writer-surface` is the only `contenteditable=true` host in Writer mode.
- Existing `#song-title` and `#lyrics` remain child projections with stable selectors.
- `renderLyrics(element, source, { sourceOffset })` offsets projection marker ranges without changing serialized Source.

- [ ] **Step 1: Add a failing Browser assertion that Writer has one editable host and Title/body children are not independent editable hosts**
- [ ] **Step 2: Run the focused Browser gate and confirm the current two-host structure fails**
- [ ] **Step 3: Add `#writer-surface` around the existing Title/body projections and make it the only Writer contenteditable host**
- [ ] **Step 4: Preserve Viewer and Source Mode visibility, labels, scroll containers, and vertical writing behavior**
- [ ] **Step 5: Run Writer Chromium/WebKit mobile smoke and DOM projection regression tests**
- [ ] **Step 6: Commit and push `feat: add unified writer editing surface`**

### Task 4: Route ordinary Writer input through Source/IR transactions

**Files:**
- Modify: `assets/js/app.js` (`beforeinput`, composition, paste, title/body mapping)
- Modify: `assets/js/editor-source.js` only to keep explicit compatibility serialization isolated
- Test: `tests/writer-beta-gate.mjs`, `tests/writer-mobile-beta-gate.mjs`, `tests/writer-source.test.mjs`

**Interfaces:**
- `sourceRangeFromWriterSelection() -> { start, end } | null`
- `commitWriterTextEdit(range, insertedText) -> boolean`
- `commitWriterDeletion(range) -> boolean`
- `commitWriterPaste(range, text) -> boolean`

- [ ] **Step 1: Add failing Browser cases for ordinary text input, delete, paragraph, plain paste, and composition that assert Source changes without invoking rendered DOM serialization**
- [ ] **Step 2: Run the focused gate and observe the instrumentation/failure on the current DOM fallback path**
- [ ] **Step 3: Map Title/body child projection positions into one logical Source range, including the first newline**
- [ ] **Step 4: Commit insert/delete/paragraph/paste/composition through one Source/IR transaction and reproject only after successful parse**
- [ ] **Step 5: Keep DOM reconstruction only for explicit Ruby-internal or unsupported-operation fallback and make that boundary observable in tests**
- [ ] **Step 6: Run all Writer Browser sub-gates plus Reader/Shared regressions**
- [ ] **Step 7: Commit and push `feat: route writer input through source transactions`**

### Task 5: Stabilize selection, caret, and mobile viewport behavior

**Files:**
- Modify: `assets/js/app.js` selection mapping and Writer render path
- Modify: `assets/css/reader.css`
- Test: `tests/writer-beta-gate.mjs`, `tests/writer-mobile-beta-gate.mjs`, `tests/dom-reader-json.test.mjs`

**Interfaces:**
- Selection is represented as Source `{ start, end }`; DOM Range is only a projection lookup.
- Ordinary Writer transactions do not call `restoreScroll()` or saved-scroll persistence.

- [ ] **Step 1: Add boundary fixtures for Title end, body start/end, Ruby before/after/base/reading, and Presentation before/after**
- [ ] **Step 2: Add a failing assertion that ordinary input does not restore saved shell scroll or replace the editing host during composition**
- [ ] **Step 3: Remove per-input scroll restoration and broad caret restoration from the Source-backed path**
- [ ] **Step 4: Restore only the logical Source caret after a successful projection, without changing focus during selection**
- [ ] **Step 5: Run Chromium and WebKit Writer gates, including vertical layout and non-collapsed selection**
- [ ] **Step 6: Commit and push `fix: preserve writer source selection and viewport`**

### Task 6: Correct repeat-mark advance and typography inheritance

**Files:**
- Modify: `assets/js/reader-view.js`
- Modify: `assets/css/reader.css`
- Test: `tests/dom-reader-json.test.mjs`, `tests/reader-kernel-golden.test.mjs`, mobile/presentation Browser Gates

**Interfaces:**
- Repeat-mark visual pair retains `data-source-start/end` length 2 and has two inline advances in vertical writing.
- Base font size is `--reader-size`; Ruby `rt` derives its size from the Base value via relative scale.

- [x] **Step 1: Add failing geometry/style assertions for two-cell repeat marks and Base/Ruby font-size inheritance at 14/20/32px**
- [x] **Step 2: Implement the smallest CSS/renderer adjustment without changing Source or Parser grapheme semantics**
- [x] **Step 3: Run DOM, Reader, Presentation, and Mobile gates**
- [x] **Step 4: Commit and push `fix: preserve repeat mark advance and typography scale`**

### Task 7: Make unavailable Font presets explicit

**Files:**
- Modify: `index.html`, `assets/js/app.js`, `assets/css/reader.css`
- Modify: `tests/writer-presentation-beta-gate.mjs`, `tests/dom-reader-json.test.mjs`
- Modify: `docs/RELEASE-SMOKE.md`

**Interfaces:**
- A preset is selectable only when its resource can be resolved, or its option/status explicitly says it is local-only/unavailable.
- Registry remote Font resolution and fallback remain unchanged.

- [x] **Step 1: Add a failing Browser assertion that local-only Nishiki does not report successful remote application**
- [x] **Step 2: Mark the preset as local-only/unavailable until an official HTTPS Web Font URL/CORS/license contract is verified**
- [x] **Step 3: Keep document Registry Fonts and fallback warnings functional**
- [x] **Step 4: Run presentation and mobile gates**
- [x] **Step 5: Commit and push `fix: make unavailable font presets explicit`**

### Task 8: Final structural Gate and release checkpoint

**Files:**
- Modify: `tests/writer-beta-gate.mjs`, `tests/writer-mobile-beta-gate.mjs`, `tests/writer-presentation-beta-gate.mjs`
- Modify: `docs/QUALITY-GATES.md`, `docs/READER-KERNEL-ROADMAP.md`, `CHANGELOG.md`

- [x] **Step 1: Run all focused Writer gates and verify each new acceptance case**
- [x] **Step 2: Run `npm test`, all Playwright Reader/Writer gates, and every `assets/js` syntax check**
- [x] **Step 3: Inspect `git diff --check`, current branch, stable branch, and unchanged `reader-v0.1.0` tag**
- [x] **Step 4: Record real-device and GitHub-only blockers without converting automated PASS into external PASS**
- [x] **Step 5: Commit and push the final tested slice**
