/**
 * AIOpponent — module singleton that picks the best action for the opponent
 * side of a BattleState.
 *
 * Decision flow (in order):
 *   1. Score all legal moves via computeDamage()
 *   2. Evaluate Tera: if score improves by 30%+ and Tera not yet used, return TERA_ATTACK
 *   3. Switch: if all damaging moves score 0 AND alive teammates exist, switch to best matchup
 *   4. Attack: return the highest-scoring move (or first move with PP if all score 0)
 *
 * Design rules:
 *   - Fully synchronous — no async/await, no network calls
 *   - NEVER mutates BattleState — Tera eval uses a spread copy
 *   - Uses computeDamage() exclusively for damage estimation
 *   - Follows module-level singleton pattern (matching BattleEngine pattern)
 */

import type {
  ActivePokemon,
  BattleSide,
  BattleState,
  PlayerAction,
} from "../types/battleState.js";
import { computeDamage, getMovePP } from "./DamageCalc.js";
import { DataLoader } from "../data/DataLoader.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Score all moves with remaining PP for attacker vs. defender.
 * Returns array sorted descending by score.
 * Status moves score 0 (computeDamage returns 0 for them — no special case needed).
 */
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

/**
 * Find the best switch target (alive, non-active teammate) by max move damage
 * score against the defender. Returns the team index or null if none available.
 */
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

    // Score: max damage this candidate can deal to the defender
    const scores = scoreMoves(candidate, defender);
    const topScore = scores[0]?.score ?? 0;

    if (topScore > bestScore) {
      bestScore = topScore;
      bestIndex = i;
    }
  }

  return bestIndex;
}

// ---------------------------------------------------------------------------
// Exported singleton
// ---------------------------------------------------------------------------

export const AIOpponent = {
  /**
   * Pick the best action for the opponent side given the current BattleState.
   * Returns a PlayerAction synchronously — safe to call on every turn.
   */
  pickAction(state: BattleState): PlayerAction {
    const aiSide = state.opponentSide;
    const aiMon = aiSide.team[aiSide.activeIndex]!;
    const playerMon = state.playerSide.team[state.playerSide.activeIndex]!;

    // 1. Score all legal moves without Tera
    const moveScores = scoreMoves(aiMon, playerMon);
    const bestNoTera = moveScores[0] ?? { moveSlug: aiMon.moves[0]!, score: 0 };

    // 2. Evaluate Tera — only if not yet used this battle
    if (!aiSide.teraUsed && moveScores.length > 0) {
      // CRITICAL: spread copy — NEVER mutate aiMon directly
      const teraScores = scoreMoves({ ...aiMon, teraActive: true }, playerMon);
      const bestTera = teraScores[0] ?? { moveSlug: aiMon.moves[0]!, score: 0 };

      if (bestTera.score > 0 && bestTera.score > bestNoTera.score * 1.3) {
        return { type: "TERA_ATTACK", moveSlug: bestTera.moveSlug };
      }
    }

    // 3. Switch when all damaging moves score 0 AND alive teammates exist
    //    (Don't switch if all moves are Status — use the status move instead)
    const hasAliveTeammate = aiSide.team.some(
      (m, i) => i !== aiSide.activeIndex && !m.fainted,
    );

    const damagingMoveScores = moveScores.filter(ms => {
      const md = DataLoader.getMove(ms.moveSlug.toLowerCase());
      return md !== undefined && md.category !== "Status";
    });

    // reallyNoDamage: has damaging moves but all score 0 (immune / fully resisted)
    const reallyNoDamage =
      damagingMoveScores.length > 0 &&
      damagingMoveScores.every(ms => ms.score === 0);

    if (reallyNoDamage && hasAliveTeammate) {
      const switchIndex = pickBestSwitch(aiSide, playerMon);
      if (switchIndex !== null) {
        return { type: "SWITCH", toIndex: switchIndex };
      }
    }

    // 4. Attack with the highest-scoring move
    //    Fall back to first move with PP if everything scores 0 (e.g. all-Status set)
    return { type: "ATTACK", moveSlug: bestNoTera.moveSlug };
  },
} as const;
