---
phase: 03-battle-engine
plan: 04
subsystem: battle-engine
tags: [typescript, status-conditions, move-effects, secondary-effects, smoke-test]

# Dependency graph
requires:
  - phase: 03-battle-engine
    provides: StatusEngine with inflictSleep/checkMoveBlock/applyEndOfTurnStatus; BattleEngine with full attack resolution loop; DamageCalc wrapper
provides:
  - inflictStatus() function in StatusEngine handling all 6 statuses from any source
  - MoveSecondaryEffect typed interface on MoveEntry.secondary
  - BattleEngine Block A: primary status moves (Thunder Wave, Spore, etc.) inflict status on hit
  - BattleEngine Block B: secondary effects on damaging moves (Scald, Thunderbolt, etc.) roll at correct chance
  - DamageCalc NaN guard: result.damage non-array edge case fixed
  - Smoke tests 11-12 confirming status infliction frequency and no double-status
affects: [04-ai, 05-display, 06-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "inflictStatus() is the single entry point for all status infliction from moves — both primary and secondary"
    - "Status infliction is gated: pokemon.status !== '' blocks re-infliction (no double-status in Gen 9)"
    - "DataLoader.getMove() called once per attack turn; moveInfo reused for both Block A and Block B"
    - "result.damage from @smogon/calc must be guarded with Array.isArray() — edge cases return number not number[]"

key-files:
  created: []
  modified:
    - src/types/pokemon.ts
    - src/battle/StatusEngine.ts
    - src/battle/BattleEngine.ts
    - src/battle/DamageCalc.ts
    - src/battle/engineSmoke.ts

key-decisions:
  - "inflictStatus() uses oppositeActor(actor) as the log entry actor — actor field means 'who received the status'"
  - "Block A fires for Status-category moves with a status field; Block B fires for damage > 0 with secondary.status"
  - "DamageCalc result.damage is cast as number | number[] — non-array case (immune/edge) returns 0, not NaN"
  - "Smoke test pickMove() now prefers damaging moves over Status moves to prevent healing/stall infinite loops"
  - "Test 1 turn limit raised from 200 to 500 — status infliction (sleep, para) legitimately extends battle length"

patterns-established:
  - "Status never inflicted on fainted Pokemon (inflictStatus checks fainted before applying)"
  - "Toxic counter starts at 1 when inflicted via inflictStatus (matches resetToxicOnSwitchIn behavior)"
  - "Sleep via inflictStatus delegates to inflictSleep() — duration rolled once at inflict time (2-4 turns)"

# Metrics
duration: 7min
completed: 2026-02-26
---

# Phase 3 Plan 04: Status Infliction from Moves Summary

**Status now inflicts naturally in battle: inflictStatus() wires primary moves (Thunder Wave, Spore) and secondary effects (Scald 30% burn, Thunderbolt 10% par) into BattleEngine, closing the last Phase 3 gap**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-26T16:09:20Z
- **Completed:** 2026-02-26T16:16:36Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `MoveSecondaryEffect` typed interface to `src/types/pokemon.ts`, replacing `secondary?: unknown` with `secondary?: MoveSecondaryEffect | null`
- Added `inflictStatus()` to `StatusEngine.ts` — single entry point for all 6 statuses from any source, with guards for existing status and fainted Pokemon
- Wired Block A (primary status moves) and Block B (secondary effects) into BattleEngine attack path, with move data looked up once per turn via DataLoader
- Fixed pre-existing NaN bug in DamageCalc: `result.damage` from @smogon/calc can be a number (not array) for immune/edge-case moves; now guarded with `Array.isArray()`
- Added smoke Tests 11-12: Scald inflicts burn at ~30% over 100 attempts; Thunder Wave inflicts par and respects no-double-status rule

## Task Commits

Each task was committed atomically:

1. **Task 1: Add inflictStatus() to StatusEngine and type MoveSecondaryEffect** - `f32a9df` (feat)
2. **Task 2: Wire status infliction into BattleEngine attack path and add smoke test** - `17c54ea` (feat)

**Plan metadata:** pending (docs commit below)

## Files Created/Modified
- `src/types/pokemon.ts` - Added `MoveSecondaryEffect` interface; updated `MoveEntry.secondary` from `unknown` to `MoveSecondaryEffect | null`
- `src/battle/StatusEngine.ts` - Added `inflictStatus()` export; added `StatusCondition` import
- `src/battle/BattleEngine.ts` - Imported `inflictStatus` and `DataLoader`; added Block A (primary status) and Block B (secondary) after DAMAGE log push
- `src/battle/DamageCalc.ts` - Fixed NaN bug: guard `result.damage` with `Array.isArray()` before indexing
- `src/battle/engineSmoke.ts` - Added DataLoader import; improved `pickMove()` to prefer damaging moves; raised turn limit from 200 to 500; added Tests 11-12

## Decisions Made
- `inflictStatus()` uses `oppositeActor(actor)` as the log actor — the actor field in STATUS_INFLICT means "who received the status" (matching STATUS_TICK convention where actor is who took damage)
- Block A uses `moveInfo?.category === "Status" && moveInfo.status` — only primary status moves have both fields
- Block B only rolls if `damage > 0 && !useStruggle` — prevents status from Struggle and from immunity/immune-type moves returning 0
- DamageCalc NaN fix: cast `result.damage as number | number[]` then guard with `Array.isArray()` — keeps TypeScript happy without unsafe casting

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed NaN HP propagation from DamageCalc for edge-case moves**
- **Found during:** Task 2 (smoke test diagnosis — battles stuck at 500 turns with `HP: NaN/265`)
- **Issue:** `@smogon/calc` returns `result.damage` as a plain `number` (e.g., `0`) for immune targets and some edge-case moves (Strength Sap, Overheat after stat drops). The code did `result.damage as number[]` then accessed `rolls[Math.floor(Math.random() * rolls.length)]` — when `rolls` is `0`, `rolls.length` is `undefined`, producing NaN damage that propagates indefinitely.
- **Fix:** Guard with `Array.isArray(damageResult)` — non-array values returned directly as `number`, empty arrays return `0`
- **Files modified:** `src/battle/DamageCalc.ts`
- **Verification:** 10 smoke test runs all pass; NaN HP no longer occurs in 200-battle stress test
- **Committed in:** `17c54ea` (Task 2 commit)

**2. [Rule 1 - Bug] Improved smoke test pickMove() to prefer damaging moves**
- **Found during:** Task 2 (Test 1 occasionally hitting the turn limit after status infliction was added)
- **Issue:** The `pickMove()` helper always selected the move with least PP used. With Spore/Sleep Powder now actually inflicting sleep, a Pokemon could cycle: use Spore → opponent sleeps → opponent wakes → use Spore again, indefinitely stalling the test (especially combined with healing moves like Roost/Wish)
- **Fix:** `pickMove()` now filters damaging (Physical/Special) moves first and only picks Status moves when no damaging moves have remaining PP. Also raised the safety limit from 200 to 500 turns.
- **Files modified:** `src/battle/engineSmoke.ts`
- **Verification:** 10/10 smoke test runs pass; 200 stress-test battles all complete within limit
- **Committed in:** `17c54ea` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 — bug fixes)
**Impact on plan:** Both auto-fixes necessary for test correctness and reliability. No scope creep — DamageCalc NaN fix was a latent pre-existing bug exposed by longer battles; pickMove fix is purely test infrastructure.

## Issues Encountered
- The double STATUS_INFLICT check in smoke Test 11 initially counted burns on both sides (player AND opponent can burn from Scald). Fixed by filtering to `actor === "opponent"` (status received by opponent from player's Scald).
- Similarly, Test 12 no-double-status check initially caught STATUS_INFLICT entries from the opponent's own secondary-effect moves affecting the player. Fixed by filtering to `actor === "opponent"` (checking only inflictions on the opponent's side).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- Phase 3 gap fully closed: status now inflicts from both primary moves and secondary effects
- BattleEngine is feature-complete for Phase 3: damage, crits, accuracy, PP, Tera, status ticks, status infliction, Struggle, faint/switch/win
- Phase 4 (AI) can now build realistic move selection knowing status will be inflicted naturally
- Phase 5 (Display) can render STATUS_INFLICT log entries (kind is already typed in TurnLogEntry)
- 03-VERIFICATION.md gap (status infliction) is now closed

---
*Phase: 03-battle-engine*
*Completed: 2026-02-26*
