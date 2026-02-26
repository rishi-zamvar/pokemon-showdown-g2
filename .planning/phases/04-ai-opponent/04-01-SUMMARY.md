---
phase: 04-ai-opponent
plan: 01
subsystem: ai
tags: [smogon-calc, damage-scoring, greedy-ai, tera, type-effectiveness, battle-engine]

# Dependency graph
requires:
  - phase: 03-battle-engine
    provides: BattleState, PlayerAction types, computeDamage(), getMovePP(), BattleEngine.startBattle()
  - phase: 01-data-foundation
    provides: DataLoader.getMove() for Status category check, DataLoader.getTypechart()
  - phase: 02-team-generation
    provides: TeamGenerator for smoke test state generation

provides:
  - AIOpponent singleton with pickAction(state: BattleState): PlayerAction
  - scoreMoves() internal helper — damage scoring for any attacker/defender pair
  - pickBestSwitch() internal helper — switch candidate selection by max move score

affects:
  - 05-screens (screens consume AIOpponent.pickAction on every opponent turn)
  - 06-integration (full battle loop calls AIOpponent for all opponent decisions)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level singleton: export const AIOpponent = { ... } as const"
    - "Immutable Tera eval: { ...aiMon, teraActive: true } spread copy, never mutate"
    - "Greedy damage scoring: computeDamage(isCrit=false) for all moves with PP"

key-files:
  created:
    - src/battle/AIOpponent.ts
    - scripts/test-ai.ts
  modified: []

key-decisions:
  - "Switch threshold: only switch when damaging moves all score 0 (not just all moves)"
  - "Status-move guard: if all moves are Status, attack with best scoring (avoids switch loop)"
  - "Tera threshold: 30% improvement (teraScore > noTeraScore * 1.3) triggers TERA_ATTACK"
  - "computeDamage used as-is for AI scoring (random 85-100% roll acceptable per research)"
  - "pickBestSwitch scores candidate mon not current aiMon (prevents copy-paste bug)"

patterns-established:
  - "AI-01/02: computeDamage() is the single damage signal — no manual type math"
  - "AI-03: Switch only when damaging moves exist and all score 0 AND alive teammates"
  - "AI-04: Tera eval via spread copy; fire when 30%+ improvement over no-Tera"
  - "AI-05: Synchronous — 0.28ms average per call, well under 10ms requirement"

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 4 Plan 01: AI Opponent Summary

**Greedy single-turn AI using computeDamage() scoring with Tera evaluation at 1.3x threshold and switch fallback when all damaging moves are resisted**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-26T19:05:56Z
- **Completed:** 2026-02-26T19:07:18Z
- **Tasks:** 2
- **Files modified:** 2 created

## Accomplishments
- AIOpponent.pickAction() implemented as module singleton — synchronous, pure, zero new dependencies
- Greedy scoring selects highest-damage move via computeDamage(isCrit=false) — satisfies AI-01/02
- Switch logic fires only when damaging moves exist and all score 0 — satisfies AI-03, avoids status-move switch loop
- Tera fires when spread-copy score > 1.3x no-Tera score — satisfies AI-04, never mutates state
- Smoke test confirms: 5/5 assertions pass, switch rate 2% (under 20%), avg 0.28ms (under 10ms)

## Task Commits

1. **Task 1: Create AIOpponent module with full pickAction() implementation** - `d5ce85c` (feat)
2. **Task 2: Smoke test AIOpponent with controlled BattleState scenarios** - `68911b8` (feat)

**Plan metadata:** _(docs commit below)_

## Files Created/Modified
- `src/battle/AIOpponent.ts` - AIOpponent singleton: pickAction(), scoreMoves(), pickBestSwitch()
- `scripts/test-ai.ts` - Standalone tsx smoke test: 3 tests, 5 assertions, exit code 0

## Decisions Made
- **Switch threshold:** Only switch when at least one damaging move exists and all score 0. If all moves are Status-category, the AI uses the status move (avoids infinite switch loop edge case from research pitfall 5).
- **Tera threshold:** 1.3x improvement chosen per research recommendation. Observed ~10-20% Tera activation rate across 50 random matchups — well-calibrated.
- **computeDamage for AI scoring:** Using it as-is (random 85-100% roll) — the 2x super-effective multiplier is too large for random noise to flip move preference. Acceptable per research.
- **pickBestSwitch uses candidate mon:** scoreMoves receives the loop variable `candidate`, not the captured `aiMon` — explicitly preventing the copy-paste bug documented in pitfall 3.

## Deviations from Plan

None - plan executed exactly as written.

The research's "Simpler approach" (Pattern 3, last paragraph) was used for the switch decision — computeDamage scores directly, not typechart damageTaken lookups. This was explicitly noted in the research as the preferred approach for AI-03.

## Issues Encountered
None — the research accurately predicted all pitfalls. Zero type errors on first compile.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- AIOpponent.pickAction() is production-ready for Phase 5 (screens) and Phase 6 (integration)
- Import: `import { AIOpponent } from '../battle/AIOpponent.js'`
- Call on every opponent turn: `const opponentAction = AIOpponent.pickAction(state)`
- No blockers. Smoke test exits 0 consistently.

---
*Phase: 04-ai-opponent*
*Completed: 2026-02-26*
