# Phase 4: AI Opponent - Research

**Researched:** 2026-02-26
**Domain:** Greedy turn-based AI using @smogon/calc damage scoring + type-chart matchup evaluation
**Confidence:** HIGH

---

## Summary

Phase 4 builds `AIOpponent.pickAction()` — a pure function that takes a `BattleState` and returns a `PlayerAction` from the opponent's perspective. The function must run synchronously within one turn cycle (AI-05) and requires no network calls, no new dependencies, and no additional package installation.

The AI's decision loop has three tiers: (1) score all legal moves using `computeDamage()` (the existing DamageCalc wrapper around `@smogon/calc`), (2) check whether switching is better than attacking using the PS typechart already in `DataLoader`, and (3) evaluate whether Terastallization would improve the scoring outcome enough to trigger. All data needed — type chart, move types, Pokemon types, damage calculation — is already in the codebase. No new libraries are required.

The scoring approach is greedy: pick the action with the highest expected damage score. This directly satisfies AI-01 through AI-04. Synchronous execution on a 6-Pokemon team with 4 moves each takes microseconds, satisfying AI-05 trivially.

**Primary recommendation:** Implement `AIOpponent` as a module-level singleton (`export const AIOpponent = { pickAction(state) }`) in `src/battle/AIOpponent.ts`. The function calls `computeDamage()` for move scoring, reads `DataLoader.getMove()` for move types, reads `DataLoader.getTypechart()` for type matchup scoring, and reads `DataLoader.getPokemon()` for defender types. It returns a `PlayerAction` synchronously.

---

## Standard Stack

No new packages. Everything is already installed and in use.

### Core (all already in project)

| Module | Location | Purpose | Why Standard |
|--------|----------|---------|--------------|
| `computeDamage()` | `src/battle/DamageCalc.ts` | Score moves by expected damage | Already wraps @smogon/calc correctly; handles Tera, STAB, status |
| `DataLoader.getMove()` | `src/data/DataLoader.ts` | Fetch move type + category | Returns `MoveEntry` with `.type`, `.category`, `.basePower` |
| `DataLoader.getTypechart()` | `src/data/DataLoader.ts` | Check type matchup for switch scoring | Returns the full PS typechart with damageTaken encoding |
| `DataLoader.getPokemon()` | `src/data/DataLoader.ts` | Get defender's types for matchup check | Returns `PokemonEntry` with `.types: string[]` |
| `PlayerAction` | `src/types/battleState.ts` | Return type of `pickAction()` | Already the canonical action union type |
| `BattleState`, `BattleSide`, `ActivePokemon` | `src/types/battleState.ts` | Input type for `pickAction()` | Already the full runtime state shape |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `computeDamage()` from DamageCalc | Raw `calculate()` from @smogon/calc | computeDamage already handles status moves (returns 0), Array.isArray guard, and random roll selection. Reuse it. |
| TypeChart damageTaken lookup | Re-implementing type math | The PS typechart encoding (0=neutral, 1=super, 2=resist, 3=immune) is exactly what we need for matchup scoring. Never hand-roll this. |
| Greedy single-turn scoring | MCTS / minimax | Greedy is sufficient for the requirements and runs in microseconds on 4 moves. MCTS is out of scope and slow. |

**Installation:** No new packages. Do not add any.

---

## Architecture Patterns

### Recommended Project Structure

```
src/battle/
├── AIOpponent.ts        # New file: pickAction() singleton
├── BattleEngine.ts      # Existing — unchanged
├── DamageCalc.ts        # Existing — reuse computeDamage()
├── StatusEngine.ts      # Existing — unchanged
├── TurnResolver.ts      # Existing — unchanged
└── TeamGenerator.ts     # Existing — unchanged
```

### Pattern 1: Module-Level Singleton Export

**What:** `AIOpponent` is exported as a `const` object with a `pickAction` method, matching the BattleEngine pattern already in this codebase.

