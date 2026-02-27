/**
 * LogParser — converts raw PS protocol lines into TurnLogEntry[].
 *
 * Takes the raw PS protocol lines collected from the Battle's `send` callback
 * and converts them into the existing TurnLogEntry[] format consumed by
 * AnimationEngine and turnResultRenderer.
 *
 * Design:
 *   - Stateless across turns — only tracks pendingMoveActor/pendingMoveName
 *     within a single parse call.
 *   - HP values from log strings are NOT used for state derivation — that is
 *     SimBattleAdapter's job reading from pokemon.hp/maxhp directly. HP values
 *     in log lines are only used for targetHp/targetMaxHp detail fields in
 *     DAMAGE entries (used by AnimationEngine for HP drain animation).
 *   - PP_OUT is NOT emitted here — the sim does not produce a protocol line for
 *     PP depletion. PP tracking is handled by SimBattleAdapter via moveSlots.
 */

import type { TurnLogEntry } from "../types/battleState.js";

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Determine actor from a PS Pokemon identifier.
 * Identifier format: "p1a: Pikachu" or "p2a: Pikachu"
 * Returns 'player' if starts with 'p1', else 'opponent'.
 */
function pokemonToActor(ident: string): "player" | "opponent" {
  return ident.startsWith("p1") ? "player" : "opponent";
}

/**
 * Extract the Pokemon name from a PS identifier.
 * "p1a: Pikachu" → "Pikachu"
 * "p2: Charizard" → "Charizard"
 */
function extractName(ident: string): string {
  const colonIdx = ident.indexOf(": ");
  return colonIdx >= 0 ? ident.slice(colonIdx + 2) : ident;
}

/**
 * Parse HP string "CUR/MAX" or "CUR/MAX STATUS" into { cur, max }.
 * Returns { cur: 0, max: 1 } as fallback if parsing fails.
 * Note: In gen9randombattle with HP Percentage Mod, opponent HP is reported
 * as percentages (e.g., "54/100"). We use these only for animation — actual
 * HP state is read from sim fields directly.
 */
