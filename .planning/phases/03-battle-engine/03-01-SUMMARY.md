---
phase: 03-battle-engine
plan: 01
subsystem: battle-engine
tags: [battle-state, fsm, turn-resolution, immutability]
dependency-graph:
  requires: [01-data-foundation, 02-team-generation]
  provides: [BattleState types, BattleEngine API, TurnResolver]
  affects: [03-02 (damage calc), 03-03 (status effects), 04-tera]
tech-stack:
  added: []
  patterns: [immutable state updates via spread, FSM phase transitions, module singleton]
key-files:
  created:
    - src/types/battleState.ts
    - src/battle/BattleEngine.ts
    - src/battle/TurnResolver.ts
    - src/battle/engineSmoke.ts
  modified: []
decisions:
  - Placeholder 50 HP damage — replaced by DamageCalc in 03-02
  - Double KO convention — opponent wins (rare edge case)
  - Toxic counter resets to 1 on switch-in (Gen 9 behavior)
metrics:
  duration: ~2.5 min
  completed: 2026-02-26
---

# Phase 03 Plan 01: Battle Engine Core Summary

**One-liner:** Immutable BattleState FSM with turn resolution (switch > priority > speed), faint/win detection, and placeholder damage

## What Was Built

### battleState.ts — All Battle State Types
- `BattlePhase` FSM: WAITING_FOR_ACTION, RESOLVING_TURN, WAITING_FOR_SWITCH, BATTLE_OVER
- `ActivePokemon` extends BattlePokemon with runtime fields (currentHp, status, fainted, toxicCounter, sleepTurns, teraActive, ppUsed)
- `BattleSide` (team + activeIndex + teraUsed), `PlayerAction` (discriminated union: ATTACK | SWITCH | TERA_ATTACK)
- `TurnLogEntry` with 12 event kinds for UI rendering
- `TurnResult` bundles nextState + log
- `BattleState` top-level readonly interface
- `initActivePokemon()` helper converts BattlePokemon to ActivePokemon

### TurnResolver.ts — Turn Ordering
- `resolveTurnOrder()` determines execution order for two actions
- Switches always before attacks; higher move priority first; higher Speed first; random tiebreak
- Paralysis does NOT reduce Speed in Gen 9 (documented in code)
- Uses DataLoader.getMove() for priority lookup

### BattleEngine.ts — Public API
- `startBattle()`: generates two 6-Pokemon teams via TeamGenerator, returns initial BattleState
- `submitAction()`: resolves one turn — validates phase, executes actions in order, applies damage, detects faints, transitions phase
- `submitSwitch()`: handles forced switch after faint — validates target alive, handles double faint (both sides need switch), transitions phase
- All state updates immutable via spread — helper functions `updateSideTeam()`, `replaceTeamMember()`
- Tera validation: throws if teraUsed already true

### engineSmoke.ts — Smoke Test
- 21 assertions covering: initial state, immutability, damage application, switch ordering, faint detection, BATTLE_OVER, submitSwitch

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Placeholder 50 HP damage | Plan 03-02 will wire real DamageCalc; this lets us verify the engine skeleton |
| Double KO: opponent wins | Convention for rare edge case; real games handle differently |
| Toxic counter resets to 1 on switch | Gen 9 behavior — toxic damage restarts after switching |
| No accuracy/status effects | Deliberately excluded per plan scope (03-02 and 03-03) |

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

1. `npx tsc --noEmit` — zero errors
2. `npx tsx src/battle/engineSmoke.ts` — 21/21 pass
3. startBattle: phase WAITING_FOR_ACTION, 6 Pokemon per side, all full HP
4. submitAction: returns new state, HP reduced by ~50
5. Switch resolves before attack in turn order
6. Fainted Pokemon skip their attack
7. All 6 fainted triggers BATTLE_OVER with correct winner

## Next Phase Readiness

Plan 03-02 (DamageCalc) can now:
- Import BattleState types and ActivePokemon
- Replace PLACEHOLDER_DAMAGE constant with real @smogon/calc integration
- Add accuracy checks within the existing ATTACK/TERA_ATTACK flow

Plan 03-03 (Status Effects) can now:
- Hook into the turn resolution loop for per-turn status ticks
- Use the existing StatusCondition type and ActivePokemon fields