**When to use:** Always — consistent with `BattleEngine`, `DataLoader`, `TeamGenerator`.

```typescript
// Source: matches BattleEngine.ts pattern in this codebase
export const AIOpponent = {
  pickAction(state: BattleState): PlayerAction {
    // ... implementation
  },
} as const;
```

### Pattern 2: Move Scoring via computeDamage()

**What:** For each non-Status move the active opponent Pokemon has with PP remaining, call `computeDamage()` and record the score. Pick the highest. If all moves are Status (score = 0), fall back to first available move with PP.

**When to use:** Always as the first scoring pass.

```typescript
// Source: src/battle/DamageCalc.ts — computeDamage() signature
import { computeDamage } from './DamageCalc.js';

function scoreMoves(
  attacker: ActivePokemon,
  defender: ActivePokemon,
): { moveSlug: string; score: number }[] {
  return attacker.moves
    .filter(m => {
      const maxPP = getMovePP(m);
      const used = attacker.ppUsed[m] ?? 0;
      return used < maxPP; // has PP
    })
    .map(moveSlug => ({
      moveSlug,
      // isCrit=false for AI scoring — use expected (non-crit) damage
      score: computeDamage(attacker, defender, moveSlug, false),
    }));
}
```

**Key insight:** `computeDamage()` already returns 0 for Status-category moves (it checks `moveData.category === "Status"` and returns 0). No special handling needed for status moves in the scoring path.

### Pattern 3: Type Matchup Scoring for Switch Decision

**What:** To decide whether to switch, compute a "matchup score" for the current attacker vs. the opponent's current active. If all of the AI's moves are resisted (damageTaken === 2) or immune (damageTaken === 3) by the defender's types, switch to the best available teammate.

**Typechart encoding (verified from src/data/typechart.json):**
- `0` = neutral (1x)
- `1` = super-effective (2x)
- `2` = resist (0.5x)
- `3` = immune (0x)

**Lookup pattern:** `typechart[defenderType.toLowerCase()].damageTaken[moveType]`

```typescript
// Source: verified from src/types/pokemon.ts TypeChart + src/data/typechart.json actual data
import { DataLoader } from '../data/DataLoader.js';

function getMoveTypeEffectiveness(moveType: string, defenderTypes: string[]): number {
  // damageTaken encoding: 0=1x, 1=2x, 2=0.5x, 3=0x
  const tc = DataLoader.getTypechart();
  let encoded = 0; // neutral by default

  for (const defType of defenderTypes) {
    const entry = tc[defType.toLowerCase()];
    if (!entry) continue;
    // Title-cased move type keys (e.g. "Fire", "Water")
    const val = entry.damageTaken[moveType];
    if (val !== undefined && val > encoded) {
      encoded = val; // take worst resistance (highest encoded value)
    }
  }
  return encoded;
}

function allMovesResisted(
  aiMon: ActivePokemon,
  defender: ActivePokemon,
): boolean {
  const defPokemon = DataLoader.getPokemon(defender.species.toLowerCase());
  const defTypes = defPokemon?.types ?? [];
  const tc = DataLoader.getTypechart();

  return aiMon.moves.every(moveSlug => {
    const used = aiMon.ppUsed[moveSlug] ?? 0;
    const maxPP = getMovePP(moveSlug);
    if (used >= maxPP) return true; // no PP = can't use = treat as resisted

    const moveData = DataLoader.getMove(moveSlug.toLowerCase());
    if (!moveData || moveData.category === 'Status') return true; // status moves = no damage

    const moveType = moveData.type; // e.g. "Electric"
    // Check each defender type
    for (const defType of defTypes) {
      const entry = tc[defType.toLowerCase()];
      if (!entry) continue;
      const val = entry.damageTaken[moveType];
      // val 2 = resist, val 3 = immune
      if (val === 2 || val === 3) continue; // this type resists
      return false; // at least one defender type does NOT resist this move
    }
    return true; // all defender types resist this move
  });
}
```

