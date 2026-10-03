# Current State

Base version: `0.3.8`

Last verified: 2026-10-02 — accepted main `2054e1ca1bd44ae1f89d916c747cba57607f3c57` (merged PR #19) received fleet DEEP re-audit; exact-main Verify / Reader focus / Deploy / Browser Audit / Pages checks remain terminal GREEN. This does not satisfy the separate real-iPhone Safari gate.

## Current acceptance baseline

- Accepted main: `2054e1ca1bd44ae1f89d916c747cba57607f3c57` (merged PR #19 documentation reconciliation).
- Product repair owner: Issue #12 / merged PR #13; accepted product-repair main before the corrective CI fix: `2839119b899b8d369b320feabd56251fe7c0062e`.
- Corrective Writer Presentation fixture repair: Issue #17 / merged PR #18; #17 is completed after post-merge evidence became terminal GREEN.
- Main Verify #60 (`36575678209`): SUCCESS.
- Deploy to GitHub Pages #179 (`36575678236`): SUCCESS.
- Browser Audit #16 (`36575678473`): SUCCESS.
- Dynamic Pages build #178 (`36575677440`): SUCCESS.
- Published technical regression gates are GREEN at the accepted main; fleet DEEP audit re-observed exact-main checks `36658100612`, `36658100589`, `36658100546`, `36658100698`, and `36658099643` as SUCCESS.
- Remaining acceptance boundary is **real iPhone Safari** evidence owned by Issue #12 / progress ledger #15. Playwright/WebKit or Chromium machine evidence is not a substitute for that physical-device gate.

## Accepted implemented behavior

### Source / document integrity

- Author Source remains the editing authority; Reader/Writer projections do not become a second source of truth.
- Source Mode has a user-selectable right-edge wrap behavior.
- Canonical `.lyric.txt` JSON Header serializes in readable multi-line form while legacy compact Header input remains readable.
- Empty Author Source first line remains an empty Title projection; no synthetic `無題` title is inserted.
- Generic Manifest Variant loading still requires exactly one existing supported Source form; source-less/empty remote references and conflicting supported forms fail closed before a Variant Source fetch.

### Writer editing / history

- Late asynchronous Font renders no longer discard uncommitted Source Editor input or parse-error state.
- Writer late renders patch the projection while preserving the collapsed caret on the corresponding Source offset.
- Mode switches commit pending debounced History snapshots so consecutive Source/Writer edits remain separate Undo steps.
- Ruby Base / Reading editing restores the correct raw Source caret location and preserves input order.
- Dynamic `｜3ペウコ《ピョコ》` input/editing is covered by regression tests.
- Ruby/Paste/IME behavior remains Source-backed; no DOM-as-second-authority path was introduced.

### Typography / Reader UI

- Reader body font-size settings through 32px are exercised by the accepted regression path.
- Reader work typography line-height is separated from Header/Footer/settings UI chrome line-height.
- iOS text autosizing behavior is stabilized for the accepted machine-tested path.
- Nishiki-teki availability remains based on verified resource behavior rather than treating fallback as successful Font application.

### Browser / presentation gates

- `npm run audit:browser` covers IME, Selection, native Clipboard, typography, vertical repeat marks, Nishiki availability, accessibility tree, and desktop/360px geometry with JSON evidence.
- `.github/workflows/browser-audit.yml` includes Writer Beta, Writer Presentation and Writer Mobile gates.
- The PR #18 corrective path replaced only large Source fixture injection in Writer Presentation with one assignment + bubbling `input`; product assertions and timeout values were not weakened.
- Reader focus visibility remains protected while preserving normal reader chrome auto-hide behavior.

## Current active boundary

Owner Issue #12 remains open because the real-device acceptance specified by the repository has not yet been recorded. Progress/recovery authority is Issue #15.

First unfinished acceptance unit after the accepted main machine gates:

1. CP06 — real iPhone Safari Source / typography / title smoke;
2. CP07 / CP08 — remaining Ruby/caret/Selection/clipboard real-device checks as defined by #15 / `docs/RELEASE-SMOKE.md`;
3. reconcile Release Smoke / roadmap / owner Issue #12 after the real-device evidence is complete.

A real-device failure must be split into the smallest reproducible repository-local defect rather than hidden by emulation evidence or a broad rewrite.

## Default state

- `web-app`: `OVERRIDE` — existing browser application is authoritative.
- `ci-test`: `OVERRIDE` — existing repository workflow and quality gates are authoritative.

## Known constraints

- GitHub Pages deployment and release policy remain Project-owned.
- Reader, Writer, mobile, presentation and browser gates remain Project-owned.
- The Base verify command provides the repository entry point but does not replace Domain-specific gates.
- Real iPhone Safari soft keyboard, touch selection handles, native clipboard behavior and Safari-specific runtime behavior remain real-device boundaries until evidence is recorded.
- A successful machine/WebKit gate must not be represented as physical-device acceptance.

## Current next work

1. Resume from Issue #15 CP06; do not replay accepted PR #13/#18 implementation or machine verification.
2. Run the documented real iPhone Safari horizontal/vertical smoke and record evidence in `docs/RELEASE-SMOKE.md`.
3. Keep Issue #12 open until its real-device acceptance and final reconciliation are actually complete.
4. Treat any new reproducible Reader/Writer defect as a bounded repository-local Issue.

## Accepted evidence / references

- Issue #12 — current iOS regression acceptance owner.
- Issue #15 — interruption/recovery progress ledger; CP05 is complete and CP06 is first unfinished.
- merged PR #13 — product repair.
- completed Issue #17 / merged PR #18 — Writer Presentation CI fixture repair.
- merged PR #19 — accepted-main / real-device-boundary Current State reconciliation; merge `2054e1ca1bd44ae1f89d916c747cba57607f3c57`.
- `docs/LYRIC_READER_REQUIREMENTS.md` — accepted requirements.
- `docs/QUALITY-GATES.md` — automated gate contract.
- `docs/RELEASE-SMOKE.md` — real-device/external acceptance evidence.
- Roadmap Issue #4 — development order and phase boundary.
