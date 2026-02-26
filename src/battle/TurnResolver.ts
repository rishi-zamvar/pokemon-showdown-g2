/**
 * TurnResolver — determines action execution order for a battle turn.
 *
 * Resolution priority (Gen 9 rules):
 *   1. Switches always resolve before attacks
 *   2. If both attack: higher move priority goes first
 *   3. Same move priority: higher Speed stat goes first
 *   4. Speed tie: random 50/50 coin flip
 *
 * Note: In Gen 9, paralysis does NOT reduce Speed (it only has a 25% chance
 * of full paralysis). Speed comparison uses raw stats.spe.
 */

import type { ActivePokemon, PlayerAction } from "../types/battleState.js";
import { DataLoader } from "../data/DataLoader.js";

// ---------------------------------------------------------------------------
// Exported resolver
// ---------------------------------------------------------------------------

/**
 * Determine the order in which two players' actions execute this turn.
 *
 * @returns An array of 1 or 2 actor keys in execution order.
 *          Usually ['player', 'opponent'] or ['opponent', 'player'].
 */
export function resolveTurnOrder(
  playerAction: PlayerAction,
  opponentAction: PlayerAction,
  playerActive: ActivePokemon,
  opponentActive: ActivePokemon,
): ("player" | "opponent")[] {
  const playerIsSwitch = playerAction.type === "SWITCH";
  const opponentIsSwitch = opponentAction.type === "SWITCH";

  // Rule 1: Switches always resolve before attacks
  if (playerIsSwitch && opponentIsSwitch) {
    return ["player", "opponent"];
  }
  if (playerIsSwitch) {
    return ["player", "opponent"];
  }
  if (opponentIsSwitch) {
    return ["opponent", "player"];
  }

  // Both are attacking (ATTACK or TERA_ATTACK) — compare move priority
  const playerMoveSlug = getMoveSlug(playerAction);
  const opponentMoveSlug = getMoveSlug(opponentAction);

  const playerPriority = DataLoader.getMove(playerMoveSlug)?.priority ?? 0;
  const opponentPriority = DataLoader.getMove(opponentMoveSlug)?.priority ?? 0;

  // Rule 2: Higher move priority goes first
  if (playerPriority > opponentPriority) {
    return ["player", "opponent"];
  }
  if (opponentPriority > playerPriority) {
    return ["opponent", "player"];
  }

  // Rule 3: Same priority — compare Speed (raw stat, paralysis does NOT reduce in Gen 9)
  if (playerActive.stats.spe > opponentActive.stats.spe) {
    return ["player", "opponent"];
  }
  if (opponentActive.stats.spe > playerActive.stats.spe) {
    return ["opponent", "player"];
  }

  // Rule 4: Speed tie — random coin flip
  return Math.random() < 0.5
    ? ["player", "opponent"]
    : ["opponent", "player"];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getMoveSlug(action: PlayerAction): string {
  if (action.type === "ATTACK" || action.type === "TERA_ATTACK") {
    return action.moveSlug;
  }
  return "";
}
