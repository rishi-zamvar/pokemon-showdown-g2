/**
 * BattleState types — immutable state representation for one Gen 9 random battle.
 *
 * This file defines the finite state machine (FSM) phases, all runtime-only
 * fields added to BattlePokemon during a battle, and the BattleState shape
 * that flows through BattleEngine's public API.
 *
 * Design:
 *   - BattleState is treated as immutable — BattleEngine always returns new
 *     state objects via spread, never mutates in place.
 *   - ActivePokemon extends BattlePokemon with runtime fields (currentHp,
 *     status, fainted, etc.) that only exist during a battle.
 *   - TurnResult bundles the next state with a log of what happened, so the
 *     UI can animate/display events in order.
 */

import type { BattlePokemon } from "./battle.js";

// ---------------------------------------------------------------------------
// FSM phases
// ---------------------------------------------------------------------------

export type BattlePhase =
  | "WAITING_FOR_ACTION"
  | "RESOLVING_TURN"
  | "WAITING_FOR_SWITCH"
  | "BATTLE_OVER";

// ---------------------------------------------------------------------------
// Status conditions (Gen 9 abbreviations)
// ---------------------------------------------------------------------------

export type StatusCondition = "brn" | "par" | "psn" | "tox" | "slp" | "frz" | "";

// ---------------------------------------------------------------------------
// ActivePokemon — BattlePokemon + runtime battle fields
// ---------------------------------------------------------------------------

export interface ActivePokemon extends BattlePokemon {
  currentHp: number;
  status: StatusCondition;
  toxicCounter: number;
  sleepTurns: number;
  teraActive: boolean;
  ppUsed: Record<string, number>;
  fainted: boolean;
}

// ---------------------------------------------------------------------------
// BattleSide — one player's team + active slot
// ---------------------------------------------------------------------------

export interface BattleSide {
  team: ActivePokemon[];
  activeIndex: number;
  teraUsed: boolean;
}

// ---------------------------------------------------------------------------
// Player actions — discriminated union
// ---------------------------------------------------------------------------

export type PlayerAction =
  | { type: "ATTACK"; moveSlug: string }
  | { type: "SWITCH"; toIndex: number }
  | { type: "TERA_ATTACK"; moveSlug: string };

// ---------------------------------------------------------------------------
// Turn log — ordered sequence of events for UI rendering
// ---------------------------------------------------------------------------

export interface TurnLogEntry {
  kind:
    | "DAMAGE"
    | "MISS"
    | "FAINT"
    | "STATUS_INFLICT"
    | "STATUS_TICK"
    | "SWITCH"
    | "TERA"
    | "WIN"
    | "LOSS"
    | "PP_OUT"
    | "PARALYSIS_SKIP"
    | "FROZEN"
    | "ASLEEP"
    // New - type effectiveness
    | "SUPER_EFFECTIVE"
    | "RESISTED"
    | "IMMUNE"
    // New - stat changes
    | "STAT_BOOST"
    | "STAT_UNBOOST"
    | "STAT_CLEAR"
    // New - volatiles
    | "VOLATILE_START"
    | "VOLATILE_END"
    // New - weather/terrain/side
    | "WEATHER"
    | "TERRAIN"
    | "SIDE_START"
    | "SIDE_END"
    // New - heal
    | "HEAL"
    // New - items
    | "ITEM_REVEAL"
    | "ITEM_CONSUME"
    // New - abilities
    | "ABILITY"
    // New - protect/endure
    | "PROTECT"
    // New - multi-hit
    | "HIT_COUNT"
    // New - move failure
    | "MOVE_FAIL"
    // New - charging/recharge
    | "PREPARE"
    | "RECHARGE"
    // New - transform
    | "TRANSFORM"
    // New - status cure
    | "CURE_STATUS"
    // New - cant expansions
    | "FLINCH_SKIP"
    | "RECHARGE_SKIP"
    // New - activate (generic)
    | "ACTIVATE"
    // New - generic text fallback
    | "TEXT";
  actor: "player" | "opponent";
  detail: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// TurnResult — returned by submitAction() and submitSwitch()
// ---------------------------------------------------------------------------

export interface TurnResult {
  nextState: BattleState;
  log: TurnLogEntry[];
}

// ---------------------------------------------------------------------------
// BattleState — the top-level immutable state object
// ---------------------------------------------------------------------------

export interface BattleState {
  readonly phase: BattlePhase;
  readonly playerSide: BattleSide;
  readonly opponentSide: BattleSide;
  readonly turnCount: number;
  readonly winner: "player" | "opponent" | null;
}

// ---------------------------------------------------------------------------
// Helper — initialise an ActivePokemon from a BattlePokemon
// ---------------------------------------------------------------------------

/**
 * Convert a BattlePokemon (team-generation output) into an ActivePokemon
 * with all runtime fields set to defaults (full HP, no status, not fainted).
 */
export function initActivePokemon(pokemon: BattlePokemon): ActivePokemon {
  return {
    ...pokemon,
    currentHp: pokemon.stats.hp,
    status: "",
    toxicCounter: 0,
    sleepTurns: 0,
    teraActive: false,
    ppUsed: {},
    fainted: false,
  };
}
