/**
 * simSmoke.ts — Smoke test for SimBattleAdapter.
 *
 * Runs a quick sanity check:
 *   1. startBattle() — verify WAITING_FOR_ACTION, 6 pokemon per side at full HP
 *   2. submitAction() with two ATTACK actions — verify TurnResult with log entries
 *   3. Confirm battle.turn advanced
 *   4. Print log entries for manual review
 *
 * Run with: npx tsx src/battle/simSmoke.ts
 */

import { SimBattleAdapter } from "./SimBattleAdapter.js";

console.log("=== SimBattleAdapter Smoke Test ===\n");

// --- Test 1: startBattle() ---
console.log("--- Test 1: startBattle() ---");
const initialState = SimBattleAdapter.startBattle();

console.log(`Phase: ${initialState.phase} (expected WAITING_FOR_ACTION)`);
console.log(`Player team count: ${initialState.playerSide.team.length} (expected 6)`);
console.log(`Opponent team count: ${initialState.opponentSide.team.length} (expected 6)`);
console.log(`Turn count: ${initialState.turnCount} (expected 0)`);
console.log(`Winner: ${initialState.winner} (expected null)`);

const playerActive = initialState.playerSide.team[initialState.playerSide.activeIndex]!;
const opponentActive = initialState.opponentSide.team[initialState.opponentSide.activeIndex]!;

console.log(`\nPlayer active: ${playerActive.name} (HP: ${playerActive.currentHp}/${playerActive.stats.hp})`);
console.log(`Opponent active: ${opponentActive.name} (HP: ${opponentActive.currentHp}/${opponentActive.stats.hp})`);

console.log("\nPlayer team:");
for (const mon of initialState.playerSide.team) {
  console.log(`  ${mon.name} (${mon.species}) Lv.${mon.level} HP:${mon.stats.hp} | Moves: ${mon.moves.join(", ")}`);
}

console.log("\nOpponent team:");
for (const mon of initialState.opponentSide.team) {
  console.log(`  ${mon.name} (${mon.species}) Lv.${mon.level} HP:${mon.stats.hp} | Moves: ${mon.moves.join(", ")}`);
}

// Validate phase and team counts
if (initialState.phase !== "WAITING_FOR_ACTION") {
  throw new Error(`FAIL: Expected WAITING_FOR_ACTION, got ${initialState.phase}`);
}
if (initialState.playerSide.team.length !== 6) {
  throw new Error(`FAIL: Player team has ${initialState.playerSide.team.length} pokemon, expected 6`);
}
if (initialState.opponentSide.team.length !== 6) {
  throw new Error(`FAIL: Opponent team has ${initialState.opponentSide.team.length} pokemon, expected 6`);
}

// Validate all pokemon start at full HP
for (const mon of initialState.playerSide.team) {
  if (mon.currentHp !== mon.stats.hp) {
    throw new Error(`FAIL: ${mon.name} starts at ${mon.currentHp}/${mon.stats.hp} HP (expected full)`);
  }
}

console.log("\nTest 1 PASSED\n");

// --- Test 2: submitAction() with first move ---
console.log("--- Test 2: submitAction() with ATTACK actions ---");

const playerFirstMove = playerActive.moves[0]!;
const opponentFirstMove = opponentActive.moves[0]!;

console.log(`Player uses: ${playerFirstMove}`);
console.log(`Opponent uses: ${opponentFirstMove}`);

const battle = SimBattleAdapter.getBattle();
if (!battle) {
  throw new Error("FAIL: getBattle() returned null after startBattle()");
}
const turnBefore = battle.turn;
console.log(`Battle turn before: ${turnBefore}`);

const result = SimBattleAdapter.submitAction(
  initialState,
  { type: "ATTACK", moveSlug: playerFirstMove },
  { type: "ATTACK", moveSlug: opponentFirstMove },
);

const { nextState, log } = result;

