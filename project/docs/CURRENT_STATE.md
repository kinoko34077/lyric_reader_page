# Current State

Base version: `0.3.8`

Last verified: 2026-09-27 — Real-browser audit replaces human browser verification

## Current acceptance baseline

- Accepted main: `c1508cc2d3a8d36e19a0cdf51fd604cb4f5fdbfb` (#5 application repair and #6 gate-race repair merged)
- main Deploy run `36296810578`: SUCCESS
- Automated Reader / Shared / Writer / Mobile / Presentation gates: GREEN at the accepted main
- Real iPhone Safari IME / Selection / Native Clipboard / real-Font checks: REAL-DEVICE ONLY / UNVERIFIED

## Implemented


- Repository-local KiNoTch Base v0.3.8 and Project Overlay
- `web-app` Surface declaration
- Structured `npm ci` setup and `npm test` verification commands
- Existing Reader, Writer, shared document, mobile, and browser test paths retained
- Existing Domain files remain at their original root paths; no bulk move was performed
- Reader auto-hide keeps its normal `chrome-hidden` reading state, while Header/Footer containing keyboard focus are returned to the viewport with `:focus-within`
- Dedicated Chromium regression covers hidden chrome -> keyboard focus -> focused control remains visible without disabling the auto-hide state
- Late renders after asynchronous Font loading no longer discard uncommitted Source Editor input or its parse-error state
- Late renders in Writer patch the projection in place and keep the collapsed caret on its Source offset instead of dropping it to the body start
- Switching mode commits a pending debounced History snapshot, so a Source edit and a following Writer edit remain separate Undo steps
- `writerLateRender` Writer Browser sub-gate holds document Font requests to reproduce the three cases deterministically

- `npm run audit:browser` audits IME (CDP), Selection, native Clipboard, typography, vertical repeat marks, Nishiki availability, accessibility tree, and 360px / desktop geometry with JSON evidence; `.github/workflows/browser-audit.yml` runs it with the Writer Beta / Writer Mobile gates on every Pull Request
- Audit-found product defects repaired: Viewer late render dropped the user's Selection; Viewer selection Copy produced flattened DOM text instead of Portable Text; Chromium IME restarted after Ruby lost or misplaced the committed text; Nishiki-teki was selectable without a real Font because `FontFaceSet.check()` returns true for unknown families

## Default state

- `web-app`: `OVERRIDE` — existing browser application is authoritative
- `ci-test`: `OVERRIDE` — existing repository workflow and quality gates are authoritative

## Known constraints

- GitHub Pages deployment and release policy remain Project-owned.
- Reader, Writer, mobile, and browser presentation gates remain Project-owned.
- The Base verify command provides the repository entry point but does not replace Domain-specific gates.
- Pointer/touch auto-reveal behavior and the 900 ms reader chrome auto-hide timing remain unchanged by the keyboard-focus repair.

## Historical Phase 0 audit (Roadmap #4, base `f1cf3f5`)

- Reader Unit / Shared / Writer Unit / Reader Mobile / Writer Presentation: PASS
- Writer Beta Gate (`writer`, `writerSource`, `writerWysiwyg`, `writerRuby`) and Writer Mobile Chromium Pixel 5: FAIL — reproducible, timing-dependent; root causes above, repaired
- WebKit iPhone emulation: AUTOMATED ONLY (CI); real iPhone Safari items remain REAL-DEVICE ONLY per `docs/RELEASE-SMOKE.md`

## Next work

1. Run the documented real iPhone Safari horizontal/vertical Writer smoke and record evidence in `docs/RELEASE-SMOKE.md`.
2. Preserve existing Reader/Writer/browser behavior as Project overrides.
3. Treat new reproducible Reader/Writer usability defects as repository-local maintenance Issues rather than broad UI rewrites.
4. Consider further Default adoption only where it removes a real duplicate without changing the reader/writer Domain.

## Historical Verification Evidence

- `knt doctor`
- `knt base-check`
- `knt setup`
- `knt verify`
- `npm test`
- Reader focus visibility Chromium gate: RED `36253510185`; first CSS-fix GREEN `36253728115`
- Current accepted main Deploy run: `36296810578` (SUCCESS)
