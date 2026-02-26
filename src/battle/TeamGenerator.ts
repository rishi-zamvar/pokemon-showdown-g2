/**
 * TeamGenerator — module singleton for Gen 9 random battle team generation.
 *
 * Pattern: module-level singleton (same as DataLoader — `export const` object, not class).
 * Team generation is lazy: buildRandom() runs the PRNG at call time, not at module load.
 *
 * Key integration points:
 *   @pkmn/randoms  — TeamGenerators.getTeamGenerator('[Gen 9] Random Battle').getTeam()
 *   @pkmn/sim      — Dex.species.get(set.species).baseSpecies for cosmetic forme resolution
 *   @smogon/calc   — new CalcPokemon(GEN9, calcSpecies, options) for computed stats
 *
 * Cosmetic forme resolution:
 *   @pkmn/randoms generates species like "Gastrodon-East", "Sawsbuck-Summer", "Minior-Blue".
 *   @smogon/calc only knows the base species for cosmetic formes.
 *   Fix: always pass Dex.species.get(set.species).baseSpecies to the CalcPokemon constructor.
 */

import { TeamGenerators } from "@pkmn/randoms";
import { Dex } from "@pkmn/sim";
import { Generations, Pokemon as CalcPokemon } from "@smogon/calc";
import type { BattlePokemon } from "../types/battle.js";

// ---------------------------------------------------------------------------
// Module-level constants — resolved once, not per call
// ---------------------------------------------------------------------------

const GEN9 = Generations.get(9);

// ---------------------------------------------------------------------------
// Exported singleton
// ---------------------------------------------------------------------------

export const TeamGenerator = {
  /**
   * Generate a full 6-Pokemon Gen 9 random battle team.
   *
   * Calls @pkmn/randoms to get PokemonSets, resolves cosmetic formes via
   * @pkmn/sim Dex lookup, and computes final stats via @smogon/calc constructor.
   *
   * Returns exactly 6 BattlePokemon objects. Each has all fields populated;
   * stats are computed final values (not base stats).
   *
   * Call once per team at battle start (player team + AI team = 2 calls).
   * Do NOT call at import time — team generation involves PRNG.
   */
  buildRandom(): BattlePokemon[] {
    const generator = TeamGenerators.getTeamGenerator("[Gen 9] Random Battle");
    const sets = generator.getTeam();

    return sets.map(set => {
      // Resolve cosmetic formes: @smogon/calc only knows base species for cosmetic formes.
      // e.g. "Gastrodon-East" -> "Gastrodon", "Sawsbuck-Summer" -> "Sawsbuck"
      // Non-cosmetic formes (Rotom-Heat, Zygarde-10%) keep their original name.
      const simSpecies = Dex.species.get(set.species);
      const calcSpecies = simSpecies.baseSpecies || set.species;

      // Construct CalcPokemon to compute final stats from EVs/IVs/level/nature.
      // The constructor throws immediately for unknown species — better than silent failure.
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
        name: set.name,            // base species display name (e.g. "Gastrodon")
        species: set.species,      // exact forme name — use for sprite lookup
        calcSpecies,               // base species for @smogon/calc — same as name for most
        moves: set.moves,          // lowercase slug IDs; 4 for most, 1 for Ditto (Transform)
        teraType: set.teraType ?? "Normal",
        level: set.level,          // variable (roughly 79-100); NOT always 100
        ability: set.ability,
        item: set.item ?? "",
        nature: set.nature ?? "Hardy",  // Gen 9 random sets omit nature; default to Hardy
        gender: set.gender,
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
      };
    });
  },
} as const;