**IMPORTANT — dual-type interaction:** For a dual-type defender (e.g., Charizard = Fire/Flying), a move is "not resisted" if it is NOT resisted by ALL of the defender's types. The standard interaction is multiplicative. For the AI's purpose (AI-03: switch when resisted), it is safe to use the simplified rule: if any defender type has `damageTaken === 0` (neutral) or `1` (super) for the move type, the move is "not fully resisted."

**Simpler approach that works:** Use `computeDamage()` scores directly. If the best move score is 0 (or extremely low relative to opponent HP), consider switching. This avoids manual typechart lookups entirely.

### Pattern 4: Switch Selection

**What:** When switch is warranted, pick the alive non-active teammate with the best move score against the current defender.

```typescript
// Source: derived from BattleState.BattleSide.team structure
function pickBestSwitch(
  aiSide: BattleSide,
  defender: ActivePokemon,
): number | null {
  let bestScore = -1;
  let bestIndex: number | null = null;

  for (let i = 0; i < aiSide.team.length; i++) {
    if (i === aiSide.activeIndex) continue; // skip current active
    const mon = aiSide.team[i]!;
    if (mon.fainted) continue;

    // Score = max damage this Pokemon can deal to the defender
    const maxScore = Math.max(
      ...mon.moves.map(m => {
        const used = mon.ppUsed[m] ?? 0;
        const maxPP = getMovePP(m);
        if (used >= maxPP) return 0;
        return computeDamage(mon, defender, m, false);
      }),
    );

    if (maxScore > bestScore) {
      bestScore = maxScore;
      bestIndex = i;
    }
  }

  return bestIndex;
}
```

### Pattern 5: Tera Evaluation

**What:** Before committing to the best move, check if using Tera would change a resisted/neutral outcome to super-effective or grant a new STAB bonus. If yes, and `teraUsed === false`, return `TERA_ATTACK` instead of `ATTACK`.

**Approach:** Compute the best move score without Tera. Then compute the same move score with a temporary `teraActive = true` snapshot. If the Tera score is meaningfully higher (or specifically flips a bad matchup per AI-04), use Tera.

```typescript
// Source: DamageCalc.ts pattern — pass a modified ActivePokemon snapshot
function evaluateTeraScore(
  aiMon: ActivePokemon,
  defender: ActivePokemon,
  moveSlug: string,
): number {
  // Construct a temporary "Tera active" version of the Pokemon
  const teraVersion: ActivePokemon = { ...aiMon, teraActive: true };
  return computeDamage(teraVersion, defender, moveSlug, false);
}
```

**Tera trigger conditions (AI-04):**
1. Current move scores are all low (all moves resisted) AND Tera would change the attacker's type to something not resisted
2. The best move score WITH Tera is notably higher than without Tera

**Simplified implementation:** Compute best score without Tera. Compute best score with Tera. If `teraScore > noTeraScore * 1.3` (30% improvement), use Tera. This covers both cases: flipping a resistance and gaining pure STAB.

### Pattern 6: Full pickAction() Decision Flow

