/**
 * Battle types — interfaces for one Gen 9 random battle match.
 *
 * Intentionally self-contained: no imports from pokemon.ts or data layer.
 * BattlePokemon is the canonical in-memory representation of a team member
 * during a battle. It is produced by TeamGenerator.buildRandom() and consumed
 * by the battle engine and damage calculator.
 */

// ---------------------------------------------------------------------------
// StatsTable — the six battle stats, each as a number
// ---------------------------------------------------------------------------

export interface StatsTable {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

// ---------------------------------------------------------------------------
// BattlePokemon — one team member, fully resolved at team generation time
// ---------------------------------------------------------------------------

export interface BattlePokemon {
  /** Display name — always the base species (e.g. "Gastrodon", not "Gastrodon-East") */
  name: string;

  /** Exact forme name from @pkmn/randoms (e.g. "Gastrodon-East") — use for sprites */
  species: string;

  /**
   * Name safe for @smogon/calc constructor.
   * For cosmetic formes this is baseSpecies (e.g. "Gastrodon").
   * For non-cosmetic formes this equals species.
   */
  calcSpecies: string;

  /**
   * Move IDs as lowercase slugs (e.g. ["thunderbolt", "voltswitch"]).
   * Usually 4 moves; Ditto legitimately has 1 (Transform only).
   */
  moves: string[];

  /** Tera type — always present in Gen 9 random battle sets */
  teraType: string;

  /** Level assigned by @pkmn/randoms (variable per Pokemon, roughly 79-100) */
  level: number;

  /** Ability name as returned by @pkmn/randoms */
  ability: string;

  /** Held item name; empty string if none */
  item: string;

  /** Nature name; defaults to 'Hardy' (Gen 9 random sets omit nature) */
  nature: string;

  /** Gender: "M" | "F" | "N" */
  gender: string;

  /** EVs per stat */
  evs: StatsTable;

  /** IVs per stat */
  ivs: StatsTable;

  /** Final computed stats — populated via @smogon/calc Pokemon constructor */
  stats: StatsTable;
}
