/**
 * Smoke test for BattleEngine — validates the core skeleton works.
 *
 * Run: npx tsx src/battle/engineSmoke.ts
 * Expected: all assertions pass, exit 0
 */

import { BattleEngine } from "./BattleEngine.js";
import type { BattleState, PlayerAction } from "../types/battleState.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test 1: startBattle() returns valid initial state
// ---------------------------------------------------------------------------
console.log("\n--- Test 1: startBattle() ---");
const state0 = BattleEngine.startBattle();

assert(state0.phase === "WAITING_FOR_ACTION", "phase is WAITING_FOR_ACTION");
assert(state0.playerSide.team.length === 6, "player has 6 Pokemon");
assert(state0.opponentSide.team.length === 6, "opponent has 6 Pokemon");
assert(state0.turnCount === 0, "turnCount is 0");
assert(state0.winner === null, "winner is null");
assert(state0.playerSide.activeIndex === 0, "player active index is 0");
assert(state0.opponentSide.activeIndex === 0, "opponent active index is 0");

// All Pokemon at full HP
const allFullHp = state0.playerSide.team.every(
  mon => mon.currentHp === mon.stats.hp && mon.currentHp > 0
);
assert(allFullHp, "all player Pokemon at full HP");

const allNotFainted = state0.playerSide.team.every(mon => !mon.fainted);
assert(allNotFainted, "no player Pokemon fainted");

// ---------------------------------------------------------------------------
// Test 2: submitAction() with two ATTACK actions — immutability and damage
// ---------------------------------------------------------------------------
console.log("\n--- Test 2: submitAction() ATTACK vs ATTACK ---");
const attackAction: PlayerAction = { type: "ATTACK", moveSlug: state0.playerSide.team[0]!.moves[0]! };
const opAttackAction: PlayerAction = { type: "ATTACK", moveSlug: state0.opponentSide.team[0]!.moves[0]! };

const result1 = BattleEngine.submitAction(state0, attackAction, opAttackAction);
const state1 = result1.nextState;

assert(state1 !== state0, "new state is referentially different from input");
assert(result1.log.length > 0, "log is not empty");

// Check that damage was applied
const playerActiveAfter = state1.playerSide.team[state1.playerSide.activeIndex]!;
const opponentActiveAfter = state1.opponentSide.team[state1.opponentSide.activeIndex]!;

// At least one side took ~50 damage (both should if neither fainted before attacking)
const someoneTookDamage =
  playerActiveAfter.currentHp < playerActiveAfter.stats.hp ||
  opponentActiveAfter.currentHp < opponentActiveAfter.stats.hp;
assert(someoneTookDamage, "at least one side took damage");

// Check log has DAMAGE entries
const damageEntries = result1.log.filter(e => e.kind === "DAMAGE");
assert(damageEntries.length >= 1, "log contains at least 1 DAMAGE entry");

// ---------------------------------------------------------------------------
// Test 3: submitAction() with SWITCH — switch resolves before attack
// ---------------------------------------------------------------------------
console.log("\n--- Test 3: submitAction() SWITCH vs ATTACK ---");
const freshState = BattleEngine.startBattle();
const switchAction: PlayerAction = { type: "SWITCH", toIndex: 1 };
const oppAttack: PlayerAction = { type: "ATTACK", moveSlug: freshState.opponentSide.team[0]!.moves[0]! };

const result2 = BattleEngine.submitAction(freshState, switchAction, oppAttack);
const state2 = result2.nextState;

// Switch should have happened
assert(state2.playerSide.activeIndex === 1, "player switched to index 1");

// Switch log should come before damage log
const switchLogIdx = result2.log.findIndex(e => e.kind === "SWITCH");
const damageLogIdx = result2.log.findIndex(e => e.kind === "DAMAGE");
assert(switchLogIdx < damageLogIdx, "SWITCH logged before DAMAGE (switch resolves first)");

// ---------------------------------------------------------------------------
// Test 4: Faint triggers WAITING_FOR_SWITCH or BATTLE_OVER
// ---------------------------------------------------------------------------
console.log("\n--- Test 4: Faint detection ---");

// Create a state where one Pokemon is at 1 HP (will faint from 50 placeholder damage)
function createLowHpState(): BattleState {
  const s = BattleEngine.startBattle();
  const team = s.opponentSide.team.map((mon, i) =>
    i === 0 ? { ...mon, currentHp: 1 } : mon
  );
  return {
    ...s,
    opponentSide: { ...s.opponentSide, team },
  };
}

const lowState = createLowHpState();
const pAttack: PlayerAction = { type: "ATTACK", moveSlug: lowState.playerSide.team[0]!.moves[0]! };
const oAttack: PlayerAction = { type: "ATTACK", moveSlug: lowState.opponentSide.team[0]!.moves[0]! };

const result3 = BattleEngine.submitAction(lowState, pAttack, oAttack);
const state3 = result3.nextState;

const faintEntries = result3.log.filter(e => e.kind === "FAINT");
assert(faintEntries.length >= 1, "FAINT event logged");

// Should be WAITING_FOR_SWITCH (opponent still has 5 alive teammates)
assert(
  state3.phase === "WAITING_FOR_SWITCH" || state3.phase === "WAITING_FOR_ACTION",
  "phase after faint is WAITING_FOR_SWITCH or WAITING_FOR_ACTION"
);

// ---------------------------------------------------------------------------
// Test 5: All 6 fainted triggers BATTLE_OVER
// ---------------------------------------------------------------------------
console.log("\n--- Test 5: BATTLE_OVER when all 6 fainted ---");

function createAllButOneDeadState(): BattleState {
  const s = BattleEngine.startBattle();
  // All opponent Pokemon fainted except index 0 at 1 HP
  const team = s.opponentSide.team.map((mon, i) =>
    i === 0
      ? { ...mon, currentHp: 1 }
      : { ...mon, currentHp: 0, fainted: true }
  );
  return {
    ...s,
    opponentSide: { ...s.opponentSide, team },
  };
}

const nearDeadState = createAllButOneDeadState();
const pa: PlayerAction = { type: "ATTACK", moveSlug: nearDeadState.playerSide.team[0]!.moves[0]! };
const oa: PlayerAction = { type: "ATTACK", moveSlug: nearDeadState.opponentSide.team[0]!.moves[0]! };

const result4 = BattleEngine.submitAction(nearDeadState, pa, oa);
const state4 = result4.nextState;

assert(state4.phase === "BATTLE_OVER", "phase is BATTLE_OVER");
assert(state4.winner === "player", "winner is player");

// ---------------------------------------------------------------------------
// Test 6: submitSwitch() after faint
// ---------------------------------------------------------------------------
console.log("\n--- Test 6: submitSwitch() ---");

// Set up a state in WAITING_FOR_SWITCH phase
const switchableState: BattleState = {
  ...BattleEngine.startBattle(),
  phase: "WAITING_FOR_SWITCH",
};
// Faint the active opponent
const switchTeam = switchableState.opponentSide.team.map((mon, i) =>
  i === 0 ? { ...mon, currentHp: 0, fainted: true } : mon
);
const readyForSwitch: BattleState = {
  ...switchableState,
  opponentSide: { ...switchableState.opponentSide, team: switchTeam },
};

const result5 = BattleEngine.submitSwitch(readyForSwitch, "opponent", 1);
const state5 = result5.nextState;

assert(state5.opponentSide.activeIndex === 1, "opponent switched to index 1");
assert(state5.phase === "WAITING_FOR_ACTION", "phase returned to WAITING_FOR_ACTION");

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