```typescript
// Source: synthesis of above patterns + BattleState interface
export const AIOpponent = {
  pickAction(state: BattleState): PlayerAction {
    const aiSide = state.opponentSide;
    const playerSide = state.playerSide;
    const aiMon = aiSide.team[aiSide.activeIndex]!;
    const playerMon = playerSide.team[playerSide.activeIndex]!;

    // 1. Score all legal moves (with PP)
    const moveScores = scoreMoves(aiMon, playerMon);
    const bestMove = moveScores.reduce(
      (best, cur) => (cur.score > best.score ? cur : best),
      { moveSlug: aiMon.moves[0]!, score: -1 },
    );

    // 2. Evaluate Tera (before switch decision — Tera might fix a bad matchup)
    if (!aiSide.teraUsed && moveScores.length > 0) {
      const teraScores = scoreMoves(
        { ...aiMon, teraActive: true },
        playerMon,
      );
      const bestTeraMove = teraScores.reduce(
        (best, cur) => (cur.score > best.score ? cur : best),
        { moveSlug: aiMon.moves[0]!, score: -1 },
      );

      if (bestTeraMove.score > bestMove.score * 1.3 && bestTeraMove.score > 0) {
        return { type: 'TERA_ATTACK', moveSlug: bestTeraMove.moveSlug };
      }
    }

    // 3. Switch if all moves deal 0 or near-0 damage AND alive teammates exist
    const shouldSwitch =
      bestMove.score === 0 &&
      aiSide.team.some((m, i) => i !== aiSide.activeIndex && !m.fainted);

    if (shouldSwitch) {
      const switchIndex = pickBestSwitch(aiSide, playerMon);
      if (switchIndex !== null) {
        return { type: 'SWITCH', toIndex: switchIndex };
      }
    }

    // 4. Attack with best scoring move (or first move with PP if all score 0)
    const moveToUse =
      bestMove.score > 0
        ? bestMove.moveSlug
        : (moveScores[0]?.moveSlug ?? aiMon.moves[0]!);

    return { type: 'ATTACK', moveSlug: moveToUse };
  },
} as const;
```

### Anti-Patterns to Avoid

- **Calling `calculate()` directly in AIOpponent:** Always reuse `computeDamage()` from DamageCalc. It already handles the Status-returns-0 guard, Array.isArray guard, and random roll selection.
- **Using random roll from computeDamage for scoring:** The scoring needs a deterministic/representative value. `computeDamage()` currently returns a random roll from the 16-value bracket. For AI scoring, this introduces noise but is acceptable since all 16 rolls are close (85-100% range). Do not try to extract the "average" — use `computeDamage()` as-is.
- **Mutating BattleState to evaluate Tera:** Never mutate the state. Pass a spread copy `{ ...aiMon, teraActive: true }` to `computeDamage()` for evaluation only.
- **Doing type math manually for scoring:** Use `computeDamage()` scores as the primary scoring signal. The type effectiveness is already baked into the @smogon/calc result. Only use typechart lookups as a fallback (e.g., if computeDamage returns 0 due to status moves only).
- **Blocking the event loop:** The AI must return synchronously. Never use async/await, setTimeout, or worker threads. The computation on 4 moves × 6 Pokemon is sub-millisecond.
- **Picking switch index 0 when current active is 0:** `pickBestSwitch` must skip `i === aiSide.activeIndex`, not just `i === 0`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Damage estimation | Custom formula | `computeDamage()` from DamageCalc.ts | Already handles STAB, Tera, burn, all @smogon/calc edge cases |
| Type effectiveness multiplier | Custom 0x/0.5x/1x/2x/4x logic | `computeDamage()` scores + typechart damageTaken for switch check | @smogon/calc handles dual-type interactions, Tera type override, ability immunities |
| Move legality (PP check) | Extra validation layer | Check `ppUsed[m] < getMovePP(m)` — already the BattleEngine pattern | Consistent with engine; no separate legal-move list needed |
| Opponent intent prediction | Lookahead AI | Not needed — greedy single-turn scoring satisfies all requirements | MCTS/minimax is 100x more complex for no requirement benefit |
| KO probability calculation | Custom HP/damage math | `result.kochance()` from @smogon/calc Result exists but is NOT needed | Damage score alone is sufficient; KO chance is out of requirements scope |

**Key insight:** The AI is not playing optimally — it only needs to satisfy the four behavioral requirements (prefer super-effective, switch when resisted, use Tera when it flips a matchup, be fast). `computeDamage()` scores already encode type effectiveness via @smogon/calc. The entire AI logic can be implemented in ~80 lines.

---

## Common Pitfalls

### Pitfall 1: computeDamage Returns a Random Roll — May Flip Move Selection

