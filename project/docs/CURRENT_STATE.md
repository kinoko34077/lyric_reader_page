# Current State

Base version: `0.3.8`

Last verified: 2026-09-27 — Roadmap #4 Phase 0 audit and late-render Source/caret integrity repair

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

## Default state

- `web-app`: `OVERRIDE` — existing browser application is authoritative
- `ci-test`: `OVERRIDE` — existing repository workflow and quality gates are authoritative

## Known constraints

- GitHub Pages deployment and release policy remain Project-owned.
- Reader, Writer, mobile, and browser presentation gates remain Project-owned.
- The Base verify command provides the repository entry point but does not replace Domain-specific gates.
- Pointer/touch auto-reveal behavior and the 900 ms reader chrome auto-hide timing remain unchanged by the keyboard-focus repair.

## Phase 0 audit (Roadmap #4, base `f1cf3f5`)

- Reader Unit / Shared / Writer Unit / Reader Mobile / Writer Presentation: PASS
- Writer Beta Gate (`writer`, `writerSource`, `writerWysiwyg`, `writerRuby`) and Writer Mobile Chromium Pixel 5: FAIL — reproducible, timing-dependent; root causes above, repaired
- WebKit iPhone emulation: AUTOMATED ONLY (CI); real iPhone Safari items remain REAL-DEVICE ONLY per `docs/RELEASE-SMOKE.md`

## Next work

1. Preserve existing Reader/Writer/browser behavior as Project overrides.
2. Treat new reproducible Reader/Writer usability defects as repository-local maintenance Issues rather than broad UI rewrites.
3. Consider further Default adoption only where it removes a real duplicate without changing the reader/writer Domain.

## Verification

- `knt doctor`
- `knt base-check`
- `knt setup`
- `knt verify`
- `npm test`
- Reader focus visibility Chromium gate: RED `36253510185`; first CSS-fix GREEN `36253728115`
