/**
 * SimBattleAdapter — wraps @pkmn/sim's Battle class to expose the same API
 * as BattleEngine (startBattle, submitAction, submitSwitch) plus getBattle().
 *
 * This is the core replacement for the custom BattleEngine. All Gen 9
 * mechanics (damage, priority, abilities, items, status, weather, terrain)
 * now come from the real sim instead of custom approximations.
 *
 * Design:
 *   - Module-level singleton pattern (export const SimBattleAdapter = { ... })
 *   - Mutable battle: Battle | null held at module scope
 *   - logBuffer collects protocol lines via battle's send callback
 *   - prevHp map tracks HP per pokemon key for damage calculation
 *   - BattleState is derived from sim state — HP/status/fainted/PP/tera all
 *     read from sim fields, never from log strings
 *   - The same PokemonSet[] used for Teams.pack() and BattleState team arrays
 *
 * Key invariants:
 *   - Do NOT use BattleStream or getPlayerStreams (Node Buffer dependency)
 *   - Do NOT call battle.start() — auto-starts when both players are set
 *   - Do NOT read HP from log strings — read from pokemon.hp and pokemon.maxhp
 *   - Do NOT mutate BattleState — always create new objects via spread
 *   - Do NOT hold references to sim Pokemon objects across turns
 */

import { Battle, Teams, Dex } from "@pkmn/sim";
import type { Side } from "@pkmn/sim";
import { TeamGenerators } from "@pkmn/randoms";
import { Generations, Pokemon as CalcPokemon } from "@smogon/calc";
import type { BattlePokemon } from "../types/battle.js";
import type {
  ActivePokemon,
  BattlePhase,
  BattleSide,
  BattleState,
  PlayerAction,
  StatusCondition,
  TurnLogEntry,
  TurnResult,
} from "../types/battleState.js";
import { initActivePokemon } from "../types/battleState.js";
import { parseLogLines } from "./LogParser.js";

// ---------------------------------------------------------------------------
// One-time module init — must be called before any Team Preview / random gen
// ---------------------------------------------------------------------------

Teams.setGeneratorFactory(TeamGenerators);

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const GEN9 = Generations.get(9);

// ---------------------------------------------------------------------------
// Module-level mutable state
// ---------------------------------------------------------------------------

let battle: Battle | null = null;
let playerTeamData: ActivePokemon[] = [];
let opponentTeamData: ActivePokemon[] = [];

// Collect protocol lines from the battle's send callback
const logBuffer: string[] = [];

// Previous HP map: key is "p1-N" or "p2-N", value is pokemon.hp before turn
const prevHp: Map<string, number> = new Map();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Filter raw PS battle log lines to remove split-protocol duplicates.
 *
 * When the sim calls addSplit(sideId, secret, shared), it adds three entries:
 *   |split|p1        ← split marker
 *   |<secret line>   ← side-specific line (e.g. absolute HP for p1)
 *   |<shared line>   ← shared/opponent-visible line (e.g. HP percentage)
 *
 * For our purposes, we want exactly ONE copy of each event.
 * Strategy: skip the `|split|pX` markers AND the line immediately after
 * (the "secret" side-specific line). Keep the "shared" line that follows.
 * This avoids duplicate event entries in the TurnLogEntry[].
 *
 * Empty lines (just "|") are also filtered out.
 */
function filterSplitLines(lines: string[]): string[] {
  const result: string[] = [];
  let skipNext = false;

  for (const line of lines) {
    // Empty lines and bare separators
    if (line === "" || line === "|") {
      skipNext = false;
      continue;
    }

    // Split marker: |split|p1 or |split|p2
    if (line.startsWith("|split|")) {
      skipNext = true; // next line is the secret (side-specific) — skip it
      continue;
    }

    // Skip the secret line after a split marker
    if (skipNext) {
      skipNext = false;
      continue; // skip the secret, but DON'T set skipNext again — next line is shared
    }

    result.push(line);
  }

  return result;
}

