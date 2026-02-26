/**
 * StatusEngine — status condition logic for Gen 9 battles.
 *
 * Exports:
 *   applyEndOfTurnStatus() — burn/poison/toxic damage, sleep wake-up at end of turn
 *   checkMoveBlock()       — paralysis skip, sleep block, freeze thaw check before attack
 *   inflictSleep()         — set sleep status with 2-4 turn duration (rolled at inflict time)
 *   resetToxicOnSwitchIn() — reset toxic counter to 1 on switch-in (Gen 9 behavior)
 *
 * Design rules:
 *   - Burn physical halving is handled by @smogon/calc via status field — NOT here
 *   - Paralysis does NOT reduce speed in Gen 9 — only 25% full paralysis
 *   - Minimum 1 HP damage for all status ticks (burn, poison, toxic)
 *   - Toxic counter increments AFTER damage calc (first tick at counter=1 = 1/16)
 *   - Sleep turns decremented at move attempt time, not end of turn
 *   - Sleep duration rolled at inflict time (Pitfall 6), not per-turn
 *   - Toxic counter resets to 1 on switch-in (Pitfall 7), not 0
 */

import type { ActivePokemon, TurnLogEntry } from "../types/battleState.js";

// ---------------------------------------------------------------------------
// applyEndOfTurnStatus — end-of-turn damage and state changes
// ---------------------------------------------------------------------------

/**
 * Apply end-of-turn status effects to a Pokemon.
 *
 * | Status | Damage                                      | Other                              |
 * |--------|---------------------------------------------|------------------------------------|
 * | brn    | max(1, floor(maxHp / 16))                   | None                               |
 * | psn    | max(1, floor(maxHp / 8))                    | None                               |
 * | tox    | max(1, floor(maxHp * toxicCounter / 16))    | Increment toxicCounter after calc  |
 * | slp    | 0                                           | Decrement sleepTurns; wake if 0    |
 * | frz    | 0                                           | No end-of-turn effect              |
 * | par    | 0                                           | No end-of-turn effect              |
 * | ''     | 0                                           | No status                          |
 */
export function applyEndOfTurnStatus(
  pokemon: ActivePokemon,
  actor: "player" | "opponent",
): { newPokemon: ActivePokemon; damage: number; log: TurnLogEntry[] } {
  const log: TurnLogEntry[] = [];
  let damage = 0;
  let updates: Partial<ActivePokemon> = {};

  switch (pokemon.status) {
    case "brn": {
      damage = Math.max(1, Math.floor(pokemon.stats.hp / 16));
      log.push({
        kind: "STATUS_TICK",
        actor,
        detail: { status: "brn", damage, pokemon: pokemon.name },
      });
      break;
    }

    case "psn": {
      damage = Math.max(1, Math.floor(pokemon.stats.hp / 8));
      log.push({
        kind: "STATUS_TICK",
        actor,
        detail: { status: "psn", damage, pokemon: pokemon.name },
      });
      break;
    }

    case "tox": {
      damage = Math.max(
        1,
        Math.floor((pokemon.stats.hp * pokemon.toxicCounter) / 16),
      );
      // Increment counter AFTER computing damage
      updates = { toxicCounter: pokemon.toxicCounter + 1 };
      log.push({
        kind: "STATUS_TICK",
        actor,
        detail: {
          status: "tox",
          damage,
          toxicCounter: pokemon.toxicCounter,
          pokemon: pokemon.name,
        },
      });
      break;
    }

    case "slp": {
      // Sleep: decrement turns, wake up if 0 (no damage)
      const newTurns = pokemon.sleepTurns - 1;
      if (newTurns <= 0) {
        updates = { sleepTurns: 0, status: "" as const };
        log.push({
          kind: "STATUS_TICK",
          actor,
          detail: { status: "slp", event: "wake", pokemon: pokemon.name },
        });
      } else {
        updates = { sleepTurns: newTurns };
      }
      break;
    }

    case "frz":
    case "par":
    case "":
      // No end-of-turn effect
      break;
  }

  // Apply damage
  const newHp = Math.max(0, pokemon.currentHp - damage);
  const fainted = newHp === 0;

  const newPokemon: ActivePokemon = {
    ...pokemon,
    ...updates,
    currentHp: newHp,
    fainted,
  };

  return { newPokemon, damage, log };
}