**What goes wrong:** The AI calls `computeDamage()` twice for the same attacker/defender/move and gets different results due to the random 85-100% roll selection. This can flip which move is "best" between calls.

**Why it happens:** `computeDamage()` picks `rolls[Math.floor(Math.random() * rolls.length)]` — it's intentionally random for gameplay. The AI reuses it for scoring.

**How to avoid:** Accept the noise — all 16 rolls are within 15% of each other, so the best move by damage will almost never change. In practice the AI will still pick the highest-power super-effective move. If determinism matters, use `result.range()[0]` (min damage) by calling `calculate()` directly in the AI and reading `range()`. But for this phase's requirements, `computeDamage()` as-is is sufficient.

**Warning signs:** AI occasionally picks a weaker move. Acceptable for v0.1 greedy AI.

### Pitfall 2: Tera Evaluation Using computeDamage Changes Game State

**What goes wrong:** Setting `aiMon.teraActive = true` on the real `aiMon` object instead of a copy, then calling `computeDamage()`. This permanently activates Tera on the Pokemon.

**Why it happens:** Forgetting that `ActivePokemon` is a plain object — it's not copy-on-read.

**How to avoid:** Always spread: `computeDamage({ ...aiMon, teraActive: true }, ...)`. Never set `aiMon.teraActive = true` directly.

**Warning signs:** Tera activates visually without a TERA_ATTACK action being returned.

### Pitfall 3: Switch Evaluation Calling computeDamage with Wrong ActivePokemon

**What goes wrong:** When scoring switch candidates, calling `computeDamage(aiMon, playerMon, m, false)` — using the current active instead of the candidate.

**Why it happens:** Copy-paste error from move scoring.

**How to avoid:** In `pickBestSwitch`, use `mon` (the candidate) not `aiMon` (current active): `computeDamage(mon, playerMon, m, false)`.

**Warning signs:** AI always switches to the same Pokemon regardless of typing.

### Pitfall 4: Typechart Lookup Key Casing

**What goes wrong:** `typechart["fire"].damageTaken["fire"]` returns `undefined` instead of the expected value.

**Why it happens:** The typechart keys use lowercase for the type entry (`"fire"`) but Title-case for `damageTaken` keys (`"Fire"`). Verified from actual data.

**How to avoid:**
- Type entry lookup: `tc[defType.toLowerCase()]` — lowercase
- damageTaken key: `entry.damageTaken[moveType]` where `moveType` is Title-cased (as stored in `MoveEntry.type`, e.g. `"Electric"`, `"Water"`)

**Warning signs:** All type lookups returning 0 (neutral) even for known immunities.

### Pitfall 5: All Moves Have Status Category — Infinite Switch Loop

**What goes wrong:** If the AI's active Pokemon only has Status-category moves (no damaging moves), `computeDamage()` returns 0 for all of them. The AI decides to switch. The switched-in Pokemon also only has Status moves. The AI switches again. Infinite loop across turns.

**Why it happens:** Edge case in random battle sets — some Pokemon have 1-2 utility moves only.

**How to avoid:** The switch decision must be `bestMove.score === 0 AND all moves are Status category` — not just `bestMove.score === 0`. If a Pokemon has damaging moves that happen to deal 0 due to immunity, the AI should still try to attack (BattleEngine will log a 0-damage hit). Only switch when ALL moves are genuinely non-damaging.

**Simpler fix:** Set a switch threshold: only switch if `bestMove.score === 0` AND the AI has alive non-active teammates AND the current move count with PP > 0 equals the count with `category === "Status"`.

**Warning signs:** AI switches every turn without attacking.

### Pitfall 6: Scoring Fainted Pokemon as Switch Candidates

**What goes wrong:** `pickBestSwitch` iterates the team and scores a fainted Pokemon, selecting it as the best switch.

**Why it happens:** Forgetting the `!mon.fainted` check.