/**
 * Convert a PokemonSet[] from @pkmn/randoms into our BattlePokemon[] format.
 * Replicates the logic from TeamGenerator.buildRandom() inline.
 */
function pokemonSetsToTeam(sets: import("@pkmn/sim").PokemonSet[]): BattlePokemon[] {
  return sets.map(set => {
    // Resolve cosmetic formes — @smogon/calc only knows base species for cosmetic formes
    const simSpecies = Dex.species.get(set.species);
    const calcSpecies = simSpecies.baseSpecies || set.species;

    // Compute final stats via @smogon/calc constructor
    const calcPokemon = new CalcPokemon(GEN9, calcSpecies, {
      level: set.level,
      ability: set.ability,
      item: set.item ?? "",
      nature: set.nature ?? "Hardy",
      ivs: set.ivs,
      evs: set.evs,
      moves: set.moves,
      teraType: set.teraType as unknown as import("@pkmn/types").TypeName,
    });

    return {
      name: set.name ?? set.species,
      species: set.species,
      calcSpecies,
      moves: set.moves,
      teraType: set.teraType ?? "Normal",
      level: set.level,
      ability: set.ability,
      item: set.item ?? "",
      nature: set.nature ?? "Hardy",
      gender: set.gender ?? "N",
      evs: set.evs,
      ivs: set.ivs,
      stats: {
        hp: calcPokemon.stats.hp,
        atk: calcPokemon.stats.atk,
        def: calcPokemon.stats.def,
        spa: calcPokemon.stats.spa,
        spd: calcPokemon.stats.spd,
        spe: calcPokemon.stats.spe,
      },
    } satisfies BattlePokemon;
  });
}

/**
 * Build PP usage map from sim Pokemon's moveSlots.
 * ppUsed[moveId] = maxpp - pp (how many PP have been used)
 */
function buildPPUsed(
  simMon: import("@pkmn/sim").Pokemon,
): Record<string, number> {
  const ppUsed: Record<string, number> = {};
  for (const slot of simMon.moveSlots) {
    ppUsed[slot.id] = slot.maxpp - slot.pp;
  }
  return ppUsed;
}

/**
 * Update prevHp map with current HP values for all pokemon on both sides.
 */
function updatePrevHp(): void {
  if (!battle) return;
  const p1 = battle.sides[0];
  const p2 = battle.sides[1];
  if (!p1 || !p2) return;

  p1.pokemon.forEach((mon, i) => {
    prevHp.set(`p1-${i}`, mon.hp);
  });
  p2.pokemon.forEach((mon, i) => {
    prevHp.set(`p2-${i}`, mon.hp);
  });
}

/**
 * Derive a BattleSide from the sim's Side object, preserving base team data.
 */
function deriveSide(
  simSide: Side,
  teamData: ActivePokemon[],
  prevSideState: BattleSide,
): BattleSide {
  const activeSimMon = simSide.active[0];
  const activeIndex = activeSimMon
    ? simSide.pokemon.indexOf(activeSimMon)
    : prevSideState.activeIndex;

  const team = simSide.pokemon.map((simMon, i) => {
    const prev = teamData[i] ?? prevSideState.team[i] ?? teamData[0]!;
    const ppUsed = buildPPUsed(simMon);
    return {
      ...prev,
      currentHp: simMon.hp,
      status: (simMon.status as StatusCondition) || "",
      // toxicCounter and sleepTurns not tracked in sim-derived state —
      // keep previous values or reset to 0 (sim handles the actual mechanics)
      toxicCounter: 0,
      sleepTurns: 0,
      fainted: simMon.fainted,
      teraActive: !!((simMon as unknown as { terastallized?: string }).terastallized),
      ppUsed,
    } satisfies ActivePokemon;
  });

  return {
    team,
    activeIndex: activeIndex >= 0 ? activeIndex : prevSideState.activeIndex,
    teraUsed: team.some(mon => mon.teraActive),
  };
}

