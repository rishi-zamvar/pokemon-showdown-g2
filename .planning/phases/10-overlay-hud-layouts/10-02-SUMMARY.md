---
phase: 10-overlay-hud-layouts
plan: "02"
subsystem: ui
tags: [composites, overlay-hud, sprites, battle-screen, caching, concurrent-rendering]

# Dependency graph
requires:
  - phase: 10-01
    provides: CompositeBuilder (buildOppComposite, buildPlayerComposite, buildTeamBar, emptyComposite, emptyTeamBarBmp), OVERLAY_LAYOUT constants, showOverlayHud adapter method
provides:
  - Overlay HUD rendering wired into BATTLE_HUD, ATTACK_SELECT, SWITCH_SELECT screens
  - Composite caching (oppCompositeBmp, playerCompositeBmp, teamBarBmp) with null fallbacks
  - Composite pre-computation concurrent with animation playback in resolveTurn/resolveSwitch/transitionAfterTurn
  - Initial composite build at battle start so first decision screen renders instantly
  - Opponent reveal tracking via revealedOpponentIndices Set
  - Cache reset on battle end and forfeit
affects:
  - Phase 11 (Stats Screen) — overlay HUD layout established here may frame stats screen design

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Concurrent composite pre-computation: start buildAndCacheComposites() before animation, await after animation completes"
    - "Null fallback pattern: cache field ?? emptyFallback() for safe rendering before first build"
    - "Reveal tracking: Set<number> of opponent activeIndex values seen; pokeball shown for unrevealed"

key-files:
  created: []
  modified:
    - src/screens/ScreenController.ts

key-decisions:
  - "Composites built concurrently with animation via fire-and-await pattern — build starts before animation, await after animation completes"
  - "Null fallback (emptyTeamBarBmp / emptyComposite) used when caches are null — prevents crashes during first render before build completes"
  - "resetCompositeCache() extracted as private helper — called on forfeit (onDoubleTap BATTLE_HUD) and both handleEndScreen branches"
  - "revealedOpponentIndices cleared on battle start (startNewBattleInner) and reset on end/forfeit — no cross-battle contamination"

patterns-established:
  - "Overlay HUD rendering: all 3 decision screens call glass.showOverlayHud() with cached BMPs; animation screens still use showBattleHud()"
  - "Composite wiring at 4 points: startNewBattleInner (initial), resolveTurn, resolveSwitch, transitionAfterTurn p2NeedsSwitch branch"

# Metrics
duration: 4min
completed: 2026-03-02
---

# Phase 10 Plan 02: Overlay HUD Wiring Summary

**Composite BMP overlay HUD wired into all 3 decision screens (BATTLE_HUD/ATTACK_SELECT/SWITCH_SELECT) with concurrent pre-computation during animation and opponent reveal tracking**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-02T12:57:44Z
- **Completed:** 2026-03-02T13:01:30Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- All three decision screens now call `showOverlayHud()` with cached composite BMPs instead of `showList()` — players see both Pokemon sprites, HP bars, status, stat mods, and team preview bar on every decision screen
- Composite pre-computation fires concurrently with animation playback in `resolveTurn`, `resolveSwitch`, and `transitionAfterTurn` p2NeedsSwitch branch — decision screens render instantly after animation ends
- Initial composites built at battle start after sprite loading so first BATTLE_HUD render has composites ready without waiting
- Opponent reveal tracking via `Set<number>` — unrevealed opponent Pokemon show as pokeballs in the team bar
- Cache reset on all battle-end paths (New Battle, Main Menu, Forfeit) — no cross-battle contamination

## Task Commits

1. **Task 1: Add composite caching fields and buildAndCacheComposites method** - `821d215` (feat)
2. **Task 2: Wire overlay rendering into render() dispatch** - `821d215` (feat)

Both tasks committed together as a single atomic unit.

**Plan metadata:** (created after this summary)

## Files Created/Modified
- `src/screens/ScreenController.ts` — Added 5 cache fields, 3 private methods (buildAndCacheComposites, updateRevealedOpponents, resetCompositeCache), import for CompositeBuilder, 4 composite wiring points, and showOverlayHud calls in all 3 decision-screen render() cases

## Decisions Made
- Composites built concurrently with animation using fire-then-await pattern: `const compositesPromise = buildAndCacheComposites(nextState)` fires before `showBattleHud` + `playTurn`, then `await compositesPromise` before `transitionAfterTurn` — maximizes parallelism while guaranteeing readiness
- Null fallback (`emptyTeamBarBmp()` / `emptyComposite()`) applied at call site via `??` operator — caches are always `Uint8Array | null`; this is safe because emptyComposite produces a valid all-black BMP of correct dimensions
- `resetCompositeCache()` extracted as private helper rather than inlining null assignments — called in 3 distinct paths, reduces duplication
- `revealedOpponentIndices.clear()` called at battle start (before `updateRevealedOpponents`) to ensure fresh tracking per battle

## Deviations from Plan

None — plan executed exactly as written. The `resetCompositeCache()` helper extraction was a minor code quality improvement over the plan's inline null assignments, but functionally identical.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 10 is now complete: CompositeBuilder (10-01) + ScreenController wiring (10-02) deliver the full overlay HUD layout
- Phase 11 (Stats Screen) can begin — the overlay HUD layout pattern is established and will continue to be used
- No blockers

---
*Phase: 10-overlay-hud-layouts*
*Completed: 2026-03-02*