**How to avoid:** `if (mon.fainted) continue;` inside the loop. Also check `i !== aiSide.activeIndex`.

**Warning signs:** BattleEngine.submitSwitch() throws `"Cannot switch to fainted Pokemon at index N"`.

### Pitfall 7: Using `species` vs `calcSpecies` for Typechart Lookup

**What goes wrong:** `DataLoader.getPokemon(aiMon.species.toLowerCase())` fails for cosmetic formes (e.g., `"Gastrodon-East"`) because the pokedex entry is stored under `"gastrodon"`.

**Why it happens:** `BattlePokemon.species` is the exact forme name from @pkmn/randoms, which can include suffixes. `calcSpecies` strips these for @smogon/calc. But `DataLoader.getPokemon()` expects base species slugs.

**How to avoid:** For type lookups, use `DataLoader.getPokemon(aiMon.calcSpecies.toLowerCase())` or strip the forme suffix manually. Better: use `aiMon.calcSpecies` which is already normalized for pokedex lookup (per the `BattlePokemon` docstring: "For cosmetic formes this is baseSpecies").

**Warning signs:** `getPokemon()` returns `undefined` for Pokemon with forme suffixes (Gastrodon-East, Toxtricity-Low-Key, etc.).

---

## Code Examples

### Complete AIOpponent.pickAction() Skeleton

```typescript
// Source: synthesis from DamageCalc.ts, BattleEngine.ts patterns, DataLoader.ts
import type { ActivePokemon, BattleSide, BattleState, PlayerAction } from '../types/battleState.js';
import { computeDamage } from './DamageCalc.js';
import { getMovePP } from './DamageCalc.js';
import { DataLoader } from '../data/DataLoader.js';

// Score all moves with remaining PP. Returns array sorted by score descending.
function scoreMoves(
  attacker: ActivePokemon,
  defender: ActivePokemon,
): { moveSlug: string; score: number }[] {
  return attacker.moves
    .filter(m => (attacker.ppUsed[m] ?? 0) < getMovePP(m))
    .map(moveSlug => ({
      moveSlug,
      score: computeDamage(attacker, defender, moveSlug, false),
    }))
    .sort((a, b) => b.score - a.score);
}

// Find the best switch target by max move damage score
function pickBestSwitch(
  aiSide: BattleSide,
  defender: ActivePokemon,
): number | null {
  let bestScore = -1;
  let bestIndex: number | null = null;

  for (let i = 0; i < aiSide.team.length; i++) {
    if (i === aiSide.activeIndex) continue;
    const candidate = aiSide.team[i]!;
    if (candidate.fainted) continue;

    const scores = scoreMoves(candidate, defender);
    const topScore = scores[0]?.score ?? 0;

    if (topScore > bestScore) {
      bestScore = topScore;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export const AIOpponent = {
  pickAction(state: BattleState): PlayerAction {
    const aiSide = state.opponentSide;
    const playerMon = state.playerSide.team[state.playerSide.activeIndex]!;
    const aiMon = aiSide.team[aiSide.activeIndex]!;

    // 1. Score moves without Tera
    const moveScores = scoreMoves(aiMon, playerMon);
    const bestNoTera = moveScores[0] ?? { moveSlug: aiMon.moves[0]!, score: 0 };

    // 2. Evaluate Tera — only if not yet used
    if (!aiSide.teraUsed) {
      const teraScores = scoreMoves({ ...aiMon, teraActive: true }, playerMon);
      const bestTera = teraScores[0] ?? { moveSlug: aiMon.moves[0]!, score: 0 };

      if (bestTera.score > 0 && bestTera.score > bestNoTera.score * 1.3) {
        return { type: 'TERA_ATTACK', moveSlug: bestTera.moveSlug };
      }
    }

    // 3. Switch if all damaging moves deal 0 (resisted / immune / no PP)
    const hasAliveTeammate = aiSide.team.some(
      (m, i) => i !== aiSide.activeIndex && !m.fainted,
    );
    const allMovesNonDamaging = aiMon.moves.every(m => {
      const moveData = DataLoader.getMove(m.toLowerCase());
      return !moveData || moveData.category === 'Status';
    });
    const shouldSwitch = bestNoTera.score === 0 && !allMovesNonDamaging === false
      ? false  // all status moves — don't switch (use status move instead)
      : bestNoTera.score === 0 && hasAliveTeammate;

    // Cleaner version of shouldSwitch logic (same result):
    // switch when best damage score = 0 AND not all-status-moves AND has teammates
    const allDamagingMoveScores = moveScores.filter(ms => {
      const md = DataLoader.getMove(ms.moveSlug.toLowerCase());
      return md && md.category !== 'Status';
    });
    const reallyNoDamage = allDamagingMoveScores.length === 0
      || allDamagingMoveScores.every(ms => ms.score === 0);

    if (reallyNoDamage && hasAliveTeammate) {
      const switchIndex = pickBestSwitch(aiSide, playerMon);
      if (switchIndex !== null) {
        return { type: 'SWITCH', toIndex: switchIndex };
      }
    }

    // 4. Attack with best scoring move
    return { type: 'ATTACK', moveSlug: bestNoTera.moveSlug };
  },
} as const;
```

