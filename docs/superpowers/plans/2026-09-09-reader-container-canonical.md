# Reader Container Canonical Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a canonical `.lyric.txt` Reader Container that stores a compact JSON Header and the active Author Source body without losing existing TXT, URL, or Reader JSON input paths.

**Architecture:** A small `lyric-container.js` module owns detection, parsing, canonical serialization, and conversion to/from the existing Reader Document shape. The app keeps its current Reader Document and Syntax Adapter boundaries; local open and export call the container module only at the input/output boundary. The active Variant Source is represented by a `{"kind":"body"}` reference in the Header, while other Variant sources remain inline or URL-backed.

**Tech Stack:** Browser JavaScript modules, JSDoc-compatible plain JavaScript, Node built-in test runner, existing Reader Document v3 model, no build dependency.

**Spec:** User-provided `Lyric Reader 次期実装指示` sections 5–6 and Phase 1.

## Global Constraints

- Reader completion is prioritized over Writer completeness; P0/P1 Reader regressions block progress, while Editor polish remains deferred.
- Input remains Read-many; canonical save emits only `LYRIC-READER/1` Container format.
- Author Source is the meaning-bearing body and must be preserved exactly through parse/serialize.
- Unknown Header fields are retained; unknown Container versions produce warnings and use best-effort parsing when the understood document shape is valid.
- Malformed input must fail safely without executing HTML, JavaScript, CSS, or unsafe protocols.
- Every implementation slice uses RED → GREEN → full regression → `git diff --check` → commit → push.

---

### Task 1: Define and test the canonical Container module

**Files:**
- Create: `assets/js/lyric-container.js`
- Create: `tests/lyric-container.test.mjs`

**Interfaces:**
- `isLyricContainerText(text)` returns `boolean` by checking the first non-BOM line for `LYRIC-READER/<integer>`.
- `parseLyricContainer(text)` returns `{ kind: "lyric-container", version, header, source, warnings }` or throws a user-readable format error when the magic/header/body boundary is malformed.
- `serializeLyricContainer(document, activeVariantId)` returns a canonical UTF-8 JavaScript string using `LYRIC-READER/1`, one compact JSON Header line, one blank-line delimiter, and the exact active Author Source body.
- `containerToReaderDocument(container)` reconstructs a Reader Document v3 object and replaces the active Variant `source` with the parsed body.
- `readerDocumentToContainer(document, activeVariantId)` returns the Header payload and active Source used by the serializer.

- [ ] **Step 1: Write the failing tests**

```js
test("canonical Container preserves the exact active Author Source", () => {
  const source = "題\n[如何《どう》:c=2]\n--- LYRIC-READER/1 ---";
  const document = readerDocumentFixture(source);
  const encoded = serializeLyricContainer(document, "original");
  const parsed = parseLyricContainer(encoded);
  assert.equal(parsed.source, source);
  assert.equal(containerToReaderDocument(parsed).content.variants[0].source.text, source);
});

test("Container keeps non-active Variant sources and unknown Header fields", () => {
  const document = readerDocumentFixture("原文");
  document.content.variants.push({ id: "modern", label: "現代", role: "", source: { text: "現代", url: "inline:" } });
  document.extraField = { retained: true };
  const parsed = parseLyricContainer(serializeLyricContainer(document, "original"));
  const restored = containerToReaderDocument(parsed);
  assert.equal(restored.content.variants[1].source.text, "現代");
  assert.deepEqual(restored.extraField, { retained: true });
});

test("unknown Container version warns but best-effort reads a valid Header", () => {
  const parsed = parseLyricContainer(`LYRIC-READER/99\n{"document":{"version":3,"content":{"variants":[]}}}\n\n本文`);
  assert.equal(parsed.warnings.includes("unknown-version"), true);
});

test("malformed Container Header fails closed without executing its contents", () => {
  assert.throws(() => parseLyricContainer("LYRIC-READER/1\n{bad}\n\n本文"), /Header|形式|不正/);
});
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node --test tests/lyric-container.test.mjs`

Expected: FAIL because `assets/js/lyric-container.js` and its exported functions do not exist yet.

- [ ] **Step 3: Implement the minimal Container contract**

Implement the fixed wire format:

```text
LYRIC-READER/1
{"container":"lyric-reader","version":1,"document":{...,"content":{"variants":[{"id":"original","source":{"kind":"body"}}, ...]}}}

<exact active Author Source bytes>
```

Parse only the first two logical lines and the required blank-line delimiter. Keep Header object properties by cloning them; do not execute or interpret unknown fields. For `version !== 1`, add `"unknown-version"` to `warnings` but continue when the Header contains a readable `document`. Reject malformed JSON, missing `document`, missing active body reference, or non-string Source body.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `node --test tests/lyric-container.test.mjs`

Expected: all Container tests PASS.

- [ ] **Step 5: Run syntax and existing regression tests**

Run: `Get-ChildItem assets/js -Filter *.js | ForEach-Object { node --check $_.FullName }` and `node --test tests/*.test.mjs`.

Expected: syntax check exits 0 and the existing suite remains green.

