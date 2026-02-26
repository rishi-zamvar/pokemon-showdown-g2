# Stack Research

**Domain:** Pokemon battle game for Even Realities G2 smart glasses
**Researched:** 2026-02-26
**Confidence:** HIGH (npm versions verified live; API patterns verified against official GitHub)

---

## Recommended Stack

### New Dependencies (Pokemon Battle Layer)

These are additions to the existing Even Hub SDK / Vite / TypeScript foundation.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@smogon/calc` | `0.10.0` | Damage calculation for all gens (1-9) | Official Smogon tool. Powers the real Showdown damage calculator UI. Supports Tera types (Gen 9), Z-moves (Gen 7), Dynamax (Gen 8). Ships all data internally — no external data files needed for damage math. ES module compatible, clean TypeScript exports. Works with Vite with zero configuration. |
| `@pkmn/randoms` | `0.10.6` | Random battle team generation for gen1–gen9 | Official extraction of Showdown's `RandomTeam` logic. `getTeamGenerator('gen9randombattle').getTeam()` returns a fully-built PokemonSet[] array with species, moves, EVs, item, tera type. Competes directly with rolling your own team builder, which would take weeks. |
| `@pkmn/img` | `0.3.3` | Sprite URL resolution for all gens | Returns CDN URL + dimensions + `pixelated` flag for any Pokemon in any generation. Handles the naming complexity (e.g. gen3frlg, gen2crystal-back, etc.). ~34KB compressed. No dependencies. |

### Existing Stack (Validated — Do Not Change)

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| `@evenrealities/even_hub_sdk` | `^0.0.7` | G2 glasses display + gesture events | Validated working |
| `vite` | `^6.0.0` | Build system | Validated working |
| `typescript` | `^5.7.0` | Type safety | Validated working |
| Local JSON data files | — | Pokedex, moves, learnsets, abilities, items, typechart | Already in `src/data/` |

---

## How to Use the Local Showdown Data Files

The project already has `resolveJsonModule: true` in `tsconfig.json` and `moduleResolution: bundler`. Vite natively handles JSON imports. No configuration changes needed.

```typescript
// Direct TypeScript import — works out of the box
import pokedex from './data/pokedex.json';
import moves from './data/moves.json';
import learnsets from './data/learnsets.json';
import abilities from './data/abilities.json';
import items from './data/items.json';

// Type assertions needed since the JSON shapes are not typed by default
const dex = pokedex as Record<string, PokemonData>;
const moveDb = moves as Record<string, MoveData>;
```

**Data file shapes (verified from inspection):**

`pokedex.json` — keyed by lowercase ID (e.g. `"bulbasaur"`):
```typescript
interface PokemonData {
  num: number;
  name: string;
  types: string[];
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  abilities: { '0': string; '1'?: string; 'H'?: string };
  genderRatio?: { M: number; F: number };
  tier?: string;
  evos?: string[];
  eggGroups: string[];
}
```

`moves.json` — keyed by lowercase ID (e.g. `"flamethrower"`):
```typescript
interface MoveData {
  num: number;
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  accuracy: number | true;
  pp: number;
  priority: number;
  target: string;
  flags: Record<string, 1>;
  isNonstandard?: string;  // "Past" = removed from current gen
}
```

`learnsets.json` — keyed by lowercase ID:
```typescript
interface LearnsetData {
  learnset: Record<string, string[]>; // moveid → ["9L1", "8M", ...] (gen+method codes)
}
```

**What the local files are used for in this project:**

- `pokedex.json` — team display (name, types, base stats for HP calculation)
- `moves.json` — building the 4-move attack menu per Pokemon
- `learnsets.json` — filtering which moves a Pokemon can know by generation
- `abilities.json` — deferred to v0.2
- `items.json` — deferred to v0.2

**What NOT to use local files for:** Damage calculation. Use `@smogon/calc` instead — it has its own internally-consistent data layer for all gens. Mixing the local files with `@smogon/calc`'s data creates version skew risk.

---

## Battle Engine Strategy

### Recommendation: @smogon/calc for damage + custom turn engine

**Do NOT use `@pkmn/sim`** for this project. Rationale below.

**Use `@smogon/calc` for damage calculation only**, combined with a small custom turn engine.

```typescript
import { calculate, Generations, Pokemon, Move } from '@smogon/calc';

const gen = Generations.get(9); // or 1-8 for older gens

const result = calculate(
  gen,
  new Pokemon(gen, 'Charizard', {
    level: 100,
    nature: 'Timid',
    evs: { spa: 252, spe: 252, hp: 4 },
  }),
  new Pokemon(gen, 'Blastoise', {
    level: 100,
  }),
  new Move(gen, 'Flamethrower'),
);