/**
 * Derive the current BattlePhase from sim state.
 */
function derivePhase(b: Battle): BattlePhase {
  if (b.ended) return "BATTLE_OVER";

  const p1NeedsSwitch = b.sides[0]?.activeRequest?.forceSwitch?.some(Boolean);
  const p2NeedsSwitch = b.sides[1]?.activeRequest?.forceSwitch?.some(Boolean);
  if (p1NeedsSwitch || p2NeedsSwitch) return "WAITING_FOR_SWITCH";

  return "WAITING_FOR_ACTION";
}

/**
 * Derive the winner from sim state.
 */
function deriveWinner(b: Battle): "player" | "opponent" | null {
  if (!b.ended) return null;
  // battle.winner is the player's name string (e.g., 'Player')
  if (b.winner === b.sides[0]?.name) return "player";
  if (b.winner === b.sides[1]?.name) return "opponent";
  // Fallback: check which side has all pokemon fainted
  const p1 = b.sides[0];
  const p2 = b.sides[1];
  if (p2 && p2.pokemon.every(mon => mon.fainted)) return "player";
  if (p1 && p1.pokemon.every(mon => mon.fainted)) return "opponent";
  return "opponent";
}

/**
 * Derive a new BattleState from the current sim state.
 */
function deriveBattleState(prevState: BattleState): BattleState {
  const b = battle!;
  const p1 = b.sides[0]!;
  const p2 = b.sides[1]!;

  const playerSide = deriveSide(p1, playerTeamData, prevState.playerSide);
  const opponentSide = deriveSide(p2, opponentTeamData, prevState.opponentSide);

  return {
    phase: derivePhase(b),
    playerSide,
    opponentSide,
    turnCount: b.turn,
    winner: deriveWinner(b),
  };
}

/**
 * Fill in real damage values for DAMAGE entries in the log.
 * SimBattleAdapter reads HP diff from prevHp map vs current sim state.
 * Log entries from LogParser have damage=0 as placeholder.
 */
function fillDamageValues(
  log: TurnLogEntry[],
): TurnLogEntry[] {
  if (!battle) return log;

  const p1 = battle.sides[0];
  const p2 = battle.sides[1];
  if (!p1 || !p2) return log;

  // Build a map of current HP for all pokemon
  const currentHp: Map<string, number> = new Map();
  p1.pokemon.forEach((mon, i) => currentHp.set(`p1-${i}`, mon.hp));
  p2.pokemon.forEach((mon, i) => currentHp.set(`p2-${i}`, mon.hp));

  // For DAMAGE entries: we need to match the log entry to a pokemon.
  // Strategy: For each DAMAGE entry, find which opponent pokemon lost HP.
  // This is an approximation — for multi-target moves it may not be perfect,
  // but for single-target (99% of random battle) it works correctly.

  // Build HP loss map per pokemon key
  const hpLoss: Map<string, number> = new Map();
  for (const [key, oldHp] of prevHp.entries()) {
    const newHp = currentHp.get(key) ?? oldHp;
    const loss = oldHp - newHp;
    if (loss > 0) {
      hpLoss.set(key, loss);
    }
  }

  // Track which losses we've already assigned
  const assignedKeys = new Set<string>();

  return log.map(entry => {
    if (entry.kind !== "DAMAGE") return entry;

    const actor = entry.actor;
    // The damaged side is the OPPOSITE of the actor
    const damagedSidePrefix = actor === "player" ? "p2" : "p1";

    // Find unassigned pokemon on the damaged side with HP loss
    let bestKey: string | null = null;
    let bestLoss = 0;

    for (const [key, loss] of hpLoss.entries()) {
      if (assignedKeys.has(key)) continue;
      if (!key.startsWith(damagedSidePrefix)) continue;
      if (loss > bestLoss) {
        bestLoss = loss;
        bestKey = key;
      }
    }

    if (bestKey !== null && bestLoss > 0) {
      assignedKeys.add(bestKey);
      return {
        ...entry,
        detail: {
          ...entry.detail,
          damage: bestLoss,
        },
      };
    }

    return entry;
  });
}

