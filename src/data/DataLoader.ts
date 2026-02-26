/**
 * DataLoader — module-level singleton for typed O(1) access to PS data files.
 *
 * All Maps are built once at module load time. Callers receive references to
 * pre-built Maps; there is no lazy loading or rebuilding.
 *
 * PS data key convention: lowercase slugs (e.g. "pikachu", "thunderbolt").
 * Callers are responsible for normalising input to lowercase before lookup.
 */

import type {
  PokemonEntry,
  MoveEntry,
  AbilityEntry,
  ItemEntry,
  TypeChart,
} from "../types/pokemon.js";

// ---------------------------------------------------------------------------
// Static JSON imports — bundler (Vite) resolves these at build time
// ---------------------------------------------------------------------------

import pokedexRaw from "./pokedex.json" with { type: "json" };
import movesRaw from "./moves.json" with { type: "json" };
import abilitiesRaw from "./abilities.json" with { type: "json" };
import itemsRaw from "./items.json" with { type: "json" };
import typechartRaw from "./typechart.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Map construction — runs once when this module is first imported
// ---------------------------------------------------------------------------

const _pokedex: Map<string, PokemonEntry> = new Map(
  Object.entries(pokedexRaw as unknown as Record<string, PokemonEntry>),
);

const _moves: Map<string, MoveEntry> = new Map(
  Object.entries(movesRaw as unknown as Record<string, MoveEntry>),
);

const _abilities: Map<string, AbilityEntry> = new Map(
  Object.entries(abilitiesRaw as unknown as Record<string, AbilityEntry>),
);

const _items: Map<string, ItemEntry> = new Map(
  Object.entries(itemsRaw as unknown as Record<string, ItemEntry>),
);

// TypeChart is a plain object keyed by lowercase type name
const _typechart: TypeChart = typechartRaw as unknown as TypeChart;

// ---------------------------------------------------------------------------
// Validate thresholds (minimum expected entry counts)
// ---------------------------------------------------------------------------

const MIN_POKEMON = 1000;
const MIN_MOVES = 900;
const MIN_ABILITIES = 200;
const MIN_ITEMS = 400;
const MIN_TYPES = 18;

// ---------------------------------------------------------------------------
// Exported singleton
// ---------------------------------------------------------------------------

export const DataLoader = {
  /**
   * Throw immediately if any data file is corrupt or undersized.
   * Call this once at app startup before any battle logic runs.
   */
  validate(): void {
    if (_pokedex.size < MIN_POKEMON) {
      throw new Error(
        `DataLoader: pokedex too small — got ${_pokedex.size}, expected >= ${MIN_POKEMON}`,
      );
    }
    if (_moves.size < MIN_MOVES) {
      throw new Error(
        `DataLoader: moves too small — got ${_moves.size}, expected >= ${MIN_MOVES}`,
      );
    }
    if (_abilities.size < MIN_ABILITIES) {
      throw new Error(
        `DataLoader: abilities too small — got ${_abilities.size}, expected >= ${MIN_ABILITIES}`,
      );
    }
    if (_items.size < MIN_ITEMS) {
      throw new Error(
        `DataLoader: items too small — got ${_items.size}, expected >= ${MIN_ITEMS}`,
      );
    }
    const typeCount = Object.keys(_typechart).length;
    if (typeCount < MIN_TYPES) {
      throw new Error(
        `DataLoader: typechart too small — got ${typeCount}, expected >= ${MIN_TYPES}`,
      );
    }
  },

  // -------------------------------------------------------------------------
  // Typed O(1) accessors
  // -------------------------------------------------------------------------

  /** Look up a Pokemon by its PS slug (e.g. "pikachu"). Returns undefined if not found. */
  getPokemon(id: string): PokemonEntry | undefined {
    return _pokedex.get(id);
  },

  /** Look up a move by its PS slug (e.g. "thunderbolt"). Returns undefined if not found. */
  getMove(id: string): MoveEntry | undefined {
    return _moves.get(id);
  },

  /** Look up an ability by its PS slug (e.g. "intimidate"). Returns undefined if not found. */
  getAbility(id: string): AbilityEntry | undefined {
    return _abilities.get(id);
  },

  /** Look up an item by its PS slug (e.g. "choicescarf"). Returns undefined if not found. */
  getItem(id: string): ItemEntry | undefined {
    return _items.get(id);
  },

  /** Return the full TypeChart object (19 types in Gen 9, including Stellar). */
  getTypechart(): TypeChart {
    return _typechart;
  },

  /** Return all Pokemon slugs (all formes, Megas, CAP, etc). */
  getAllPokemonIds(): string[] {
    return Array.from(_pokedex.keys());
  },

  /** Return all move slugs. */
  getAllMoveIds(): string[] {
    return Array.from(_moves.keys());
  },

  /**
   * Return only "standard" battle-usable Pokemon:
   *   - No isNonstandard flag (excludes Megas, CAP, Future, Unobtainable, etc.)
   *   - No battleOnly flag (excludes forme-changes that only exist mid-battle)
   *
   * Expected count: ~897 entries.
   */
  getStandardPokemon(): PokemonEntry[] {
    const result: PokemonEntry[] = [];
    for (const entry of _pokedex.values()) {
      if (!entry.isNonstandard && !entry.battleOnly) {
        result.push(entry);
      }
    }
    return result;
  },
} as const;