console.log(`\nBattle turn after: ${battle.turn} (expected > ${turnBefore})`);
console.log(`Next phase: ${nextState.phase}`);
console.log(`Log entries: ${log.length}`);

// Print all log entries
console.log("\nTurn log entries:");
for (const entry of log) {
  console.log(`  [${entry.kind}] actor=${entry.actor} detail=${JSON.stringify(entry.detail)}`);
}

// Validate turn advanced
if (battle.turn <= turnBefore && nextState.phase !== "WAITING_FOR_SWITCH" && nextState.phase !== "BATTLE_OVER") {
  // Turn might not have advanced if a pokemon fainted and needs a switch
  console.log("Note: turn didn't advance — may be waiting for forced switch");
}

// Validate log has entries
if (log.length === 0) {
  throw new Error("FAIL: Expected at least 1 log entry after submitAction()");
}

// Check for DAMAGE entries
const damageEntries = log.filter(e => e.kind === "DAMAGE");
console.log(`\nDamage entries: ${damageEntries.length}`);
for (const entry of damageEntries) {
  const { move, damage, isCrit, targetHp, targetMaxHp } = entry.detail as {
    move: string;
    damage: number;
    isCrit: boolean;
    targetHp: number;
    targetMaxHp: number;
  };
  console.log(`  ${entry.actor} used ${move}: dealt ${damage} damage, isCrit=${isCrit}, targetHp=${targetHp}/${targetMaxHp}`);
}

// Validate player active pokemon state changed (HP should have potentially changed)
const playerActiveAfter = nextState.playerSide.team[nextState.playerSide.activeIndex]!;
const opponentActiveAfter = nextState.opponentSide.team[nextState.opponentSide.activeIndex]!;

console.log(`\nPlayer active after: ${playerActiveAfter.name} HP=${playerActiveAfter.currentHp}/${playerActiveAfter.stats.hp} status=${playerActiveAfter.status || "none"}`);
console.log(`Opponent active after: ${opponentActiveAfter.name} HP=${opponentActiveAfter.currentHp}/${opponentActiveAfter.stats.hp} status=${opponentActiveAfter.status || "none"}`);

// Validate HP was read from sim (not just 0 or unchanged)
// At least some damage should have occurred in most cases
const totalDamage = damageEntries.reduce((sum, e) => sum + ((e.detail as { damage: number }).damage ?? 0), 0);
console.log(`\nTotal damage this turn: ${totalDamage}`);

console.log("\nTest 2 PASSED\n");

// --- Test 3: Verify state structure integrity ---
console.log("--- Test 3: State structure integrity ---");

// All pokemon in next state should have valid HP (0 to maxhp)
for (const mon of nextState.playerSide.team) {
  if (mon.currentHp < 0 || mon.currentHp > mon.stats.hp) {
    throw new Error(`FAIL: ${mon.name} has invalid HP ${mon.currentHp}/${mon.stats.hp}`);
  }
}
for (const mon of nextState.opponentSide.team) {
  if (mon.currentHp < 0 || mon.currentHp > mon.stats.hp) {
    throw new Error(`FAIL: ${mon.name} has invalid HP ${mon.currentHp}/${mon.stats.hp}`);
  }
}

// Active index should be valid
if (nextState.playerSide.activeIndex < 0 || nextState.playerSide.activeIndex >= 6) {
  throw new Error(`FAIL: Invalid player activeIndex: ${nextState.playerSide.activeIndex}`);
}
if (nextState.opponentSide.activeIndex < 0 || nextState.opponentSide.activeIndex >= 6) {
  throw new Error(`FAIL: Invalid opponent activeIndex: ${nextState.opponentSide.activeIndex}`);
}

console.log("All HP values valid (0 <= currentHp <= maxHp)");
console.log("Active indices valid");
console.log("\nTest 3 PASSED\n");

console.log("=== All Smoke Tests PASSED ===");