function parseHp(hpStr: string): { cur: number; max: number } {
  // Strip status suffix (e.g., "156/220 brn" → "156/220")
  const noStatus = hpStr.split(" ")[0] ?? "";
  const parts = noStatus.split("/");
  const cur = parseInt(parts[0] ?? "0", 10);
  const max = parseInt(parts[1] ?? "1", 10);
  if (isNaN(cur) || isNaN(max)) return { cur: 0, max: 1 };
  return { cur, max };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse an array of PS protocol lines into TurnLogEntry[].
 *
 * Each line starts with `|` and has `|`-delimited fields.
 * Split on `|` — index 0 is empty, index 1 is the command.
 */
export function parseLogLines(lines: string[]): TurnLogEntry[] {
  const entries: TurnLogEntry[] = [];
  let pendingMoveActor: "player" | "opponent" | null = null;
  let pendingMoveName: string | null = null;
  let pendingCrit = false;

  for (const line of lines) {
    if (!line.startsWith("|")) continue;

    const parts = line.split("|");
    // parts[0] is empty (before first |), parts[1] is the command
    const cmd = parts[1] ?? "";

    switch (cmd) {
      case "move": {
        // |move|POKEMON|MOVE|TARGET
        // Set pending actor/name — do NOT emit a log entry yet (wait for damage/miss)
        const pokemonIdent = parts[2] ?? "";
        pendingMoveActor = pokemonToActor(pokemonIdent);
        pendingMoveName = parts[3] ?? "";
        break;
      }

      case "-damage": {
        // |‐damage|POKEMON|HP_STATUS
        // |‐damage|POKEMON|HP_STATUS|[from] ...
        const targetIdent = parts[2] ?? "";
        const hpStatus = parts[3] ?? "";
        const fromTag = parts[4] ?? "";

        const { cur, max } = parseHp(hpStatus);

        // Check if this is a residual damage (status tick, hazards, recoil)
        const isResidual = fromTag.startsWith("[from]");
        const fromStr = fromTag.toLowerCase();
        const isStatusTick =
          isResidual &&
          (fromStr.includes("brn") ||
            fromStr.includes("psn") ||
            fromStr.includes("tox") ||
            fromStr.includes("recoil") ||
            fromStr.includes("item: rocky helmet") ||
            fromStr.includes("move: leech seed") ||
            fromStr.includes("weather") ||
            fromStr.includes("sand") ||
            fromStr.includes("hail") ||
            fromStr.includes("snow") ||
            // Generic residual check: any [from] source (covers all non-direct damage)
            isResidual);

        if (isStatusTick) {
          // Residual/status damage — actor is the pokemon being damaged
          const actor = pokemonToActor(targetIdent);
          entries.push({
            kind: "STATUS_TICK",
            actor,
            detail: {
              targetHp: cur,
              targetMaxHp: max,
            },
          });
        } else {
          // Direct damage from a move
          const actor = pendingMoveActor ?? pokemonToActor(targetIdent);
          entries.push({
            kind: "DAMAGE",
            actor,
            detail: {
              move: pendingMoveName ?? "",
              // damage is 0 here — SimBattleAdapter fills real damage from sim state
              damage: 0,
              isCrit: pendingCrit,
              targetHp: cur,
              targetMaxHp: max,
            },
          });
          pendingMoveActor = null;
          pendingCrit = false;
        }
        break;
      }

      case "-miss": {
        // |-miss|SOURCE|TARGET
        const sourceIdent = parts[2] ?? "";
        const actor = pendingMoveActor ?? pokemonToActor(sourceIdent);
        entries.push({
          kind: "MISS",
          actor,
          detail: {
            move: pendingMoveName ?? "",
          },
        });
        pendingMoveActor = null;
        pendingCrit = false;
        break;
      }

      case "faint": {
        // |faint|POKEMON
        const pokemonIdent = parts[2] ?? "";
        const actor = pokemonToActor(pokemonIdent);
        entries.push({
          kind: "FAINT",
          actor,
          detail: {
            pokemon: extractName(pokemonIdent),
          },
        });
        break;
      }

      case "-status": {
        // |-status|POKEMON|STATUS
        const pokemonIdent = parts[2] ?? "";
        const status = parts[3] ?? "";
        const actor = pokemonToActor(pokemonIdent);
        entries.push({
          kind: "STATUS_INFLICT",
          actor,
          detail: {
            pokemon: extractName(pokemonIdent),
            status,
          },
        });
        break;
      }

      case "switch":
      case "drag": {
        // |switch|POKEMON|DETAILS|HP_STATUS
        // |drag|POKEMON|DETAILS|HP_STATUS
        const pokemonIdent = parts[2] ?? "";
        const actor = pokemonToActor(pokemonIdent);
        entries.push({
          kind: "SWITCH",
          actor,
          detail: {
            pokemon: extractName(pokemonIdent),
            // fromIndex/toIndex set to 0 as placeholders — SimBattleAdapter fills real values
            fromIndex: 0,
            toIndex: 0,
          },
        });
        break;
      }

      case "-terastallize": {
        // |-terastallize|POKEMON|TYPE
        const pokemonIdent = parts[2] ?? "";
        const teraType = parts[3] ?? "";
        const actor = pokemonToActor(pokemonIdent);
        entries.push({
          kind: "TERA",
          actor,
          detail: {
            teraType,
            pokemon: extractName(pokemonIdent),
          },
        });
        break;
      }

      case "win": {
        // |win|PLAYER
        // Emit WIN if player name is 'Player', LOSS if 'Opponent'
        const winnerName = parts[2] ?? "";
        const isPlayer = winnerName === "Player";
        entries.push({
          kind: isPlayer ? "WIN" : "LOSS",
          actor: isPlayer ? "player" : "opponent",
          detail: {},
        });
        break;
      }

      case "cant": {
        // |cant|POKEMON|REASON
        const pokemonIdent = parts[2] ?? "";
        const reason = (parts[3] ?? "").toLowerCase();
        const actor = pokemonToActor(pokemonIdent);
        const pokemonName = extractName(pokemonIdent);

        if (reason.includes("par")) {
          entries.push({
            kind: "PARALYSIS_SKIP",
            actor,
            detail: { pokemon: pokemonName },
          });
        } else if (reason.includes("frz")) {
          entries.push({
            kind: "FROZEN",
            actor,
            detail: { pokemon: pokemonName },
          });
        } else if (reason.includes("slp")) {
          entries.push({
            kind: "ASLEEP",
            actor,
            detail: { pokemon: pokemonName },
          });
        }
        // Other cant reasons (recharge, disable, etc.) are silently ignored
        break;
      }

      case "-crit": {
        // |-crit|POKEMON — set pending crit flag for next DAMAGE entry
        pendingCrit = true;
        break;
      }

      // Ignored protocol messages (not mapped to TurnLogEntry)
      // |turn|N, |upkeep|, |-heal|, |-boost|, |-unboost|, etc.
      default:
        break;
    }
  }

  return entries;
}