/**
 * Translate a PlayerAction to a PS choice string.
 */
function actionToChoice(action: PlayerAction, side: Side): string {
  if (action.type === "SWITCH") {
    return `switch ${action.toIndex + 1}`;
  }

  const request = side.activeRequest;
  if (!request || !("active" in request) || !request.active?.[0]) {
    return "move 1";
  }

  const moveRequest = request.active[0];
  const moveIdx = moveRequest.moves.findIndex(m => m.id === action.moveSlug);
  const slot = moveIdx >= 0 ? moveIdx + 1 : 1;

  if (action.type === "TERA_ATTACK") {
    return `move ${slot} terastallize`;
  }
  return `move ${slot}`;
}

// ---------------------------------------------------------------------------
// Exported singleton
// ---------------------------------------------------------------------------

export const SimBattleAdapter = {
  /**
   * Create a fresh BattleState backed by a real @pkmn/sim Battle instance.
   *
   * Generates two random Gen 9 teams via @pkmn/randoms, creates the Battle
   * instance, sets both players, and returns initial BattleState with
   * phase WAITING_FOR_ACTION, 6 Pokemon per side at full HP.
   */
  startBattle(): BattleState {
    // Step 1: Generate teams via @pkmn/randoms
    const p1Generator = TeamGenerators.getTeamGenerator("[Gen 9] Random Battle");
    const p2Generator = TeamGenerators.getTeamGenerator("[Gen 9] Random Battle");
    const p1Sets = p1Generator.getTeam();
    const p2Sets = p2Generator.getTeam();

    // Step 2: Convert PokemonSet[] to our BattlePokemon[] format
    const p1Team = pokemonSetsToTeam(p1Sets);
    const p2Team = pokemonSetsToTeam(p2Sets);

    // Step 3: Build ActivePokemon arrays (runtime fields at defaults)
    playerTeamData = p1Team.map(initActivePokemon);
    opponentTeamData = p2Team.map(initActivePokemon);

    // Step 4: Create Battle instance with log collector
    logBuffer.length = 0;

    battle = new Battle(
      {
        formatid: "gen9randombattle" as import("@pkmn/sim").ID,
        send(type: string, data: string | string[]) {
          if (type === "update") {
            const dataStr = Array.isArray(data) ? data.join("\n") : data;
            logBuffer.push(...dataStr.split("\n").filter(l => l.length > 0));
          }
        },
      },
      Dex,
    );

    // Step 5: Set both players — battle auto-starts when both are set
    battle.setPlayer("p1", {
      name: "Player",
      team: Teams.pack(p1Sets),
    });
    battle.setPlayer("p2", {
      name: "Opponent",
      team: Teams.pack(p2Sets),
    });

    // Flush initial log and emit turn 1 requests
    battle.sendUpdates();

    // Step 6: Initialize prevHp tracking
    prevHp.clear();
    updatePrevHp();

    // Step 7: Build initial BattleState
    const initialState: BattleState = {
      phase: "WAITING_FOR_ACTION",
      playerSide: {
        team: playerTeamData,
        activeIndex: 0,
        teraUsed: false,
      },
      opponentSide: {
        team: opponentTeamData,
        activeIndex: 0,
        teraUsed: false,
      },
      turnCount: 0,
      winner: null,
    };

    return initialState;
  },

  /**
   * Resolve one complete turn given both players' actions.
   *
   * Translates PlayerActions to PS choice strings, calls battle.makeChoices(),
   * derives new BattleState from sim state, and fills in damage values.
   */
  submitAction(
    state: BattleState,
    playerAction: PlayerAction,
    opponentAction: PlayerAction,
  ): TurnResult {
    if (state.phase !== "WAITING_FOR_ACTION") {
      throw new Error(
        `submitAction() called in wrong phase: ${state.phase} (expected WAITING_FOR_ACTION)`,
      );
    }

    if (!battle) {
      throw new Error("submitAction() called before startBattle()");
    }

    const b = battle;
    const p1Side = b.sides[0]!;
    const p2Side = b.sides[1]!;

    // Translate actions to PS choice strings
    const p1Choice = actionToChoice(playerAction, p1Side);
    const p2Choice = actionToChoice(opponentAction, p2Side);

    // Record HP before this turn for damage calculation
    updatePrevHp();

    // Clear log buffer and run the turn
    logBuffer.length = 0;
    b.makeChoices(p1Choice, p2Choice);
    b.sendUpdates();

    // Parse protocol lines into TurnLogEntry[]
    // Filter split-protocol duplicates before parsing
    const filteredLog = filterSplitLines([...logBuffer]);
    let log = parseLogLines(filteredLog);

    // Derive new BattleState from sim state
    const nextState = deriveBattleState(state);

    // Fill in real damage values by comparing prevHp with current hp
    log = fillDamageValues(log);

    return { nextState, log };
  },

  /**
   * Handle a forced switch after a faint.
   *
   * Builds choice strings for both sides — the switching side sends
   * "switch N", the other side sends "pass" (unless it also needs a switch).
   *
   * For double-faint scenarios, both sides can switch in a single
   * makeChoices() call via the optional aiSwitchIndex parameter.
   */
  submitSwitch(
    state: BattleState,
    side: "player" | "opponent",
    toIndex: number,
    aiSwitchIndex?: number,
  ): TurnResult {
    if (state.phase !== "WAITING_FOR_SWITCH") {
      throw new Error(
        `submitSwitch() called in wrong phase: ${state.phase} (expected WAITING_FOR_SWITCH)`,
      );
    }

    if (!battle) {
      throw new Error("submitSwitch() called before startBattle()");
    }

    const b = battle;
    const p1Side = b.sides[0]!;
    const p2Side = b.sides[1]!;

    const playerChoice = side === "player" ? `switch ${toIndex + 1}` : "pass";
    let opponentChoice: string;

    if (side === "opponent") {
      opponentChoice = `switch ${toIndex + 1}`;
    } else if (aiSwitchIndex !== undefined) {
      // Double-faint case — both sides switch in same call
      opponentChoice = `switch ${aiSwitchIndex + 1}`;
    } else {
      // Check if opponent side needs to switch too
      const opponentNeedsSwitch = p2Side.activeRequest?.forceSwitch?.some(Boolean);
      if (opponentNeedsSwitch) {
        // Opponent also needs a switch but no aiSwitchIndex provided —
        // pick first available non-fainted pokemon (basic AI fallback)
        const available = p2Side.pokemon.findIndex(
          (mon, i) => !mon.fainted && i !== p2Side.pokemon.indexOf(p2Side.active[0]!),
        );
        opponentChoice = available >= 0 ? `switch ${available + 1}` : "pass";
      } else {
        opponentChoice = "pass";
      }
    }

    // Suppress unused-variable warnings: we use p1Side only via playerChoice computation above
    void p1Side;

    // Record HP before this operation
    updatePrevHp();

    // Clear log and execute choices
    logBuffer.length = 0;
    b.makeChoices(playerChoice, opponentChoice);
    b.sendUpdates();

    // Parse protocol lines (filter split-protocol duplicates first)
    const filteredLog = filterSplitLines([...logBuffer]);
    let log = parseLogLines(filteredLog);

    // Derive new BattleState
    const nextState = deriveBattleState(state);

    // Fill in damage values (switch-in abilities may deal damage)
    log = fillDamageValues(log);

    return { nextState, log };
  },

  /**
   * Returns the internal Battle instance (or null before startBattle is called).
   * Used by SimAIOpponent (Plan 05.2-02) to read the live ChoiceRequest.
   */
  getBattle(): Battle | null {
    return battle;
  },
} as const;
