/**
 * Smoke test for AIOpponent.pickAction()
 *
 * Tests:
 *   1. pickAction returns a valid PlayerAction with correct shape
 *   2. AI prefers attacking over switching in most random matchups (50 iterations)
 *   3. pickAction runs in under 10ms on average (100 iterations)
 *
 * Run: npx tsx scripts/test-ai.ts
 */

import { BattleEngine } from "../src/battle/BattleEngine.js";
import { AIOpponent } from "../src/battle/AIOpponent.js";

// ---------------------------------------------------------------------------
// Test runner helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test 1: pickAction returns a valid PlayerAction
// ---------------------------------------------------------------------------

console.log("\nTest 1: pickAction returns a valid PlayerAction");

const state = BattleEngine.startBattle();
const aiSide = state.opponentSide;
const aiMon = aiSide.team[aiSide.activeIndex]!;

const action = AIOpponent.pickAction(state);

const validTypes = new Set(["ATTACK", "SWITCH", "TERA_ATTACK"]);
assert(validTypes.has(action.type), `action.type is valid: ${action.type}`);

if (action.type === "ATTACK" || action.type === "TERA_ATTACK") {
  assert(
    typeof action.moveSlug === "string" && action.moveSlug.length > 0,
    `moveSlug is non-empty string: "${action.moveSlug}"`,
  );
  assert(
    aiMon.moves.includes(action.moveSlug),
    `moveSlug "${action.moveSlug}" is in aiMon.moves: [${aiMon.moves.join(", ")}]`,
  );
} else if (action.type === "SWITCH") {
  assert(
    typeof action.toIndex === "number",
    `SWITCH toIndex is number: ${action.toIndex}`,
  );
  assert(
    action.toIndex !== aiSide.activeIndex,
    `SWITCH toIndex ${action.toIndex} !== activeIndex ${aiSide.activeIndex}`,
  );
  const switchTarget = aiSide.team[action.toIndex];
  assert(
    switchTarget !== undefined && !switchTarget.fainted,
    `SWITCH target at ${action.toIndex} exists and is not fainted`,
  );
}

// ---------------------------------------------------------------------------
// Test 2: AI prefers attacking over switching across 50 random matchups
// ---------------------------------------------------------------------------

console.log("\nTest 2: AI prefers attacking across 50 random matchups");

let attackCount = 0;
let switchCount = 0;
let teraCount = 0;
const ITERATIONS = 50;

for (let i = 0; i < ITERATIONS; i++) {
  const s = BattleEngine.startBattle();
  const a = AIOpponent.pickAction(s);

  if (a.type === "ATTACK") attackCount++;
  else if (a.type === "TERA_ATTACK") { attackCount++; teraCount++; }
  else switchCount++;
}

const switchRate = (switchCount / ITERATIONS) * 100;
console.log(
  `  Results: ${attackCount} attacks (${teraCount} Tera), ${switchCount} switches over ${ITERATIONS} iterations`,
);
console.log(`  Switch rate: ${switchRate.toFixed(1)}% (threshold: <20%)`);

assert(
  switchRate < 20,
  `Switch rate ${switchRate.toFixed(1)}% is under 20% (AI prefers attacking)`,
);

// ---------------------------------------------------------------------------
// Test 3: Performance — average < 10ms per call over 100 iterations
// ---------------------------------------------------------------------------

console.log("\nTest 3: Performance — 100 pickAction() calls < 10ms average");

const PERF_ITERATIONS = 100;
const perfStates = Array.from({ length: PERF_ITERATIONS }, () =>
  BattleEngine.startBattle(),
);

const start = performance.now();
for (const s of perfStates) {
  AIOpponent.pickAction(s);
}
const end = performance.now();

const totalMs = end - start;
const avgMs = totalMs / PERF_ITERATIONS;

console.log(`  Total: ${totalMs.toFixed(2)}ms for ${PERF_ITERATIONS} calls`);
console.log(`  Average: ${avgMs.toFixed(3)}ms per call (threshold: <10ms)`);

assert(
  avgMs < 10,
  `Average ${avgMs.toFixed(3)}ms per call is under 10ms (AI-05 satisfied)`,
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);
