---
phase: 03-battle-engine
plan: 03
subsystem: battle-engine
tags: [status-effects, burn, paralysis, poison, toxic, sleep, freeze, tera, struggle, gen9]
depends_on:
  requires: ["03-01", "03-02"]
  provides: ["StatusEngine with all 6 status conditions", "Complete BattleEngine with full battle loop", "Struggle fallback for PP exhaustion"]
  affects: ["04-ai", "05-screens"]
tech-stack:
  added: []
  patterns: ["StatusEngine module singleton for status logic", "Struggle fallback when all PP exhausted"]
key-files:
  created: ["src/battle/StatusEngine.ts"]
  modified: ["src/battle/BattleEngine.ts", "src/battle/engineSmoke.ts"]
decisions:
  - id: "03-03-01"
    decision: "Sleep turns decremented at move-attempt time (checkMoveBlock), not end of turn"
    reason: "Gen 9 mechanic: sleep blocks the turn it wakes up, moves next turn"
  - id: "03-03-02"
    decision: "Second Tera attempt degrades to regular attack with console.warn instead of throwing"
    reason: "Graceful degradation prevents crashes; AI or UI may send invalid Tera"
  - id: "03-03-03"
    decision: "Struggle implemented as fallback when all 4 moves have 0 PP"
    reason: "Without Struggle, battles stall infinitely when PP is exhausted"
metrics:
  duration: "~5 min"
  completed: "2026-02-26"
---

# Phase 3 Plan 3: Status Effects + Full Battle Integration Summary

**One-liner:** StatusEngine with all 6 Gen 9 status conditions (burn/par/psn/tox/slp/frz) integrated into BattleEngine with Struggle fallback for PP exhaustion

## What Was Built

### StatusEngine.ts (new)
- `applyEndOfTurnStatus()`: burn 1/16 max HP, poison 1/8, toxic scaling (counter/16), sleep wake-up
- `checkMoveBlock()`: paralysis 25% skip, sleep block with turn decrement, freeze 20% thaw
- `inflictSleep()`: 2-4 turn duration rolled at inflict time
- `resetToxicOnSwitchIn()`: counter resets to 1 (not 0) on switch-in
- All damage uses `Math.max(1, ...)` for minimum 1 HP per tick

### BattleEngine.ts (updated)
- Status move blocking inserted before PP check in attack path
- End-of-turn status effects applied after both actors act (before phase resolution)
- Faint from status damage triggers forced switch or BATTLE_OVER
- Tera one-use enforcement: second attempt logs warning, degrades to regular attack
- Struggle fallback: when all 4 moves have 0 PP, uses typeless damage + 25% max HP recoil
- Both submitAction() and submitSwitch() use StatusEngine's resetToxicOnSwitchIn()

### Smoke Test (rewritten)
- Full 6v6 battle runs to completion (~35 turns) with winner detected
- Tests: burn damage, toxic scaling, toxic counter reset on switch, Tera enforcement, PP tracking, switch order, immutability, damage variance
- 21 assertions, all passing

## Complete Turn Resolution Order

1. Check if actor fainted (skip if dead)
2. checkMoveBlock() — paralysis/sleep/freeze (update state if thawed/woke)
3. Tera activation (if TERA_ATTACK and not already used)
4. PP check (Struggle if all PP exhausted)
5. Accuracy check (Struggle always hits)
6. Crit roll + damage calc via @smogon/calc
7. Apply damage + faint check
8. Struggle recoil (25% max HP)
9. **After both actors:** applyEndOfTurnStatus() for each side
10. Post-status faint check
11. resolvePostTurnPhase() — BATTLE_OVER / WAITING_FOR_SWITCH / WAITING_FOR_ACTION

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added Struggle fallback for PP exhaustion**
- **Found during:** Task 2 (smoke test showed battles stalling at turn ~20)
- **Issue:** When all 4 moves had 0 PP remaining, the PP_OUT check skipped the attack entirely with no fallback, causing infinite stall
- **Fix:** When all PP exhausted, use "struggle" move (typeless, always hits, no crit, 25% max HP recoil to attacker). @smogon/calc handles Struggle's 50 BP damage calculation.
- **Files modified:** src/battle/BattleEngine.ts
- **Commit:** e5a8abb

## Decisions Made

| ID | Decision | Reason |
|----|----------|--------|
| 03-03-01 | Sleep turns decremented at move-attempt time | Gen 9: blocks turn it wakes, moves next turn |
| 03-03-02 | Second Tera degrades gracefully (warn, not throw) | Prevents crashes from AI/UI sending invalid Tera |
| 03-03-03 | Struggle fallback when all PP = 0 | Battles stall infinitely without it |

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Zero errors |
| Full 6v6 battle smoke test | Completes in ~35 turns with winner |
| Burn deals 1/16 max HP | Confirmed (15 for 240 HP mon) |
| Paralysis blocks ~25% | Implemented, tested in unit test |
| Toxic scales 1/16, 2/16, 3/16... | Confirmed, counter increments to 2 after first tick |
| Toxic resets to 1 on switch | Confirmed (counter=5 -> counter=1) |
| Sleep 2-4 turns at inflict | Implemented in inflictSleep() |
| Freeze 20% thaw | Implemented in checkMoveBlock() |
| Tera one-use per side | Confirmed, second attempt degrades |
| Faint from status -> switch/win | Implemented in end-of-turn loop |
| No state mutation | Confirmed via JSON snapshot comparison |

## Phase 3 Complete

All three plans in Phase 3 (Battle Engine) are now complete:
- **03-01:** Core BattleEngine FSM with faint/switch/win detection
- **03-02:** DamageCalc wrapper for @smogon/calc with PP, accuracy, crits
- **03-03:** StatusEngine + full integration with Struggle fallback

The battle engine now supports: real damage via @smogon/calc, all 6 status conditions, Terastallization (one-use), PP tracking with Struggle, accuracy rolls, critical hits, faint + forced switch, and win/loss detection. Ready for Phase 4 (AI) and Phase 5 (Screens).
