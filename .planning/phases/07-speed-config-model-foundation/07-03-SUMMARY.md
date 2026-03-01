---
phase: 07-speed-config-model-foundation
plan: "03"
subsystem: battle
tags: [cleanup, pkmn-sim, dead-code, typescript]

# Dependency graph
requires:
  - phase: 05-screen-layer
    provides: "SimBattleAdapter + SimAIOpponent replaced the old custom engine (preserved but unimported)"
provides:
  - "6 dead v0.1 engine files permanently removed: BattleEngine, DamageCalc, StatusEngine, TurnResolver, AIOpponent, engineSmoke"
  - "Clean src/battle/ directory — only @pkmn/sim-based files remain"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dead code removal after confirmed migration — delete once successor is stable, not at migration time"

key-files:
  created: []
  modified:
    - "src/battle/ (deleted: BattleEngine.ts, DamageCalc.ts, StatusEngine.ts, TurnResolver.ts, AIOpponent.ts, engineSmoke.ts)"

key-decisions:
  - "All 6 deleted files were confirmed import-free before deletion — no dangling references remained"
  - "SimAIOpponent.ts (active) kept; AIOpponent.ts (deleted) — import-grep regex used word-boundary \\b to avoid false match"

patterns-established:
  - "Grep with \\b word boundary: grep 'from.*AIOpponent\\b' distinguishes SimAIOpponent from AIOpponent"

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 7 Plan 03: Dead Engine Cleanup Summary

**1825 lines of dead v0.1 custom battle engine code deleted — BattleEngine, DamageCalc, StatusEngine, TurnResolver, AIOpponent, engineSmoke removed; only @pkmn/sim-based SimBattleAdapter + SimAIOpponent remain**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-01T21:08:19Z
- **Completed:** 2026-03-01T21:10:19Z
- **Tasks:** 1
- **Files modified:** 6 deleted

## Accomplishments

- Deleted 6 dead v0.1 custom battle engine files (1825 lines removed)
- Confirmed zero dangling imports before and after deletion
- TypeScript compilation (`tsc --noEmit`) passes with zero errors
- Vite production build succeeds cleanly in 3.52s

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete dead v0.1 engine files and verify clean build** - `9a79b09` (chore)

**Plan metadata:** (see docs commit below)

## Files Created/Modified

- `src/battle/AIOpponent.ts` - DELETED (replaced by SimAIOpponent.ts since Phase 5.2)
- `src/battle/BattleEngine.ts` - DELETED (replaced by SimBattleAdapter.ts since Phase 5.2)
- `src/battle/DamageCalc.ts` - DELETED (replaced by @smogon/calc via SimBattleAdapter since Phase 5.2)
- `src/battle/StatusEngine.ts` - DELETED (replaced by @pkmn/sim mechanics since Phase 5.2)
- `src/battle/TurnResolver.ts` - DELETED (replaced by SimBattleAdapter since Phase 5.2)
- `src/battle/engineSmoke.ts` - DELETED (standalone smoke test for now-deleted engine)

## Decisions Made

- Used word-boundary `\b` in grep pattern (`from.*AIOpponent\b`) to distinguish `AIOpponent` from `SimAIOpponent` — no false positives.
- All 6 files confirmed import-free via grep before deletion (as pre-validated during Phase 5.2 planning).

## Deviations from Plan

None — plan executed exactly as written. All 6 files were already confirmed safe to delete during planning; grep scan after deletion returned zero matches.

## Issues Encountered

None — deletion was clean with no surprises.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `src/battle/` is now clean: LogParser.ts, SimAIOpponent.ts, SimBattleAdapter.ts, simSmoke.ts, stressTest.ts, TeamGenerator.ts, TeamGenerator.test.ts
- No remaining references to old engine anywhere in codebase
- Ready to continue Phase 7 plans (07-04 and beyond)

---
*Phase: 07-speed-config-model-foundation*
*Completed: 2026-03-01*
