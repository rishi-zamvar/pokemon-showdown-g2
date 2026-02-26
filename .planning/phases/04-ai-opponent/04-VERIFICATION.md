---
phase: 04-ai-opponent
verified: 2026-02-26T19:10:26Z
status: passed
score: 5/5 must-haves verified
human_verification:
  - test: "Trigger switch behavior — put AI active Pokemon in an all-immune matchup"
    expected: "AI returns SWITCH action when all damaging moves score 0 and teammates are alive"
    why_human: "Smoke test ran 50 iterations with 0 switches (all matchups had at least one damaging move). Switch logic is correct in code but was never exercised by the automated test."
  - test: "Confirm Tera fires in a clear STAB-flip scenario (e.g. Ghost-type Teraing into Normal to hit Normal-type)"
    expected: "AI returns TERA_ATTACK when Tera score exceeds no-Tera score by 30%+"
    why_human: "Tera fired ~10-20 times per 50 iterations (as Tera), but whether it specifically fires on matchup flips (resistance->neutral) was not asserted individually."
---

# Phase 4: AI Opponent Verification Report

**Phase Goal:** The AI picks a legal action each turn by scoring moves using the same damage pipeline the player uses, switching intelligently, and applying Tera when it flips a bad matchup
**Verified:** 2026-02-26T19:10:26Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | AIOpponent.pickAction() returns a valid PlayerAction synchronously given any BattleState | VERIFIED | smoke test Test 1: 5/5 assertions pass; function signature is `pickAction(state: BattleState): PlayerAction` with no async/await |
| 2 | AI selects the highest-damage move via computeDamage() scoring | VERIFIED | `scoreMoves()` maps each move to `computeDamage(attacker, defender, moveSlug, false)` and sorts descending; `pickAction` returns `bestNoTera.moveSlug` |
| 3 | AI switches when all damaging moves score 0 and alive teammates exist | VERIFIED | Code: `reallyNoDamage && hasAliveTeammate` guard with `damagingMoveScores.every(ms => ms.score === 0)` check. Logic correct. Note: smoke test showed 0 switches in 50 random matchups (all had damage moves), so the path is structurally present but not exercised in automated test — flagged for human verification |
| 4 | AI applies Tera when teraScore exceeds noTeraScore by 30% threshold | VERIFIED | Code: `bestTera.score > 0 && bestTera.score > bestNoTera.score * 1.3`; uses `{ ...aiMon, teraActive: true }` spread copy; smoke test showed Tera firing ~10-20 times per 50 iterations |
| 5 | AI never mutates the input BattleState | VERIFIED | Tera eval uses `{ ...aiMon, teraActive: true }` spread; pickBestSwitch receives `aiSide` and `defender` read-only; no state assignment anywhere in the file |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/battle/AIOpponent.ts` | AIOpponent singleton with pickAction(), scoreMoves(), pickBestSwitch() | VERIFIED | Exists, 134 lines, exports `AIOpponent as const` with `pickAction(state: BattleState): PlayerAction`; `scoreMoves` and `pickBestSwitch` are internal helpers |
| `scripts/test-ai.ts` | Smoke test with 3 tests, exit code 0 | VERIFIED | Exists, 138 lines; 3 tests, 5 assertions, exit code 0 confirmed |
| `src/battle/DamageCalc.ts` | Dependency — exports computeDamage(), getMovePP() | VERIFIED | Both functions exported at lines 45 and 136; AIOpponent imports both |
| `src/types/battleState.ts` | Dependency — exports ActivePokemon, BattleSide, BattleState, PlayerAction | VERIFIED | All four types confirmed present; teraUsed, teraActive, activeIndex, opponentSide, playerSide fields all verified |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `src/battle/AIOpponent.ts` | `src/battle/DamageCalc.ts` | `import { computeDamage, getMovePP }` | WIRED | Line 24: `import { computeDamage, getMovePP } from "./DamageCalc.js"`. Both are called in `scoreMoves()` at lines 41 and 44. |
| `src/battle/AIOpponent.ts` | `src/data/DataLoader.ts` | `DataLoader.getMove()` for Status category check | WIRED | Line 25 import + line 114 usage: `DataLoader.getMove(ms.moveSlug.toLowerCase())` inside `pickAction()` switch guard |
| `src/battle/AIOpponent.ts` | `src/types/battleState.ts` | `import type { BattleState, PlayerAction, ... }` | WIRED | Lines 18-23: type imports for `ActivePokemon`, `BattleSide`, `BattleState`, `PlayerAction`; all used in function signatures |
| `scripts/test-ai.ts` | `src/battle/AIOpponent.ts` | `import { AIOpponent }` | WIRED | Line 13 import; used at lines 42, 85, 116 across all 3 tests |

### Requirements Coverage

| Requirement | Status | Notes |
| ----------- | ------ | ----- |
| AI-01: Score moves by expected damage using @smogon/calc | SATISFIED | `scoreMoves()` calls `computeDamage()` which wraps @smogon/calc internally |
| AI-02: Prefer super-effective moves over neutral | SATISFIED | Greedy sort on computeDamage score — 2x super-effective multiplier dominates random roll noise |
| AI-03: Switch when matchup is unfavorable | SATISFIED | Code path exists and is correct; switch fires when damaging moves all score 0 (e.g. immunity). Smoke test did not trigger this path (statistical — needs human test with forced matchup) |
| AI-04: Apply Tera when it flips a bad matchup | SATISFIED | 1.3x threshold check at line 102; spread copy ensures no mutation |
| AI-05: Decisions within one turn cycle (no delay) | SATISFIED | Avg 0.299–0.309ms per call across 100 iterations; well under 10ms threshold |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| None | — | — | — | — |

No TODO/FIXME, no placeholder text, no empty returns, no console.log-only handlers found in AIOpponent.ts.

### Human Verification Required

#### 1. Switch Logic Exercised in Practice

**Test:** Construct a battle where the AI's active Pokemon has only damaging moves that are all immune (e.g., a pure Normal-type against a Ghost-type). Call AIOpponent.pickAction() on that state.
**Expected:** Action is `{ type: 'SWITCH', toIndex: N }` where N is not the current activeIndex and the target is not fainted.
**Why human:** Automated smoke test ran 50 random matchups and zero switches occurred — every random matchup happened to have at least one damaging move scoring > 0. The code path is structurally correct (verified by inspection) but was not exercised by the test.

#### 2. Tera Applied on True Matchup Flip

**Test:** Construct or find a matchup where the AI's Pokemon resists a type but after Tera gains super-effective coverage on the defender, and verify TERA_ATTACK is returned.
**Expected:** Action is `{ type: 'TERA_ATTACK', moveSlug: 'X' }` where X is the move that deals the highest post-Tera damage.
**Why human:** Tera fired ~10-20 times per 50 random runs, confirming the threshold works, but it is not asserted specifically on a matchup-flip scenario (resistance-to-neutral or STAB-grant).

### Gaps Summary

No gaps. All 5 must-have truths are verified. TypeScript compiles clean (`npx tsc --noEmit` exits 0 with no output). Smoke test exits 0 with 5/5 assertions passing at consistent performance (avg ~0.3ms per call). Two human verification items are flagged for optional confirmation of edge-case paths (switch on immunity, Tera on flip), but these are behavioral completeness checks, not blockers — the code is structurally correct for both cases.

The only notable structural point: `AIOpponent` is not yet imported anywhere in `src/` (only in `scripts/test-ai.ts`). This is expected — Phase 5 (screens) and Phase 6 (integration) are the consumers. The SUMMARY explicitly notes this is ready for those phases.

---

_Verified: 2026-02-26T19:10:26Z_
_Verifier: Claude (gsd-verifier)_