// Returns damage range as [min, max] array
const [minDmg, maxDmg] = result.range();
const avgDmg = Math.floor((minDmg + maxDmg) / 2);
```

For v0.1 scope (no abilities, no items, no status), the custom turn engine is ~200 lines:
- Pick move
- Calculate damage via `@smogon/calc`
- Apply damage to HP
- Check faint
- Handle switch

---

## Why NOT @pkmn/sim (Full Battle Simulator)

| Concern | Details |
|---------|---------|
| Bundle size | Full simulator ships all 9 gens of data + validation + stream infrastructure. Likely 5-10MB before minification — heavy for a glasses app. |
| Node polyfill requirement | `@pkmn/sim` uses Node-specific modules. Requires `vite-plugin-node-polyfills` which adds build complexity and known breakages at certain versions. |
| API complexity | Battle is run through streams (`BattleStreams`), a protocol layer designed for networked play. Requires parsing protocol messages to extract state — massive overkill for a single-player vs. AI game. |
| Overkill for v0.1 scope | v0.1 defers abilities, items, status effects. The sim validates all of these. You'd be fighting the engine to limit scope. |
| `@pkmn/randoms` still available standalone | You get the team generation benefit without the full sim. |

**`@pkmn/sim` is appropriate when:** you need a fully rules-compliant server-side simulator for multiplayer battles with all mechanics. That is not this project.

---

## Team Generation Strategy

### Recommendation: @pkmn/randoms

```typescript
import { TeamGenerators } from '@pkmn/randoms';

// Generate a gen9 random battle team
const generator = TeamGenerators.getTeamGenerator('gen9randombattle');
const team = generator.getTeam(); // Returns PokemonSet[]

// For older generations
const gen1Team = TeamGenerators.getTeamGenerator('gen1randombattle').getTeam();
```

**PokemonSet shape (what getTeam() returns):**
```typescript
interface PokemonSet {
  name: string;    // e.g. "Charizard"
  species: string;
  item: string;
  ability: string;
  moves: string[]; // exactly 4 moves
  nature: string;
  evs: StatsTable;
  ivs: StatsTable;
  level: number;
  teraType?: string; // Gen 9 only
}
```

This gives you everything needed to:
1. Display team on switch screen (name, level)
2. Show 4 moves on attack screen
3. Calculate damage with `@smogon/calc` (all fields map directly)

**Supported formats (verified from search and docs):**
- `gen1randombattle` through `gen9randombattle`
- `gen9randomdoublesbattle`, `gen9randombattlemonotype` (not needed for v0.1)

---

## Sprite Handling Strategy

### CDN Pattern (play.pokemonshowdown.com)

Sprites are hosted at: `https://play.pokemonshowdown.com/sprites/`

**Directory naming by generation (verified from CDN directory listing):**

| Generation | Front sprite dir | Back sprite dir | Notes |
|------------|-----------------|-----------------|-------|
| Gen 1 | `gen1/` | `gen1-back/` | 56x56 PNG |
| Gen 2 | `gen2/` | `gen2-back/` | includes `gen2-shiny/` |
| Gen 3 | `gen3/` | `gen3-back/` | includes `gen3rs`, `gen3frlg` variants |
| Gen 4 | `gen4/` | `gen4-back/` | |
| Gen 5 | `gen5/` | `gen5-back/` | also `gen5ani/` for animated GIFs |
| Gen 6+ | `dex/` | — | Higher res, not 8-bit |

**Sprite URL formula:**
```typescript
// Lowercase species name, hyphens for forms (e.g. "mr-mime", "nidoran-m")
const spriteUrl = (species: string, gen: number): string => {
  const id = species.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const dir = gen <= 5 ? `gen${gen}` : 'gen5'; // cap at gen5 for 8-bit look
  return `https://play.pokemonshowdown.com/sprites/${dir}/${id}.png`;
};
```

### Recommendation: @pkmn/img for URL generation (use as reference, not dependency)

`@pkmn/img` (v0.3.3) handles edge cases: form name normalization, shiny lookups, different subdirectories. But it is lightweight enough (~34KB) to include as a dependency if edge-case sprite names become a problem.

```typescript
import { Sprites } from '@pkmn/img';

