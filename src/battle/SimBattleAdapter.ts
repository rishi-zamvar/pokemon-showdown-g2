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
// Volatile conditions to display on HUD, mapped to abbreviations
// ---------------------------------------------------------------------------

const VOLATILE_ABBREVS: Record<string, string> = {
  confusion: 'CNF',
  taunt: 'TAUNT',
  encore: 'ENCORE',
  disable: 'DISBL',
  leechseed: 'SEED',
  curse: 'CURSE',
  substitute: 'SUB',
  focusenergy: 'FOCUS',
  mustrecharge: 'RCHRG',
  trapped: 'TRAP',
  partiallytrapped: 'BIND',
  flinch: 'FLNCH',
};

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
 * Uses positional keys (p1-0, p1-1, etc.) for stability — species name
 * changes after Transform, breaking species-based keys.
 */
function updatePrevHp(): void {
  if (!battle) return;
  const p1 = battle.sides[0];
  const p2 = battle.sides[1];
  if (!p1 || !p2) return;

  for (let i = 0; i < p1.pokemon.length; i++) {
    prevHp.set(`p1-${i}`, p1.pokemon[i]!.hp);
  }
  for (let i = 0; i < p2.pokemon.length; i++) {
    prevHp.set(`p2-${i}`, p2.pokemon[i]!.hp);
  }
}

/**
 * Find the sim Pokemon matching an original team entry.
 * The sim reorders its pokemon[] array on every switch, so we must
 * match by species name rather than by position index.
 *
 * Match priority:
 *  1. simMon.set.species — original PokemonSet data (most reliable, exact match)
 *  2. simMon.species.name — current species (can change with forme changes)
 *  3. simMon.species.baseSpecies — handles mid-battle forme changes
 *  4. simMon.name — display name fallback
 */
