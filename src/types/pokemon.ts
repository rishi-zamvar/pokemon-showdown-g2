/**
 * Pokemon data interfaces for typed access to PS data files.
 *
 * Field names match the actual Pokemon Showdown JSON structure.
 * PS typechart damageTaken encoding: 0=1x, 1=2x(super), 2=0.5x(resist), 3=0x(immune)
 * PS data keys are lowercase slugs (e.g. "pikachu", "thunderbolt")
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export type StatName = "hp" | "atk" | "def" | "spa" | "spd" | "spe";

export interface BaseStats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

/** PS isNonstandard values observed in data */
export type NonStandardReason =
  | "Past"
  | "Future"
  | "Unobtainable"
  | "Cap"
  | "Custom"
  | "Gigantamax";

// ---------------------------------------------------------------------------
// PokemonEntry — matches pokedex.json entries
// ---------------------------------------------------------------------------

export interface PokemonEntry {
  num: number;
  name: string;
  types: string[];
  baseStats: BaseStats;
  abilities: Record<string, string>;

  // Optional forme / species fields
  baseSpecies?: string;
  forme?: string;
  isNonstandard?: NonStandardReason;
  /** true or a string (base species name) when the pokemon only exists in battle */
  battleOnly?: boolean | string;

  // Physical / breeding
  genderRatio?: { M: number; F: number };
  gender?: string;
  heightm?: number;
  weightkg?: number;
  color?: string;
  eggGroups?: string[];

  // Evolution chain
  prevo?: string;
  evos?: string[];
  evoLevel?: number;
  evoType?: string;
  evoItem?: string;
  evoMove?: string;
  evoCondition?: string;

  // Item / move requirements
  requiredItem?: string;
  requiredItems?: string[];
  requiredMove?: string;
  requiredAbility?: string;

  // Competitive metadata
  tier?: string;
  doublesTier?: string;
  natDexTier?: string;

  // Tags / flags
  tags?: string[];
  canGigantamax?: string;
  canTerastallize?: boolean;
  cosmeticFormes?: string[];
  otherFormes?: string[];
  changesFrom?: string;

  // Generation
  gen?: number;
}

// ---------------------------------------------------------------------------
// MoveSecondaryEffect — typed secondary effect on move entries
// ---------------------------------------------------------------------------

export interface MoveSecondaryEffect {
  chance: number;
  status?: string;
  boosts?: Partial<Record<StatName, number>>;
  volatileStatus?: string;
  self?: { boosts?: Partial<Record<StatName, number>> };
}

// ---------------------------------------------------------------------------
// MoveEntry — matches moves.json entries
// ---------------------------------------------------------------------------

export interface MoveEntry {
  num: number;
  name: string;
  type: string;
  category: "Physical" | "Special" | "Status";
  basePower: number;
  /** true means "always hits"; a number is percentage accuracy */
  accuracy: number | true;
  pp: number;
  priority: number;
  target: string;

  // Optional effect fields
  flags?: Record<string, unknown>;
  secondary?: MoveSecondaryEffect | null;
  secondaries?: unknown[];
  self?: unknown;
  sideCondition?: string;
  weather?: string;
  terrain?: string;
  pseudoWeather?: string;
  volatileStatus?: string;
  status?: string;
  boosts?: Partial<Record<StatName, number>>;
  selfBoost?: { boosts?: Partial<Record<StatName, number>> };
  critRatio?: number;
  multihit?: number | [number, number];
  drain?: number[];
  recoil?: number[];
  heal?: number[];
  breaksProtect?: boolean;
  ignoreImmunity?: boolean | Record<string, boolean>;
  ignoreDefensive?: boolean;
  ignoreEvasion?: boolean;
  defensiveCategory?: string;
  zMove?: { basePower?: number; effect?: string; boost?: Partial<Record<StatName, number>> };
  maxMove?: { basePower: number };
  isZ?: string;
  isMax?: string | boolean;
  ohko?: boolean;

  // Nonstandard / competitive
  isNonstandard?: NonStandardReason;
  contestType?: string;
  desc?: string;
  shortDesc?: string;
}

// ---------------------------------------------------------------------------
// AbilityEntry — matches abilities.json entries
// ---------------------------------------------------------------------------

export interface AbilityEntry {
  num: number;
  name: string;
  rating?: number;
  flags?: Record<string, unknown>;
  isNonstandard?: NonStandardReason;
  desc?: string;
  shortDesc?: string;
}

// ---------------------------------------------------------------------------
// ItemEntry — matches items.json entries
// ---------------------------------------------------------------------------

export interface ItemEntry {
  num: number;
  name: string;
  spritenum?: number;
  gen?: number;
  isNonstandard?: NonStandardReason;
  flags?: Record<string, unknown>;

  // Berry / held item effects
  isBerry?: boolean;
  naturalGift?: { basePower: number; type: string };
  fling?: { basePower: number; status?: string; volatileStatus?: string };
  onPlate?: string;
  zMove?: string | boolean;
  zMoveFrom?: string;
  zMoveType?: string;
  itemUser?: string[];
  megaStone?: Record<string, string>;
  megaEvolves?: string;

  boosts?: Partial<Record<StatName, number>>;
  ignoreKlutz?: boolean;

  desc?: string;
  shortDesc?: string;
}

// ---------------------------------------------------------------------------
// TypeChart — matches typechart.json
//
// Keys are lowercase type names (e.g. "fire", "water").
// damageTaken keys are Title-cased (e.g. "Fire", "Water").
// Encoding: 0=1x (neutral), 1=2x (super-effective), 2=0.5x (resist), 3=0x (immune)
// ---------------------------------------------------------------------------

export interface TypeEntry {
  damageTaken: Record<string, 0 | 1 | 2 | 3>;
  HPivs?: Partial<Record<StatName, number>>;
  HPdvs?: Partial<Record<StatName, number>>;
}

export type TypeChart = Record<string, TypeEntry>;