const { url, w, h, pixelated } = Sprites.getPokemon('charizard', { gen: 'gen1' });
// url: "https://play.pokemonshowdown.com/sprites/gen1/charizard.png"
// w: 56, h: 56, pixelated: true
```

**Decision: Start with manual URL construction.** The formula above handles the vast majority of cases. Add `@pkmn/img` only if form name edge cases (Rotom formes, Mega evolutions, etc.) cause sprite 404s.

### G2 Display Constraint

The G2 display is 576x288 monochrome. Sprites render as images within the Even Hub SDK display. Gen 1 sprites (~56x56 PNG) and Gen 2-5 sprites are small enough. **Do not use animated GIFs** (`gen5ani/`) — the G2 SDK renders static images only.

Key rendering hint: apply `image-rendering: pixelated` CSS when displaying sprites in any browser preview/simulator context.

---

## Terastallization Implementation

Tera type is handled directly by `@smogon/calc`:

```typescript
const result = calculate(
  Generations.get(9),
  new Pokemon(gen, 'Charizard', {
    teraType: 'Dragon', // Player has Terastallized
  }),
  defender,
  move,
);
```

For v0.1 battle state, track `hasTerastallized: boolean` per Pokemon. Once used, it cannot be used again that battle. The damage calculator handles STAB recalculation automatically when `teraType` is set.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Recommended |
|----------|-------------|-------------|---------------------|
| Damage calculation | `@smogon/calc` | Roll your own from typechart.json | Would take weeks to implement correctly across 9 gens. `@smogon/calc` already handles gen-specific formula differences (Gen 1 special stat split, Gen 5 crit changes, etc.) |
| Team generation | `@pkmn/randoms` | Read from local learnsets.json | Learnsets tell you which moves a Pokemon can learn, not which moves Showdown selects for random battles. The random battle format uses curated move pools, not raw learnsets. |
| Full simulator | `@pkmn/sim` | `@smogon/calc` + custom engine | Too heavy, Node polyfill issues, stream-based API is overkill |
| Sprites | CDN URL construction | Download all sprites locally | CDN is simpler; local copies would add hundreds of MB to project |
| Sprites | CDN URL construction | PokeAPI sprites | Showdown CDN has the correct 8-bit pixel-art sprites by generation; PokeAPI has modern art |
| JSON data import | Vite native JSON import | `@pkmn/dex` | tsconfig already has `resolveJsonModule: true`; adding `@pkmn/dex` adds bundle weight for data already on disk |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `pokemon-showdown` (main npm package) | Server-side Node.js package not built for browsers; no ES module exports; heavy | `@smogon/calc` + `@pkmn/randoms` |
| `@pkmn/sim` | Requires Node polyfills in Vite, stream-based API, 5-10MB bundle, full validation overhead | `@smogon/calc` + custom turn engine |
| Rolling own damage calculator | Gen-specific formula differences (Gen 1 has no special split, etc.) are subtle and easy to get wrong | `@smogon/calc` |
| `gen5ani/` animated GIFs for sprites | G2 SDK renders static images; animated GIFs do not animate | `gen1/` through `gen5/` static PNGs |
| Importing the full `learnsets.json` for move assignment | Learnsets list every move ever learned — not curated battle sets | `@pkmn/randoms` which uses Showdown's actual random battle pools |

---

## Installation

```bash
# Battle engine additions
npm install @smogon/calc @pkmn/randoms

# Optional — add only if sprite URL edge cases cause 404s
npm install @pkmn/img
```

No changes needed to `vite.config.ts` or `tsconfig.json`. Both are already configured for ESM, bundler module resolution, and `resolveJsonModule`.

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| `@smogon/calc` | `0.10.0` | Vite 6, TypeScript 5.7, ES2022 | Last published May 2024. No breaking changes expected soon; project uses stable versions. |
| `@pkmn/randoms` | `0.10.6` | Vite 6, TypeScript 5.7 | Pairs with `@pkmn/sim@0.10.x` if sim is added later. Not needed to use randoms standalone. |
| `@pkmn/img` | `0.3.3` | Any bundler, no deps | Tiny package, no compatibility issues expected. |
| Local JSON imports | — | Vite natively supports JSON imports | `resolveJsonModule: true` already in tsconfig. |

---

## Sources

- `npm show @smogon/calc version` (live) — confirmed `0.10.0`
- `npm show @pkmn/randoms version` (live) — confirmed `0.10.6`
- `npm show @pkmn/img version` (live) — confirmed `0.3.3`
- https://github.com/smogon/damage-calc/blob/master/calc/src/index.ts — verified exports: `calculate`, `Generations`, `Pokemon`, `Move`, `Field`, `Result`, `calcStat`
- https://github.com/smogon/damage-calc — verified Gen 9 `teraType` property on Pokemon
- https://github.com/pkmn/ps/blob/main/sim/README.md — verified `@pkmn/sim` browser support, `@pkmn/randoms` as separate package
- https://github.com/pkmn/ps/blob/main/randoms/README.md — verified `TeamGenerators.getTeamGenerator(format).getTeam()` API
- https://play.pokemonshowdown.com/sprites/ — verified directory structure: `gen1/` through `gen5/`, `gen5ani/`, `dex/`
- https://play.pokemonshowdown.com/sprites/gen1/ — verified lowercase `pokemonname.png` naming convention
- Inspection of `src/data/pokedex.json` and `src/data/moves.json` — verified JSON structure and field names
- Inspection of `tsconfig.json` — confirmed `resolveJsonModule: true` and `moduleResolution: bundler` already set

---
*Stack research for: Pokemon Showdown random battle simulator on Even Realities G2 glasses*
*Researched: 2026-02-26*
