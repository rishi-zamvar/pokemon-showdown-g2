/**
 * SimAIOpponent — module singleton that picks opponent actions by reading
 * the live @pkmn/sim Battle's activeRequest on side[1].
 *
 * This replaces AIOpponent.ts which used @smogon/calc for damage scoring.
 * The sim's ChoiceRequest already tells us which moves are legal (non-disabled,
 * have PP), so we just pick randomly from legal options — matching PS's
 * built-in RandomPlayerAI approach.
 *
 * Design rules:
 *   - Reads from battle.sides[1].activeRequest — never writes to battle
 *   - No damage estimation, no @smogon/calc, no DataLoader
 *   - Fully synchronous — no async/await, no streams
 *   - Uses (request as any) narrowing because ChoiceRequest union types are
 *     not always exported in a convenient form from @pkmn/sim
 */

import type { Battle } from '@pkmn/sim';
import type { PlayerAction } from '../types/battleState.js';

// ---------------------------------------------------------------------------
// Exported singleton
// ---------------------------------------------------------------------------

export const SimAIOpponent = {
  /**
   * Pick an action for the opponent side (sides[1]) based on the sim's
   * activeRequest. Returns a PlayerAction compatible with SimBattleAdapter's
   * actionToChoice translation.
   *
   * Handles three request types:
   *   - WaitRequest: return struggle fallback
   *   - SwitchRequest (forceSwitch): find first alive non-active pokemon
   *   - MoveRequest: pick random non-disabled move with PP
   */
  pickAction(battle: Battle): PlayerAction {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const request = battle.sides[1]!.activeRequest as any;

    // 1. No request or wait request — return Struggle fallback
    //    The sim converts "move struggle" to Struggle automatically when needed.
    if (!request || request.wait) {
      return { type: 'ATTACK', moveSlug: 'struggle' };
    }

    // 2. Force switch — a pokemon fainted and we must switch in a replacement
    if (request.forceSwitch) {
      return { type: 'SWITCH', toIndex: _pickForceSwitchIndex(request) };
    }

    // 3. Normal move request
    if (request.active?.[0]) {
      const activeData = request.active[0] as {
        moves: {
          move: string;
          id: string;
          pp?: number;
          maxpp?: number;
          disabled?: string | boolean;
          target?: string;
        }[];
        canTerastallize?: string;
      };

      // Filter to legal moves: not disabled, and have PP (pp > 0 if present)
      const legalMoves = activeData.moves.filter(m => {
        if (m.disabled) return false;
        // pp field may not always be present — treat undefined as "has pp"
        if (m.pp !== undefined && m.pp <= 0) return false;
        return true;
      });

      // If no legal moves, fall back to Struggle
      if (legalMoves.length === 0) {
        return { type: 'ATTACK', moveSlug: 'struggle' };
      }

      // Random selection among legal moves
      const selected = legalMoves[Math.floor(Math.random() * legalMoves.length)]!;
      const moveSlug = selected.id; // id is already the lowercase slug

      // Tera consideration: ~20% chance when canTerastallize is available
      if (activeData.canTerastallize && Math.random() < 0.2) {
        return { type: 'TERA_ATTACK', moveSlug };
      }

      return { type: 'ATTACK', moveSlug };
    }

    // Fallback for unrecognised request shapes
    return { type: 'ATTACK', moveSlug: 'struggle' };
  },

  /**
   * Pick a forced switch index for the opponent side independently.
   * Used by ScreenController when a forced switch is needed outside of
   * pickAction (e.g. post-faint resolution on the opponent's side).
   *
   * Returns a 0-based team index of the first alive non-active pokemon.
   */
  pickSwitch(battle: Battle): number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const request = battle.sides[1]!.activeRequest as any;

    if (request?.forceSwitch) {
      return _pickForceSwitchIndex(request);
    }

    // No forceSwitch in request — fall back to scanning the side's pokemon list
    const side = battle.sides[1]!;
    for (let i = 0; i < side.pokemon.length; i++) {
      const mon = side.pokemon[i];
      if (!mon) continue;
      // Skip the currently active slot (position 0 in @pkmn/sim)
      if (i === 0) continue;
      // Skip fainted pokemon (hp === 0)
      if (mon.hp <= 0) continue;
      return i;
    }

    // Ultimate fallback — return index 1 (second slot)
    return 1;
  },
} as const;

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Given a SwitchRequest, find the first alive non-active team slot index.
 * The request.side.pokemon array matches team order; slots covered by
 * forceSwitch[i] are the active pokemon slots we skip.
 *
 * @pkmn/sim SwitchRequest shape:
 *   forceSwitch: boolean[]  — length = number of active slots (usually 1)
 *   side.pokemon: PokemonSwitchRequestData[]  — full team in order
 */
function _pickForceSwitchIndex(request: {
  forceSwitch: boolean[];
  side: { pokemon: { condition: string; active: boolean }[] };
}): number {
  const pokemon = request.side.pokemon;
  const activeSlotCount = request.forceSwitch.length;

  for (let i = 0; i < pokemon.length; i++) {
    // Skip the active slot(s)
    if (i < activeSlotCount) continue;
    const mon = pokemon[i];
    if (!mon) continue;
    // Fainted pokemon have condition ending with ' fnt'
    if (mon.condition.endsWith(' fnt')) continue;
    return i;
  }

  // Fallback to slot 1 if all non-active are fainted (shouldn't happen in practice)
  return 1;
}