- [ ] **Step 6: Commit**

```text
git add assets/js/lyric-container.js tests/lyric-container.test.mjs
git commit -m "feat: add canonical lyric container format"
git push origin main
```

### Task 2: Integrate Container input with local open and fail-soft warnings

**Files:**
- Modify: `assets/js/data-loader.js`
- Modify: `assets/js/app.js`
- Modify: `tests/data-loader.test.mjs`
- Modify: `tests/dom-reader-json.test.mjs`

**Interfaces:**
- `isLyricContainerText` is used before JSON/TXT sniffing so `.lyric.txt` is never misclassified as plain text.
- Local Container input is converted through `containerToReaderDocument` and the existing `setReaderDocument` transaction, preserving rollback behavior.
- Unknown-version warnings are rendered as a short status message while the body remains readable.

- [ ] **Step 1: Write the failing input integration test**

Add a test fixture containing a Container with an active Source, Registry, and a second Variant. Assert that loading conversion yields the active Source and Variant metadata without changing the existing TXT/JSON classification tests.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node --test tests/data-loader.test.mjs tests/dom-reader-json.test.mjs`

Expected: the new Container load assertion fails because the app currently treats the file as ordinary TXT.

- [ ] **Step 3: Implement detection and transactional conversion**

Use `parseLyricContainer` for `.lyric.txt` or magic-detected content, convert with `containerToReaderDocument`, and call the existing `setReaderDocument` path. Do not mutate current state until the candidate has passed the existing validation pipeline. Preserve the current failure message and previous document on invalid Container input.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/data-loader.test.mjs tests/dom-reader-json.test.mjs` and `node --test tests/*.test.mjs`.

Expected: both pass; invalid Container input leaves the current document unchanged.

- [ ] **Step 5: Commit**

```text
git add assets/js/data-loader.js assets/js/app.js tests/data-loader.test.mjs tests/dom-reader-json.test.mjs
git commit -m "feat: load lyric containers through reader documents"
git push origin main
```

### Task 3: Add canonical Container export without changing existing exports

**Files:**
- Modify: `index.html`
- Modify: `assets/js/app.js`
- Modify: `tests/build-id.test.mjs`
- Modify: `CHANGELOG.md`
- Modify: `docs/READER-KERNEL-ROADMAP.md`

**Interfaces:**
- Existing Author Source TXT, Reader JSON, and Portable Copy actions remain available.
- New `download-container-button` starts a `.lyric.txt` download using `serializeLyricContainer(buildReaderDocument(), state.activeVariantId)`.
- The status text says the download was started, not that disk persistence was confirmed.

- [ ] **Step 1: Write the failing DOM contract test**

Assert that `index.html` contains `download-container-button`, accepts `.lyric.txt` through the existing file input, and keeps the existing TXT/JSON/Copy controls.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node --test tests/build-id.test.mjs`

Expected: FAIL because the new Container export control is absent.

- [ ] **Step 3: Add the export control and handler**

Add one action in the document operations group. Wire it to a Blob with `text/plain;charset=utf-8`, the current title-based filename with `.lyric.txt`, and the existing `download()` helper. Validate the serialized Header with `parseLyricContainer` before starting the download.

- [ ] **Step 4: Run full verification**

Run: `node --test tests/*.test.mjs`, all `node --check` commands, and `git diff --check`.

- [ ] **Step 5: Commit**

```text
git add index.html assets/js/app.js tests/build-id.test.mjs CHANGELOG.md docs/READER-KERNEL-ROADMAP.md
git commit -m "feat: export canonical lyric containers"
git push origin main
```

### Task 4: Container documentation and release evidence

**Files:**
- Modify: `README.md`
- Modify: `docs/QUALITY-GATES.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- README documents `.lyric.txt` as the canonical combined format and identifies TXT/JSON/Portable as separate exports.
- Quality Gate records automated Container round-trip evidence and keeps unverified live/mobile checks separate.

- [ ] **Step 1: Add documentation tests where existing docs checks support them**

Extend the build/documentation assertions only for exact strings that are already validated by the repository test style; do not make prose tests replace runtime tests.

- [ ] **Step 2: Run the complete verification set**

Run: `node --test tests/*.test.mjs`, all JavaScript syntax checks, `git diff --check`, and confirm `git rev-parse HEAD` equals `git rev-parse origin/main` after push.

- [ ] **Step 3: Commit**

```text
git add README.md docs/QUALITY-GATES.md CHANGELOG.md
git commit -m "docs: document canonical lyric container"
git push origin main
```

## Self-review

- Phase 1 is covered: delimiter, parser, inline/URL-compatible Reader Document fields, `.lyric.txt`, canonical save, and existing individual exports.
- Phase 2 remains a later plan: fail-soft missing Registry references, warning markers, unknown-field/version UI details, and deeper Security review.
- Phase 3–7 remain intentionally outside this Container slice so Writer work does not delay Reader completion.
- Attribute ordering remains semantic-canonical per the existing `HOLD-B7`; the Container preserves the body bytes exactly even when Header JSON is compacted.
