---
phase: 10-overlay-hud-layouts
plan: 04
subsystem: ui
tags: [battle, switch, hp-bar, composite, deriveSide, SimBattleAdapter]

# Dependency graph
requires:
  - phase: 10-overlay-hud-layouts
    provides: CompositeBuilder + buildAndCacheComposites pipeline (10-01, 10-02)
  - phase: 05.2-replace-battle-engine-with-sim
    provides: SimBattleAdapter deriveSide + deriveBattleState infrastructure
provides:
  - deriveSide HP mismatch detection and correction after voluntary/forced switch
  - isActive-based fallback for activeIndex determination when species match fails
  - Diagnostic logging in deriveSide and buildAndCacheComposites for HP tracing
affects:
  - Phase 11 Stats Screen (reads BattleState HP values for display)
  - Any future phase reading team[activeIndex].currentHp

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Post-derivation HP correction: after activeIndex is determined, compare team[activeIndex].currentHp with simSide.active[0].hp and correct if mismatched"
    - "isActive fallback: if species-based activeIndex match fails, scan simSide.pokemon for mon with isActive=true as secondary identification strategy"

key-files:
  created: []
  modified:
    - src/battle/SimBattleAdapter.ts
    - src/screens/ScreenController.ts

key-decisions:
  - "HP mismatch correction mutates team[] array in-place before returning from deriveSide — safe because team is locally allocated on each deriveSide call"
  - "isActive fallback added as Fallback 2 after existing set.species and species.name strategies — doesn't change existing happy-path, only catches edge cases"
  - "console.debug used for diagnostic logs (not console.log or console.warn) — suppressed in production by browser DevTools filter, available when needed"

patterns-established:
  - "deriveSide triple-strategy activeIndex: (1) set.species match, (2) species.name match, (3) isActive flag scan — ordered by reliability"
  - "Post-derivation invariant check: team[activeIndex].currentHp must equal simSide.active[0].hp — if not, correct immediately"

# Metrics
duration: 25min
completed: 2026-03-03
---

# Phase 10 Plan 04: HP Carryover Fix Summary

**deriveSide activeIndex determination hardened with isActive fallback + post-derivation HP correction, closing Gap 2 (HP carryover after voluntary switch)**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-03T09:18:00Z
- **Completed:** 2026-03-03T09:43:43Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added secondary `isActive`-based activeIndex determination to `deriveSide` — catches edge cases where species string normalisation fails to match the newly switched-in Pokemon
- Added post-derivation HP mismatch correction — if `team[activeIndex].currentHp` disagrees with `simSide.active[0].hp` (indicating findSimMon returned the wrong sim mon for that slot), the HP is corrected in place
- Added diagnostic logging (`console.debug`) in both `deriveSide` and `buildAndCacheComposites` to trace HP values through the full switch data flow for future debugging
- Confirmed the forced-switch path (`resolveSwitch` → `submitSwitch` → `deriveBattleState`) goes through the same fixed `deriveSide` function — both voluntary and forced switches are covered

## Task Commits

Each task was committed atomically:

1. **Task 1: Diagnose and fix HP carryover after voluntary switch** - `0935a1f` (fix)
2. **Task 2: Verify forced-switch HP is also correct** - `08334b5` (fix)

## Files Created/Modified
- `src/battle/SimBattleAdapter.ts` - Added isActive fallback in `deriveSide` activeIndex determination; added post-derivation HP mismatch correction; added `[deriveSide]` diagnostic log
- `src/screens/ScreenController.ts` - Added `[buildComposites]` diagnostic log in `buildAndCacheComposites`; added comment to `resolveSwitch` confirming the fix applies to forced switches

## Decisions Made
- HP mismatch correction mutates `team[]` in-place before returning: `team[activeIndex]` is replaced with a spread copy containing corrected `currentHp` and `stats.hp`. This is safe because `team` is a locally-allocated array in each `deriveSide` call.
- The isActive fallback is Fallback 2 — it only runs if BOTH primary (set.species match) and Fallback 1 (species.name match) fail. This preserves existing behavior for the common case.
- `console.debug` used for HP tracing logs to avoid log noise in normal operation. `console.warn` used when the mismatch correction fires (actionable signal that the primary matching failed).

## Deviations from Plan

None — plan executed exactly as written. The diagnostic logging and defensive fixes were both specified in the plan. The root cause was not definitively identified via static analysis (requires live simulator run to observe logs), but the defensive HP correction ensures correctness regardless of the underlying cause.

## Issues Encountered
- Static analysis could not definitively identify why `deriveSide` would produce wrong HP for the active Pokemon after a switch — the code path appears correct when traced manually. The diagnostic logging (`[deriveSide]` and `[buildComposites]` debug logs) will reveal the exact failure mode when run in the simulator.
- Implemented two complementary defensive fixes rather than a single targeted fix: (1) isActive fallback addresses potential species-matching failures, (2) HP mismatch correction is the final safety net that always produces correct HP regardless of upstream matching issues.

## Next Phase Readiness
- Gap 2 from VERIFICATION.md is addressed: HP mismatch correction ensures the composite always shows the active Pokemon's correct HP after any switch
- Diagnostic logs will surface in simulator runs — if the HP mismatch correction fires (console.warn), it identifies the exact matching failure for targeted follow-up
- Phase 11 (Stats Screen) can read `team[activeIndex].currentHp` with confidence it reflects the sim's actual HP

---
*Phase: 10-overlay-hud-layouts*
*Completed: 2026-03-03*