/** Normalize species name for matching: lowercase, strip non-alphanumeric */
function normalizeSpecies(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findSimMon(
  simSide: Side,
  species: string,
  name: string,
): import("@pkmn/sim").Pokemon | undefined {
  const key = normalizeSpecies(species);
  const nameKey = name.toLowerCase();
  // 1. Original PokemonSet species (best match — preserved from team generation)
  //    Normalize both sides: set.species uses spaces ("Decidueye Hisui"),
  //    teamData uses hyphens ("Decidueye-Hisui")
  for (const mon of simSide.pokemon) {
    const setSpecies = (mon as unknown as { set?: { species?: string } }).set?.species;
    if (setSpecies && normalizeSpecies(setSpecies) === key) return mon;
  }
  // 2. Current species name
  for (const mon of simSide.pokemon) {
    if (normalizeSpecies(mon.species.name) === key) return mon;
  }
  // 3. Base species (handles forme changes like Mimikyu → Mimikyu-Busted)
  for (const mon of simSide.pokemon) {
    if ((mon.species as unknown as { baseSpecies?: string }).baseSpecies &&
        normalizeSpecies((mon.species as unknown as { baseSpecies: string }).baseSpecies) === key) return mon;
  }
  // 4. Display name match
  for (const mon of simSide.pokemon) {
    if (mon.name.toLowerCase() === nameKey) return mon;
  }
  return undefined;
}

/**
 * Translate an original team index to the sim's current party index.
 * Needed because the sim swaps array positions on every switch.
 */
function originalToSimIndex(
  simSide: Side,
  teamData: ActivePokemon[],
  origIndex: number,
): number {
  const target = teamData[origIndex];
  if (!target) return origIndex;
  const simMon = findSimMon(simSide, target.species, target.name);
  if (!simMon) return origIndex;
  const idx = simSide.pokemon.indexOf(simMon);
  return idx >= 0 ? idx : origIndex;
}

/**
 * Derive a BattleSide from the sim's Side object, preserving base team data.
 *
 * IMPORTANT: The sim reorders pokemon[] on every switch (active always at [0]).
 * We match sim pokemon to our original team order by species name so that
 * team indices stay stable for the UI (switch select, sprites, etc.).
 */
function deriveSide(
  simSide: Side,
  teamData: ActivePokemon[],
  prevSideState: BattleSide,
): BattleSide {
  // Map team in ORIGINAL order (matching teamData indices)
  const team = teamData.map((prev, _i) => {
    const simMon = findSimMon(simSide, prev.species, prev.name);
    if (!simMon) {
      // Shouldn't happen — fallback to previous state
      return prevSideState.team[_i] ?? prev;
    }
    const ppUsed = buildPPUsed(simMon);

    // Detect if this mon has transformed (Ditto/Imposter/Transform move)
    const isTransformed = !!(simMon.volatiles?.['transform']);
    const species = isTransformed ? simMon.species.name : prev.species;
    const moves = isTransformed ? simMon.moveSlots.map(s => s.id) : prev.moves;

    // Extract visible volatile statuses from sim state
    const volatiles: string[] = [];
    if (simMon.volatiles) {
      for (const key of Object.keys(simMon.volatiles)) {
        const abbrev = VOLATILE_ABBREVS[key];
        if (abbrev) volatiles.push(abbrev);
      }
    }

    // Update max HP from sim if it changed (e.g. Terapagos Tera Shift form change)
    const stats = simMon.maxhp !== prev.stats.hp
      ? { ...prev.stats, hp: simMon.maxhp }
      : prev.stats;

    return {
      ...prev,
      species,
      moves,
      currentHp: simMon.hp,
      stats,
      status: (simMon.status && simMon.status !== 'fnt' ? simMon.status : '') as StatusCondition,
      toxicCounter: 0,
      sleepTurns: 0,
      fainted: simMon.fainted,
      teraActive: !!((simMon as unknown as { terastallized?: string }).terastallized),
      ppUsed,
      volatiles,
    } satisfies ActivePokemon;
  });

  // Find activeIndex by matching the sim's active pokemon to our team order
  const activeSimMon = simSide.active[0];
  let activeIndex = prevSideState.activeIndex;
  if (activeSimMon) {
    const setSpecies = (activeSimMon as unknown as { set?: { species?: string } }).set?.species;
    const activeKey = normalizeSpecies(setSpecies ?? activeSimMon.species.name);
    const idx = teamData.findIndex(
      td => normalizeSpecies(td.species) === activeKey || td.name.toLowerCase() === (setSpecies ?? activeSimMon.species.name).toLowerCase(),
    );
    if (idx >= 0) {
      activeIndex = idx;
    } else {
      // Fallback: try current species.name if set.species didn't match
      const fallbackKey = normalizeSpecies(activeSimMon.species.name);
      const fallbackIdx = teamData.findIndex(
        td => normalizeSpecies(td.species) === fallbackKey || td.name.toLowerCase() === activeSimMon.species.name.toLowerCase(),
      );
      if (fallbackIdx >= 0) activeIndex = fallbackIdx;
      console.warn(`[deriveSide] Active mon "${activeSimMon.species.name}" (set: ${setSpecies}) not found in teamData:`, teamData.map(t => t.species));
    }
  } else {
    console.log(`[deriveSide] active[0] is null (side: ${simSide.id}) — keeping prevActiveIndex=${activeIndex}`);
  }

  return {
    team,
    activeIndex,
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

  // Build a map of current HP for all pokemon (positional keys, stable across transform)
  const currentHp: Map<string, number> = new Map();
  for (let i = 0; i < p1.pokemon.length; i++) currentHp.set(`p1-${i}`, p1.pokemon[i]!.hp);
  for (let i = 0; i < p2.pokemon.length; i++) currentHp.set(`p2-${i}`, p2.pokemon[i]!.hp);

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
    // Player switch indices are in original team order — translate to sim party order
    const translatedPlayerAction: PlayerAction =
      playerAction.type === "SWITCH"
        ? { type: "SWITCH", toIndex: originalToSimIndex(p1Side, playerTeamData, playerAction.toIndex) }
        : playerAction;
    const p1Choice = actionToChoice(translatedPlayerAction, p1Side);
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

    // Player's toIndex is in original team order — translate to sim party order
    let simPlayerIdx = side === "player"
      ? originalToSimIndex(p1Side, playerTeamData, toIndex)
      : toIndex;

    // Validate: if the translated sim index points to a fainted/active mon, scan for a valid target
    if (side === "player") {
      const targetMon = p1Side.pokemon[simPlayerIdx];
      if (!targetMon || targetMon.fainted || simPlayerIdx === 0) {
        for (let i = 1; i < p1Side.pokemon.length; i++) {
          const mon = p1Side.pokemon[i];
          if (mon && !mon.fainted) {
            simPlayerIdx = i;
            break;
          }
        }
      }
    }

    const playerChoice = side === "player" ? `switch ${simPlayerIdx + 1}` : "pass";
    let opponentChoice: string;

    if (side === "opponent") {
      // toIndex from SimAIOpponent is already a sim party index — don't translate
      opponentChoice = `switch ${toIndex + 1}`;
    } else if (aiSwitchIndex !== undefined) {
      // Double-faint case — aiSwitchIndex is already a sim party index from SimAIOpponent
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

    console.log(`[submitSwitch] playerChoice="${playerChoice}" opponentChoice="${opponentChoice}" side="${side}" toIndex=${toIndex} aiSwitchIndex=${aiSwitchIndex}`);

    // Record HP before this operation
    updatePrevHp();

    // Execute choices per-side to handle WaitRequests correctly.
    // Waiting sides (requestState === '') reject all choices, but isChoiceDone()
    // returns true for them. Only call choose() on sides with an active request.
    logBuffer.length = 0;
    // Use per-side choose with retry logic for Revival Blessing edge cases.
    // Revival Blessing requires switching to a FAINTED Pokemon; our normal logic
    // picks alive Pokemon, so retry with a fainted target if the first choice fails.
    for (const [sd, choice] of [[p1Side, playerChoice], [p2Side, opponentChoice]] as const) {
      if (!sd.requestState || !choice) continue;
      const ok = sd.choose(choice);
      if (!ok && sd.choice.error?.includes('pass to a fainted')) {
        // Revival Blessing: pick first fainted non-active Pokemon
        (sd as unknown as { clearChoice(): void }).clearChoice();
        const faintedIdx = sd.pokemon.findIndex((m, i) => i > 0 && m.fainted);
        if (faintedIdx >= 0) {
          sd.choose(`switch ${faintedIdx + 1}`);
        }
      }
    }
    (b as unknown as { commitChoices(): void }).commitChoices();
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
