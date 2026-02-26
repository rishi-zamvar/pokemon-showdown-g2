/**
 * TeamGenerator Stress Test — Phase 2 validation script.
 *
 * Run with:  npx tsx src/battle/TeamGenerator.test.ts
 *
 * Validates 100 consecutive buildRandom() calls (600 Pokemon) against all
 * Phase 2 success criteria and @smogon/calc constructor alignment.
 *
 * Exits 0 on PASS, 1 on any validation failure.
 */

import { TeamGenerator } from "./TeamGenerator.js";
import { Generations, Pokemon as CalcPokemon } from "@smogon/calc";

const GEN9 = Generations.get(9);
const ITERATIONS = 100;

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

let totalPokemon = 0;
let teamsWrongSize = 0;
let missingTeraType = 0;
let movesLessThanOne = 0;
let invalidLevel = 0;
let calcConstructorFailures = 0;
let statsHpZeroOrBelow = 0;
let dittoAppearances = 0;
let cosmeticFormeResolutions = 0;

// ---------------------------------------------------------------------------
// Run iterations
// ---------------------------------------------------------------------------

console.log(`Running TeamGenerator stress test (${ITERATIONS} iterations)...\n`);

for (let i = 0; i < ITERATIONS; i++) {
  const team = TeamGenerator.buildRandom();

  if (team.length !== 6) {
    teamsWrongSize++;
  }

  for (const mon of team) {
    totalPokemon++;

    // Validate teraType present and non-empty
    if (!mon.teraType || mon.teraType.trim() === "") {
      missingTeraType++;
    }

    // Validate moves.length >= 1
    if (!mon.moves || mon.moves.length < 1) {
      movesLessThanOne++;
    }

    // Validate level in range [1, 100]
    if (mon.level < 1 || mon.level > 100) {
      invalidLevel++;
    }

    // Validate stats.hp > 0 (proves buildRandom computed real stats)
    if (mon.stats.hp <= 0) {
      statsHpZeroOrBelow++;
    }

    // Informational: track Ditto appearances
    if (mon.calcSpecies === "Ditto" || mon.species === "Ditto") {
      dittoAppearances++;
    }

    // Informational: track cosmetic forme resolutions
    if (mon.calcSpecies !== mon.species) {
      cosmeticFormeResolutions++;
    }

    // Validate @smogon/calc constructor alignment
    try {
      const calcPokemon = new CalcPokemon(GEN9, mon.calcSpecies, {
        level: mon.level,
        ability: mon.ability,
        item: mon.item,
        nature: mon.nature,
        ivs: mon.ivs,
        evs: mon.evs,
      });

      if (calcPokemon.stats.hp <= 0) {
        statsHpZeroOrBelow++;
      }
    } catch (err) {
      calcConstructorFailures++;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  [iter ${i + 1}] calc constructor failed for "${mon.calcSpecies}": ${errMsg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`TeamGenerator Stress Test (${ITERATIONS} iterations):`);
console.log(`  Total Pokemon:              ${totalPokemon}`);
console.log(`  Teams of size != 6:         ${teamsWrongSize}`);
console.log(`  Missing teraType:           ${missingTeraType}`);
console.log(`  Moves < 1:                  ${movesLessThanOne}`);
console.log(`  Invalid level:              ${invalidLevel}`);
console.log(`  Calc constructor failures:  ${calcConstructorFailures}`);
console.log(`  Stats.hp <= 0:              ${statsHpZeroOrBelow}`);
console.log(`  Ditto appearances:          ${dittoAppearances}`);
console.log(`  Cosmetic forme resolutions: ${cosmeticFormeResolutions}`);

const failed = (
  teamsWrongSize > 0 ||
  missingTeraType > 0 ||
  movesLessThanOne > 0 ||
  invalidLevel > 0 ||
  calcConstructorFailures > 0 ||
  statsHpZeroOrBelow > 0
);

if (failed) {
  console.log("\nFAIL: One or more validations failed (see counts above).");
  process.exit(1);
} else {
  console.log("\nPASS: All validations passed.");
  process.exit(0);
}
