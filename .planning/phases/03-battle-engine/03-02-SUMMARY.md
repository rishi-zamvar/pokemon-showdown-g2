---
phase: 03-battle-engine
plan: 02
subsystem: battle-engine
tags: [damage-calc, smogon-calc, accuracy, pp-tracking, crits, tera]
dependency-graph:
  requires: [03-01]
  provides: [DamageCalc wrapper, real damage in BattleEngine, PP tracking, accuracy rolls, crit rolls]
  affects: [03-03 (status effects), 04-tera (tera damage already supported)]
tech-stack:
  added: []
  patterns: [thin wrapper around @smogon/calc, 16-roll random bracket, immutable ppUsed updates]
key-files:
  created:
    - src/battle/DamageCalc.ts
  modified:
    - src/battle/BattleEngine.ts
    - src/battle/engineSmoke.ts
decisions:
  - id: "03-02-01"
    decision: "Status moves return 0 without calling @smogon/calc"
    reason: "@smogon/calc returns 0 for status moves anyway, but skipping avoids potential edge cases"
  - id: "03-02-02"
    decision: "PP consumed even on miss — only PP_OUT (0 remaining) skips consumption"
    reason: "Matches real Pokemon games where PP is deducted when a move is selected, not when it hits"
  - id: "03-02-03"
    decision: "Tera type passed to both attacker and defender CalcPokemon only when teraActive is true"
    reason: "@smogon/calc handles Tera STAB and defensive type changes correctly when teraType is set"
metrics:
  duration: ~3 min
  completed: 2026-02-26
---

# Phase 3 Plan 2: DamageCalc + Real Damage in BattleEngine Summary

DamageCalc.ts wraps @smogon/calc calculate() for Gen 9 with 16-roll random bracket, wired into BattleEngine replacing placeholder 50 HP damage. PP tracking, accuracy rolls, and crit rolls all integrated.

## What Was Done

### Task 1: DamageCalc.ts (thin wrapper around @smogon/calc)

Created `src/battle/DamageCalc.ts` with 7 exports:

- **computeDamage()** — constructs CalcPokemon for attacker/defender with level, ability, item, nature, IVs, EVs, status, curHP, and teraType (only when teraActive). Calls `calculate(GEN9, attacker, defender, move)` and returns a random value from the 16-roll `result.damage` array. Returns 0 for Status-category moves.
- **rollCrit()** — Gen 9 thresholds: [24, 8, 2, 1] for critRatio 0-3 (base 1/24 rate).
- **doesMoveHit()** — returns true if accuracy is `true` (always hit), otherwise `Math.random() * 100 < accuracy`.
- **getMovePP()** — looks up max PP via DataLoader.
- **getMoveAccuracy()** — looks up accuracy via DataLoader.
- **getMovePriority()** — looks up priority via DataLoader.
- **getMoveCritRatio()** — looks up critRatio via DataLoader.

### Task 2: Wire DamageCalc into BattleEngine

Updated the attack resolution path in `submitAction()`:

1. **PP Check** — checks `ppUsed[moveSlug]` against `getMovePP()`. If exhausted, logs PP_OUT and skips. Otherwise increments ppUsed immutably.
2. **Accuracy Check** — calls `doesMoveHit(getMoveAccuracy(moveSlug))`. On miss, logs MISS and skips damage.
3. **Crit Roll** — calls `rollCrit(getMoveCritRatio(moveSlug))`.
4. **Damage Calc** — calls `computeDamage(attacker, defender, moveSlug, isCrit)`. Applies damage, sets fainted flag.
5. **DAMAGE log** — includes `isCrit` boolean and actual damage value.

Removed `PLACEHOLDER_DAMAGE = 50` constant and all TODOs referencing it.

Updated smoke test with 8 test suites (26 assertions), all passing. Test 8 confirms damage variance across 10 battles — values like 0, 134, 18, 54 (not constant 50).

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

1. `npx tsc --noEmit` — zero type errors
2. Smoke test shows variable damage: 0, 134, 18, 54 (not constant 50)
3. PP increments by 1 after each move use (verified in Test 3)
4. Moves with accuracy < 100 can miss (MISS entries appear in logs)
5. isCrit boolean present on all DAMAGE log entries
6. Status-category moves (e.g. Substitute) return 0 damage
7. Tera type conditionally passed based on teraActive flag

## Commits

| Hash | Message |
|------|---------|
| c6c6618 | feat(03-02): create DamageCalc.ts wrapping @smogon/calc for Gen 9 |
| c3f15a1 | feat(03-02): wire DamageCalc into BattleEngine, replace placeholder 50 HP |

## Next Phase Readiness

Plan 03-03 (Status Effects) can proceed. DamageCalc already passes `status` to @smogon/calc (burn halving is handled automatically). The PP/accuracy/crit infrastructure is complete and will not need changes for status effects.
