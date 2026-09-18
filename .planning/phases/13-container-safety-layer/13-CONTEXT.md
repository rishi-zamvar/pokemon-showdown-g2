# Phase 13: Container Safety Layer - Context

**Gathered:** 2026-09-18
**Status:** Ready for planning
**Mode:** --auto (defaults from Phase 12 findings; no user questions)

<domain>
## Phase Boundary

One place in the adapter enforces every geometry and ordering invariant the
firmware cares about, so no later phase can silently break a whole page rebuild
again. Covers REND-03..REND-06.

This phase changes **how calls are validated**, not what any screen looks like.
No layout redesign, no new screens, no sprite work.

</domain>

<decisions>
## Implementation Decisions

### Where the guard lives
- **D-01:** One choke point in `src/adapters/glassAdapter.ts`. Every SDK call in
  the app already routes through this file — that is why the phase is small.
  Nothing outside the adapter learns about container limits.
- **D-02:** The guard runs *before* the SDK call and refuses, loudly. It does not
  clamp, truncate or silently repair. A container that violates the firmware's
  limits is a layout bug in the caller, and clamping would let the page render
  wrong instead of failing.

### What it enforces
- **D-03:** Image containers: width 20-288, height 20-144. Max 4 image
  containers, max 8 non-image, 12 total. Exactly one container per page with
  `isEventCapture: 1`.
- **D-04:** Image data dimensions must equal container dimensions. The hardware
  *tiles* undersized data rather than erroring, which is the worst kind of
  failure — it renders something plausible and wrong.
- **D-05:** Also call the SDK's own `validateEvenHubPageContainer()` and surface
  `formatEvenHubPageContainerValidationError()`. It covers z-order consistency
  and uniqueness, menu rules and text brightness — but **not** dimensions or
  container counts. I verified this empirically: it returned `{valid:true}` for
  a 9999x9999 image and for `containerTotalNum: 13`. The two guards are
  complementary; neither is sufficient alone.

### Ordering and lifecycle
- **D-06:** Image sends stay strictly sequential, and this is now the phase's
  single highest-value fix. `showOverlayHud` already awaits `sendBmpData` one at
  a time (glassAdapter.ts:453-455), but **`AnimationEngine.ts:282` does not**:
  `await Promise.all(tasks)` runs `typewriterText`, `spriteFlash` and `hpDrain`
  concurrently, and the latter two both call `updateImageRawData`. Concurrent
  sends are not allowed on this platform, and the result is research-14 — the
  game hangs forever, roughly one turn in twenty.
  Enforce the invariant **centrally in the adapter** (a serialising queue), not
  by rewriting `Promise.all` at one call site. A guard at the choke point fixes
  every current and future caller; editing the animation engine fixes one and
  leaves the next one free to reintroduce it.
  This is the fix that makes Phase 12's `battleScenario` able to pass, so it
  should land before anything else in this phase.
- **D-07:** No image data during `createStartUpPageContainer`. Create empty
  placeholders, then `updateImageRawData`. This is the direct fix for
  research-10 (`update_image_raw_data: container 8 not found` on every boot).
- **D-08:** An update targeting a container that does not exist on the current
  page is a bug, not a no-op. Research-11 (`TextContainerUpgrade failed:
  container 2 not found`) is the "blank out container 2" workaround in
  `showOverlayHud` firing against a container that was never created. Fix the
  cause — track which containers the current page actually declares — rather
  than widening the try/catch that currently hides it.

### Proving it
- **D-09:** Phase 12's harness is the proof. Each invariant gets a scenario that
  triggers the violation and asserts the guard refuses, plus
  `expectConsoleClean()` over `runBattleScript()` for the no-regression case.
- **D-10:** When research-10 and research-11 stop occurring, their entries in
  the `KNOWN_DEFECTS` allow-list in `harness/assert.ts` must be **deleted** in
  the same commit. Leaving a waiver for a fixed defect is how the list rots.
  The run prints active waivers at the end of every run specifically so this is
  visible.

</decisions>

<constraints>
## Known Constraints

- The SDK validator does NOT check dimensions or container counts (verified).
- One oversized container fails the ENTIRE `rebuildPageContainer` call — this is
  what made the app unplayable, not a partial render.
- `zOrderIndex` is all-or-none per page and values must be unique; the SDK
  rejects partial sets with `MISSING_Z_ORDER_INDEX`. The app currently sets it
  nowhere, which is valid. Do not introduce it partially.
- Firmware tiles undersized image data instead of erroring.
- `containerName` max 16 chars.
- Measured costs constrain any "just re-render to be safe" instinct:
  `rebuildPageContainer` ~165 ms flat, `updateImageRawData` ~104 ms each.

</constraints>

<deferred>
## Deferred

- Adopting `zOrderIndex` across the overlay HUD — real, but it is a layout
  change and belongs with the Phase 19 restructure, not the safety layer.
- Removing the 50 ms sleep and the container-2 blanking workaround in
  `showOverlayHud` beyond what D-08 requires.
- D6 (`mapEventToGesture` maps unknown eventType, including `undefined`, to TAP)
  — input concern, owned by Phase 16.

</deferred>