// ---------------------------------------------------------------------------
// checkMoveBlock — pre-attack status checks
// ---------------------------------------------------------------------------

/**
 * Check if a status condition prevents the Pokemon from moving this turn.
 *
 * Called BEFORE attack resolution. Returns whether the move is blocked,
 * an updated Pokemon (sleep turns decremented, freeze potentially thawed),
 * and an optional log entry.
 *
 * | Status | Check                     | If blocked                                   |
 * |--------|---------------------------|----------------------------------------------|
 * | par    | 25% random chance         | blocked=true, PARALYSIS_SKIP                 |
 * | slp    | sleepTurns > 0            | blocked=true, ASLEEP. Decrement sleepTurns.  |
 * | frz    | 80% stay frozen           | blocked=true, FROZEN. 20% thaw → unblocked.  |
 */
export function checkMoveBlock(
  pokemon: ActivePokemon,
  actor: "player" | "opponent",
): {
  blocked: boolean;
  newPokemon: ActivePokemon;
  logEntry: TurnLogEntry | null;
} {
  switch (pokemon.status) {
    case "par": {
      if (Math.random() < 0.25) {
        return {
          blocked: true,
          newPokemon: pokemon,
          logEntry: {
            kind: "PARALYSIS_SKIP",
            actor,
            detail: { pokemon: pokemon.name },
          },
        };
      }
      return { blocked: false, newPokemon: pokemon, logEntry: null };
    }

    case "slp": {
      if (pokemon.sleepTurns > 0) {
        const newTurns = pokemon.sleepTurns - 1;
        const newStatus = newTurns <= 0 ? ("" as const) : ("slp" as const);
        const newPokemon: ActivePokemon = {
          ...pokemon,
          sleepTurns: newTurns,
          status: newStatus,
        };
        // Even if sleepTurns reaches 0, the Pokemon is still blocked THIS turn
        return {
          blocked: true,
          newPokemon,
          logEntry: {
            kind: "ASLEEP",
            actor,
            detail: {
              pokemon: pokemon.name,
              turnsLeft: newTurns,
              waking: newTurns <= 0,
            },
          },
        };
      }
      // sleepTurns is 0 — not asleep (shouldn't happen if status is 'slp', but handle gracefully)
      return { blocked: false, newPokemon: pokemon, logEntry: null };
    }

    case "frz": {
      // 20% chance to thaw
      if (Math.random() < 0.2) {
        const newPokemon: ActivePokemon = {
          ...pokemon,
          status: "" as const,
        };
        return {
          blocked: false,
          newPokemon,
          logEntry: {
            kind: "STATUS_TICK",
            actor,
            detail: { status: "frz", event: "thaw", pokemon: pokemon.name },
          },
        };
      }
      return {
        blocked: true,
        newPokemon: pokemon,
        logEntry: {
          kind: "FROZEN",
          actor,
          detail: { pokemon: pokemon.name },
        },
      };
    }

    // brn, psn, tox, '' — no move block
    default:
      return { blocked: false, newPokemon: pokemon, logEntry: null };
  }
}

// ---------------------------------------------------------------------------
// inflictSleep — set sleep status with random duration
// ---------------------------------------------------------------------------

/**
 * Inflict sleep on a Pokemon. Duration is 2-4 turns, rolled at inflict time.
 * (Pitfall 6: duration is NOT rolled each turn.)
 */
export function inflictSleep(pokemon: ActivePokemon): ActivePokemon {
  return {
    ...pokemon,
    status: "slp" as const,
    sleepTurns: 2 + Math.floor(Math.random() * 3), // 2, 3, or 4
  };
}

// ---------------------------------------------------------------------------
// resetToxicOnSwitchIn — reset toxic counter on switch-in
// ---------------------------------------------------------------------------

/**
 * Reset the toxic counter to 1 when a Pokemon with toxic switches in.
 * (Pitfall 7: counter resets to 1, not 0.)
 */
export function resetToxicOnSwitchIn(pokemon: ActivePokemon): ActivePokemon {
  if (pokemon.status !== "tox") {
    return pokemon;
  }
  return {
    ...pokemon,
    toxicCounter: 1,
  };
}
