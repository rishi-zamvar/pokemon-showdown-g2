/**
 * DamageCalc — thin wrapper around @smogon/calc for Gen 9 damage calculation.
 *
 * Exports:
 *   computeDamage()   — wraps @smogon/calc calculate() with 16-roll random bracket
 *   rollCrit()        — Gen 9 crit threshold roll (base 1/24)
 *   doesMoveHit()     — accuracy check (true = always hits)
 *   getMovePP()       — max PP for a move slug
 *   getMoveAccuracy() — accuracy value for a move slug
 *   getMovePriority() — priority value for a move slug
 *   getMoveCritRatio() — critRatio value for a move slug
 *
 * Design rules:
 *   - Do NOT apply burn halving manually — @smogon/calc handles it via status
 *   - Do NOT compute type effectiveness manually — @smogon/calc handles it
 *   - result.damage is always number[] (16 rolls in Gen 9 singles)
 *   - Status-category moves return 0 damage (never passed to calculate())
 */

import {
  Generations,
  Pokemon as CalcPokemon,
  Move as CalcMove,
  calculate,
} from "@smogon/calc";
import type { ActivePokemon } from "../types/battleState.js";
import { DataLoader } from "../data/DataLoader.js";

// ---------------------------------------------------------------------------
// Gen 9 constant — resolved once at module load
// ---------------------------------------------------------------------------

const GEN9 = Generations.get(9);

// ---------------------------------------------------------------------------
// computeDamage — core wrapper around @smogon/calc
// ---------------------------------------------------------------------------

/**
 * Calculate damage for one attack using @smogon/calc, returning a single
 * randomly-selected value from the 16-roll damage bracket.
 *
 * Returns 0 for Status-category moves (they deal no direct damage).
 */
export function computeDamage(
  attacker: ActivePokemon,
  defender: ActivePokemon,
  moveSlug: string,
  isCrit: boolean,
): number {
  // Status moves deal no damage — skip @smogon/calc entirely
  const moveData = DataLoader.getMove(moveSlug.toLowerCase());
  if (moveData?.category === "Status") {
    return 0;
  }

  // Construct @smogon/calc Pokemon for attacker
  const calcAttacker = new CalcPokemon(GEN9, attacker.calcSpecies, {
    level: attacker.level,
    ability: attacker.ability,
    item: attacker.item || undefined,
    nature: attacker.nature,
    ivs: attacker.ivs,
    evs: attacker.evs,
    status: attacker.status ? (attacker.status as "" | "brn" | "par" | "psn" | "tox" | "slp" | "frz") : undefined,
    curHP: attacker.currentHp,
    teraType: attacker.teraActive ? (attacker.teraType as any) : undefined,
  });

  // Construct @smogon/calc Pokemon for defender
  const calcDefender = new CalcPokemon(GEN9, defender.calcSpecies, {
    level: defender.level,
    ability: defender.ability,
    item: defender.item || undefined,
    nature: defender.nature,
    ivs: defender.ivs,
    evs: defender.evs,
    status: defender.status ? (defender.status as "" | "brn" | "par" | "psn" | "tox" | "slp" | "frz") : undefined,
    curHP: defender.currentHp,
    teraType: defender.teraActive ? (defender.teraType as any) : undefined,
  });

  // Construct @smogon/calc Move
  const calcMove = new CalcMove(GEN9, moveSlug, { isCrit });

  // Calculate damage
  const result = calculate(GEN9, calcAttacker, calcDefender, calcMove);

  // result.damage is number[] (16 rolls) in Gen 9 singles, but can be 0 for
  // some edge cases (e.g. immune targets, moves with no damage formula).
  // Guard against non-array values to prevent NaN propagation.
  const damageResult = result.damage as number | number[];
  if (!Array.isArray(damageResult)) {
    return typeof damageResult === "number" ? damageResult : 0;
  }
  if (damageResult.length === 0) {
    return 0;
  }

  // Return a random roll from the 16-value bracket
  return damageResult[Math.floor(Math.random() * damageResult.length)]!;
}

// ---------------------------------------------------------------------------
// rollCrit — Gen 9 critical hit threshold
// ---------------------------------------------------------------------------

/**
 * Roll for a critical hit using Gen 9 thresholds.
 * critRatio 0 = 1/24, 1 = 1/8, 2 = 1/2, 3 = always (1/1).
 */
export function rollCrit(critRatio?: number): boolean {
  const thresholds = [24, 8, 2, 1]; // critRatio 0-3
  const threshold = thresholds[Math.min(critRatio ?? 0, 3)]!;
  return Math.floor(Math.random() * threshold) === 0;
}

// ---------------------------------------------------------------------------
// doesMoveHit — accuracy roll
// ---------------------------------------------------------------------------

/**
 * Roll whether a move hits based on its accuracy value.
 * If accuracy is `true`, the move always hits (e.g. Swift, Aerial Ace).
 */
export function doesMoveHit(accuracy: number | true): boolean {
  if (accuracy === true) return true;
  return Math.random() * 100 < accuracy;
}

// ---------------------------------------------------------------------------
// Move data accessors via DataLoader
// ---------------------------------------------------------------------------

/** Return the max PP for a move by its slug. Returns 0 if move not found. */
export function getMovePP(moveSlug: string): number {
  return DataLoader.getMove(moveSlug.toLowerCase())?.pp ?? 0;
}

/** Return accuracy for a move (number or `true`). Defaults to `true` if not found. */
export function getMoveAccuracy(moveSlug: string): number | true {
  return DataLoader.getMove(moveSlug.toLowerCase())?.accuracy ?? true;
}

/** Return priority for a move. Defaults to 0 if not found. */
export function getMovePriority(moveSlug: string): number {
  return DataLoader.getMove(moveSlug.toLowerCase())?.priority ?? 0;
}

/** Return critRatio for a move. Defaults to 0 (standard 1/24 rate) if not found. */
export function getMoveCritRatio(moveSlug: string): number {
  return DataLoader.getMove(moveSlug.toLowerCase())?.critRatio ?? 0;
}