### Type Effectiveness Lookup (for diagnostic / logging only)

```typescript
// Source: verified from src/data/typechart.json actual encoding
// Use only when you need to display type info to user — NOT for AI damage scoring
// (computeDamage already handles type effectiveness internally)

function getTypeEffectivenessLabel(moveType: string, defenderTypes: string[]): string {
  const tc = DataLoader.getTypechart();
  let totalEncoded = 0; // accumulate: multiple 1s = 2x per type

  for (const defType of defenderTypes) {
    const entry = tc[defType.toLowerCase()];
    if (!entry) continue;
    const val = entry.damageTaken[moveType]; // Title-cased key e.g. "Fire"
    if (val === 3) return 'immune';           // 0x
    if (val !== undefined) totalEncoded += val;
  }

  if (totalEncoded >= 2) return 'super-effective';
  if (totalEncoded === 1 && defenderTypes.length === 1) return 'super-effective';
  if (totalEncoded === 0) return 'neutral';
  return 'resist';
}
```

### Reusing computeDamage for Tera Evaluation (Verified Pattern)

```typescript
// Source: verified from DamageCalc.ts computeDamage() — teraActive controls teraType pass-through
// The key: CalcPokemon receives teraType only when teraActive === true (line 67 in DamageCalc.ts)
//   teraType: attacker.teraActive ? (attacker.teraType as any) : undefined,
// So spreading { ...aiMon, teraActive: true } is sufficient — teraType is already on aiMon

const teraSnapshot: ActivePokemon = { ...aiMon, teraActive: true };
const teraScore = computeDamage(teraSnapshot, playerMon, moveSlug, false);
// teraScore reflects STAB boost from teraType without modifying actual state
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled type chart lookup | Use computeDamage() output | This project | Type math is handled by @smogon/calc |
| Random move selection | Greedy damage scoring | This phase | Satisfies AI-01 and AI-02 requirements |
| No switch logic | Switch when all moves score 0 | This phase | Satisfies AI-03 requirement |
| No Tera evaluation | Compute score with/without Tera | This phase | Satisfies AI-04 requirement |

**Not needed in this phase:**
- Speed scoring for which move goes first (BattleEngine handles turn order)
- OHKO detection (computeDamage score reflects damage magnitude)
- Multi-turn move evaluation (out of scope)
- Hazard setting / setup moves as AI strategy (out of scope)

---

## Open Questions

1. **computeDamage returns a random roll — does the 15% variance affect requirement compliance?**
   - What we know: The 16 rolls span 85-100% of the base damage. A 2x move against a 1x move will have the 2x score > 1x score even at minimum roll (0.85 * 2x > 1.0 * 1x for any base power). The variance does not affect which move is "better" in practice.
   - What's unclear: Edge case where two moves have similar base power and the random roll flips which scores higher.
   - Recommendation: Use `computeDamage()` as-is. The requirements say "prefers super-effective over neutral" — the 2x multiplier ensures super-effective always scores higher by a wide margin. The random roll cannot flip this.

2. **Should the AI score its own survival (defensive matchup) or only offensive output?**
   - What we know: Requirements AI-01 through AI-04 are purely offensive. No requirement mentions defensive AI behavior.
   - What's unclear: Whether "switches when resisted" (AI-03) should also consider how much damage the opponent deals to the AI.
   - Recommendation: Implement offensive scoring only (maximize damage dealt). AI-03 is satisfied by "all moves score 0 → switch." Do not add defensive scoring.

3. **Tera threshold: what multiplier triggers Tera?**
   - What we know: AI-04 says "when it would flip a bad matchup or grant STAB on an otherwise neutral move." A 30% improvement threshold (`teraScore > noTeraScore * 1.3`) approximates this.
   - What's unclear: Whether `1.3` is the right threshold. Too low = Tera used trivially. Too high = Tera never used.
   - Recommendation: Use `1.3` (30% improvement) as the initial threshold. If tests show Tera never fires, lower to `1.1`. If Tera fires too aggressively, raise to `1.5`.

4. **Which species name to use for DataLoader.getPokemon() lookup?**
   - What we know: `BattlePokemon.calcSpecies` is documented as "Name safe for @smogon/calc constructor. For cosmetic formes this is baseSpecies." It is already normalized.
   - What's unclear: Whether `calcSpecies` is lowercase or Title-cased.
   - Recommendation: Always call `.toLowerCase()` on `calcSpecies` before `DataLoader.getPokemon()`. Confirmed: DataLoader uses lowercase slug keys throughout.

---

## Sources

### Primary (HIGH confidence)

- `src/battle/DamageCalc.ts` — `computeDamage()` signature and implementation, confirmed teraActive controls teraType pass-through to @smogon/calc
- `src/battle/BattleEngine.ts` — module singleton pattern, PlayerAction handling, BattleState mutation pattern
- `src/types/battleState.ts` — `BattleState`, `BattleSide`, `ActivePokemon`, `PlayerAction` type definitions
- `src/types/battle.ts` — `BattlePokemon` shape including `calcSpecies` and `teraType` fields
- `src/data/DataLoader.ts` — `getPokemon()`, `getMove()`, `getTypechart()` method signatures
- `src/types/pokemon.ts` — `TypeChart`, `TypeEntry`, `MoveEntry` interfaces with damageTaken encoding documented
- `src/data/typechart.json` — Verified actual encoding: lowercase type keys, Title-cased damageTaken sub-keys, values 0/1/2/3
- `src/data/moves.json` — Verified `MoveEntry.type` is Title-cased (e.g., "Electric", "Water")
- `node_modules/@smogon/calc/dist/result.d.ts` — `Result.range()` and `Result.kochance()` signatures confirmed

### Secondary (MEDIUM confidence)

- `src/data/pokedex.json` — Verified `PokemonEntry.types` is array of Title-cased type strings (e.g., `["Fire", "Flying"]`)
- Phase 3 RESEARCH.md — Confirmed @smogon/calc patterns, computeDamage() behavior, teraType mechanics

### Tertiary (LOW confidence)

- None required — all findings verified from codebase directly

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all modules verified from actual source files
- Architecture: HIGH — follows existing BattleEngine and DamageCalc patterns from codebase
- Type effectiveness lookups: HIGH — verified from actual typechart.json data and TypeChart interface
- Tera threshold (1.3x): LOW — heuristic; needs testing to validate
- Pitfalls: HIGH — all verified from actual source code behavior

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (stable — battle engine types change slowly; @smogon/calc 0.10.x is stable)
