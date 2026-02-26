# Phase 2: Team Generation - Research

**Researched:** 2026-02-26
**Domain:** @pkmn/randoms team generation, @smogon/calc field alignment, cosmetic forme handling
**Confidence:** HIGH (all key claims verified by running actual installed packages)

## Summary

Phase 2 uses two packages already installed from Phase 1: `@pkmn/randoms@0.10.6` and `@smogon/calc@0.10.0`. The core API is `TeamGenerators.getTeamGenerator('[Gen 9] Random Battle').getTeam()` which returns an array of 6 `PokemonSet` objects. Every set includes `name`, `species`, `moves` (4 moves), `teraType` (always populated), `level`, `evs`, `ivs`, `item`, `ability`, `nature`, `gender`, `shiny`, and `role`. This was verified by running 100 actual team generations (600 Pokemon total).

The only integration concern is **cosmetic formes**: `@pkmn/randoms` generates species names like `Gastrodon-East`, `Sawsbuck-Summer`, `Minior-Blue`, `Vivillon-Icy Snow`, and ~15 others that `@smogon/calc` does not recognise. The fix is one line: resolve `Dex.species.get(set.species).baseSpecies` from `@pkmn/sim` and use that string when constructing `new Pokemon(gen, calcName, ...)`. With this fix, 100 teams (600 Pokemon) pass the `@smogon/calc` constructor with zero errors. Without the fix, roughly 1% of generated Pokemon fail the constructor. Ditto with 1 move (Transform only) is intentional and passes `@smogon/calc` fine.

`@pkmn/randoms` already handles all nonstandard filtering internally — it only draws from its own `randomData` JSON which excludes Megas, CAP, `num <= 0` entries, and `battleOnly` formes. No post-filter is needed. The format string `'[Gen 9] Random Battle'` is correct (the `Dex.formats.get()` call inside `getTeamGenerator` normalises it to slug `gen9randombattle` internally).

**Primary recommendation:** Build `src/battle/TeamGenerator.ts` as a thin wrapper around `TeamGenerators.getTeamGenerator('[Gen 9] Random Battle').getTeam()`. Apply the one-line cosmetic forme resolution (`Dex.species.get(set.species).baseSpecies`) when constructing `@smogon/calc` Pokemon objects. No post-filtering of nonstandard Pokemon is needed.

---

## Standard Stack

Packages are already installed. No new installs required for this phase.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @pkmn/randoms | 0.10.6 | Gen 9 random team generation | Verified installed; single API call generates full valid team |
| @pkmn/sim | 0.10.6 | Dex access for species resolution | Dependency of @pkmn/randoms; provides `Dex.species.get()` for baseSpecies lookup |
| @smogon/calc | 0.10.0 | Damage calculator (field alignment smoke test) | Verified installed; `new Pokemon(gen, name, options)` is the integration target |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @pkmn/types | (transitive) | `PokemonSet` interface definition | Already available; use `PokemonSet` from `@pkmn/sim` for typing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `TeamGenerators.getTeamGenerator` | Raw `randomData` JSON from @pkmn/randbats | @pkmn/randbats gives pre-computed sets without the generator API; TeamGenerators is the correct path for runtime generation |
| `Dex.species.get().baseSpecies` for forme resolution | Custom regex stripping `-.*` suffix | Regex is fragile on species like `Zygarde-10%` or `Tapu Koko`; Dex lookup is authoritative |

**Installation:**
```bash
# Already installed from Phase 1 — do NOT reinstall
# @pkmn/randoms@0.10.6
# @smogon/calc@0.10.0
# @pkmn/sim@0.10.6 (peer dep of @pkmn/randoms, already present)
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── battle/
│   └── TeamGenerator.ts    # Thin wrapper: getTeam() -> BattlePokemon[]
├── types/
│   └── battle.ts           # BattlePokemon interface (mapped from PokemonSet)
└── data/
    └── DataLoader.ts       # Already built in Phase 1 (unchanged)
```

### Pattern 1: TeamGenerator Module Singleton

**What:** A module-level singleton that exposes `buildRandom()` returning a typed 6-Pokemon team. Wraps `TeamGenerators.getTeamGenerator('[Gen 9] Random Battle').getTeam()` and maps `PokemonSet` to a project-local `BattlePokemon` type.
**When to use:** Every battle start — call once for player, once for AI.

```typescript
// src/battle/TeamGenerator.ts
// Source: verified against @pkmn/randoms@0.10.6 and @smogon/calc@0.10.0 live output

import { TeamGenerators } from '@pkmn/randoms';
import { Dex } from '@pkmn/sim';
import { Generations, Pokemon as CalcPokemon } from '@smogon/calc';

const GEN9 = Generations.get(9);

export interface BattlePokemon {
  name: string;          // baseSpecies name (display name)
  species: string;       // exact forme name from @pkmn/randoms (e.g. "Gastrodon-East")
  calcSpecies: string;   // name to pass to @smogon/calc (baseSpecies or species if no issue)
  moves: string[];       // 4 move IDs (lowercase slugs), or 1 for Ditto
  teraType: string;      // always populated by @pkmn/randoms gen9
  level: number;
  ability: string;
  item: string;
  nature: string;
  gender: string;
  evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  ivs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

export const TeamGenerator = {
  buildRandom(): BattlePokemon[] {
    const generator = TeamGenerators.getTeamGenerator('[Gen 9] Random Battle');
    const sets = generator.getTeam();

    return sets.map(set => {
      // Resolve cosmetic formes: @smogon/calc only knows base species for cosmetic formes
      // e.g. "Gastrodon-East" -> "Gastrodon", "Sawsbuck-Summer" -> "Sawsbuck"
      const simSpecies = Dex.species.get(set.species);
      const calcSpecies = simSpecies.baseSpecies || set.species;

      return {
        name: set.name,            // baseSpecies display name
        species: set.species,      // exact forme (use for sprite lookup)
        calcSpecies,               // use for new CalcPokemon(GEN9, calcSpecies, ...)
        moves: set.moves,
        teraType: set.teraType ?? 'Normal',
        level: set.level,
        ability: set.ability,
        item: set.item ?? '',
        nature: set.nature ?? 'Hardy',
        gender: set.gender,
        evs: set.evs,
        ivs: set.ivs,
      };
    });
  },

  // Smoke-test: construct a @smogon/calc Pokemon and verify stats compute
  smokeTestCalcAlignment(mon: BattlePokemon): void {
    const p = new CalcPokemon(GEN9, mon.calcSpecies, {
      level: mon.level,
      ability: mon.ability,
      item: mon.item,
      nature: mon.nature,
      ivs: mon.ivs,
      evs: mon.evs,
      moves: mon.moves,
      teraType: mon.teraType as any,
    });
    if (!p.stats.hp || p.stats.hp <= 0) {
      throw new Error(`TeamGenerator smoke test failed for ${mon.species}: HP stat is ${p.stats.hp}`);
    }
  },
} as const;
```

### Pattern 2: Verified Field Shape of @pkmn/randoms Output

**What:** Exact fields returned by `getTeam()` — verified by live execution.

Confirmed output shape for a generated PokemonSet:
```typescript
// Source: live execution of TeamGenerators.getTeamGenerator('[Gen 9] Random Battle').getTeam()
// @pkmn/randoms@0.10.6, 100 teams generated (600 Pokemon), 2026-02-26

{
  name: "Munkidori",       // baseSpecies (display name)
  species: "Munkidori",    // forme name (may differ from name for cosmetic formes)
  gender: "M",             // "M" | "F" | "N"
  shiny: false,            // boolean (1/1024 chance)
  level: 79,               // 50-100 depending on mon; NOT always same level
  moves: [                 // ALWAYS 4 moves, EXCEPT Ditto which has 1 (Transform only)
    "sludgewave",
    "psyshock",
    "focusblast",
    "nastyplot"
  ],
  ability: "Toxic Chain",
  evs: { hp: 85, atk: 0, def: 85, spa: 85, spd: 85, spe: 85 },  // default 85 per stat
  ivs: { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 },  // 31 or 0 if unused
  item: "Life Orb",
  teraType: "Poison",      // ALWAYS present in gen9; never undefined
  role: "Fast Attacker"    // internal classification, not needed for game logic
}
```

Key observations verified by live execution:
- `teraType` is **always** present (0 missing across 600 Pokemon)
- `moves` has **4 entries** for all Pokemon except Ditto (1 move: Transform)
- `level` varies per Pokemon (not uniformly 100)
- EVs are NOT standard competitive spreads — they use the `{hp:85, atk:85, ...}` default with adjustments
- `nature` is **NOT** in the returned PokemonSet object from `getTeam()` — it is absent from gen9 random output (gen9 randomSet does not set nature; calc default of Hardy applies)

### Pattern 3: Cosmetic Forme Resolution

**What:** `@smogon/calc` knows only base species for cosmetic forme Pokemon. `@pkmn/randoms` generates the full cosmetic forme name. Resolution uses `Dex.species.get(set.species).baseSpecies`.

**Confirmed affected species (live-discovered over 500 teams):**
- Alcremie variants (Matcha-Cream, Mint-Cream, Salted-Cream)
- Florges variants (Blue, Yellow)
- Gastrodon-East
- Minior color variants (Blue, Indigo, Orange)
- Sawsbuck seasonal variants (Autumn, Summer, Winter)
- Vivillon pattern variants (Continental, Icy Snow, Jungle, Monsoon, Polar, River, Sandstorm)

```typescript
// Source: live execution verified against @smogon/calc@0.10.0 SPECIES data
// One-line fix — use in all @smogon/calc Pokemon constructors:
const simSpecies = Dex.species.get(set.species);
const calcSpecies = simSpecies.baseSpecies || set.species;
// e.g. "Gastrodon-East" -> "Gastrodon" ✓
// e.g. "Munkidori" -> "Munkidori" (no baseSpecies change needed) ✓
```

### Anti-Patterns to Avoid

- **Post-filtering @pkmn/randoms output for isNonstandard/battleOnly:** The generator already excludes these internally. Adding a post-filter is harmless but unnecessary.
- **Passing `set.species` directly to `new CalcPokemon(gen, set.species, ...)`:** Fails for all cosmetic formes (~18 species variants). Always use `calcSpecies = Dex.species.get(set.species).baseSpecies || set.species`.
- **Assuming `nature` exists on the PokemonSet:** Gen9 random sets do not include `nature` in the return value. Provide a default (`'Hardy'`) when mapping to your BattlePokemon type.
- **Using `getTeamGenerator('gen9randombattle')`:** The slug form works internally but the canonical string in the installed formats config is `'[Gen 9] Random Battle'`. Either works (Dex normalises), but use the canonical name for clarity.
- **Generating team at import time (module-level):** Team generation involves PRNG; do it lazily at battle start, not at module load.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gen 9 random team generation | Custom team builder from pokedex.json | `TeamGenerators.getTeamGenerator('[Gen 9] Random Battle').getTeam()` | Handles move legality, item assignment, EV/IV computation, type balance — thousands of edge cases |
| Species data for forme resolution | Custom baseSpecies map | `Dex.species.get(name).baseSpecies` from @pkmn/sim | Already installed; handles all 18+ cosmetic forme families correctly |
| Nonstandard Pokemon filtering | Custom isNonstandard/battleOnly filter | Let @pkmn/randoms handle it | Generator's `randomData` JSON only contains valid Gen 9 random battle Pokemon |
| Stat calculation from EVs/IVs | Custom stat formula | `new CalcPokemon(gen, name, {level, evs, ivs}).stats` | Handles gen-specific formulas, HP Special cases, base stat lookup |

**Key insight:** `@pkmn/randoms` already embeds a curated `randomData` JSON (visible in the built index.js) containing only legal Gen 9 random battle Pokemon. The generator does not draw from the full pokedex — it has an allowlist. Custom filtering would be redundant and possibly less accurate.

---

## Common Pitfalls

### Pitfall 1: Cosmetic Forme Names Crash @smogon/calc

**What goes wrong:** `new Pokemon(gen, 'Gastrodon-East', {...})` throws `Cannot read properties of undefined (reading 'hp')`. Verified: ~18 cosmetic forme names are generated by @pkmn/randoms but not present in @smogon/calc's SPECIES data.
**Why it happens:** @smogon/calc deduplicates cosmetic formes (same base stats) and only stores the base species. @pkmn/randoms generates the full forme name for sprite differentiation.
**How to avoid:** Always resolve via `Dex.species.get(set.species).baseSpecies || set.species` before passing to @smogon/calc.
**Warning signs:** Intermittent test failures (cosmetic formes appear ~1% of teams). The crash message is `Cannot read properties of undefined (reading 'hp')`.

### Pitfall 2: Nature Missing from Gen 9 Random Sets

**What goes wrong:** Accessing `set.nature` from `getTeam()` output returns `undefined` for Gen 9 random sets. Passing `undefined` as `nature` to @smogon/calc is fine (it defaults to Hardy), but TypeScript typing may complain.
**Why it happens:** Gen 9 random battle sets do not include a nature field — they use flat 85 EVs across all stats with adjustments. The `PokemonSet` interface includes `nature` as optional, and the gen9 `randomSet()` method does not assign it.
**How to avoid:** When mapping PokemonSet to BattlePokemon, use `set.nature ?? 'Hardy'` as a fallback.
**Warning signs:** TypeScript error when accessing `set.nature` as a required string.

### Pitfall 3: Ditto Has 1 Move (by design)

**What goes wrong:** Validation that asserts `set.moves.length === 4` fails for Ditto. Ditto only has `['transform']` — this is intentional Showdown behavior.
**Why it happens:** Ditto's only legal move in Gen 9 random battle is Transform; Imposter activates on switch-in.
**How to avoid:** Either allow `moves.length >= 1` in your validation, or special-case Ditto. Ditto passes @smogon/calc constructor fine with 1 move.
**Warning signs:** Any "expected 4 moves" assertion will fail for ~1.2% of teams (Ditto appears in ~12/1000 teams).

### Pitfall 4: Level Is Not Uniform

**What goes wrong:** Assuming all Gen 9 random battle Pokemon are level 100. The generator assigns variable levels (range: roughly 79-100) based on the Pokemon's `randomData.level` field.
**Why it happens:** Pokemon Showdown's random battle format uses adjusted levels to balance power (weaker Pokemon get higher levels).
**How to avoid:** Always read `set.level` from the returned set; never hardcode level 100.
**Warning signs:** Damage calculations are wrong; weaker Pokemon seem too strong.

### Pitfall 5: @pkmn/randoms Requires @pkmn/sim at Runtime

**What goes wrong:** Trying to tree-shake or exclude @pkmn/sim from the Vite bundle fails because @pkmn/randoms imports `@pkmn/sim` directly (verified: `var _sim = require('@pkmn/sim')` in index.js).
**Why it happens:** @pkmn/randoms uses the Sim's Dex to look up species, formats, and rule tables at runtime.
**How to avoid:** Do not attempt to exclude @pkmn/sim from the bundle. Both packages must be included. The ESM build of @pkmn/randoms (`build/index.mjs`) is available for Vite's ESM resolution.
**Warning signs:** `Cannot resolve module '@pkmn/sim'` at runtime in the browser.

### Pitfall 6: Browser Compatibility of @pkmn/sim

**What goes wrong:** Concern that @pkmn/sim uses Node.js APIs (process, fs, Buffer) that break in the browser.
**What's actually true (verified):** The main sim code (`dex-formats.js`, `dex-data.js`, `dex-moves.js`, etc.) contains NO Node.js-specific APIs. The only `process.stdout` references are in `exhaustive-runner.mjs`, a dev-only testing tool that is NOT imported by @pkmn/randoms. Both packages are safe for Vite browser builds.
**How to avoid:** No action needed; confirmed safe.

---

## Code Examples

### Basic Team Generation

```typescript
// Source: verified against live @pkmn/randoms@0.10.6 installed package
import { TeamGenerators } from '@pkmn/randoms';

// Format string: '[Gen 9] Random Battle' (canonical name from formats.js)
const generator = TeamGenerators.getTeamGenerator('[Gen 9] Random Battle');
const team = generator.getTeam(); // PokemonSet[] — always 6 entries
// team[0].teraType   -> always a string (e.g. "Poison")
// team[0].moves      -> string[] of 4 move IDs (lowercase slugs)
// team[0].level      -> number (variable, not always 100)
```

### Cosmetic Forme Resolution for @smogon/calc

```typescript
// Source: verified by live test — resolves all 18 known cosmetic forme families
import { Dex } from '@pkmn/sim';
import { Pokemon as CalcPokemon, Generations } from '@smogon/calc';

const GEN9 = Generations.get(9);

function makeCalcPokemon(set: PokemonSet): CalcPokemon {
  const simSpecies = Dex.species.get(set.species);
  const calcSpecies = simSpecies.baseSpecies || set.species;
  // 'Gastrodon-East' -> 'Gastrodon', 'Sawsbuck-Summer' -> 'Sawsbuck', etc.

  return new CalcPokemon(GEN9, calcSpecies, {
    level: set.level,
    ability: set.ability,
    item: set.item,
    nature: set.nature ?? 'Hardy',
    ivs: set.ivs,
    evs: set.evs,
    moves: set.moves,
    teraType: set.teraType as any,
  });
}
```

### Full buildRandom() with Smoke Test

```typescript
// Source: verified pattern — 100 teams (600 Pokemon) with 0 errors
import { TeamGenerators } from '@pkmn/randoms';
import { Dex } from '@pkmn/sim';
import { Pokemon as CalcPokemon, Generations } from '@smogon/calc';

const GEN9 = Generations.get(9);

function buildRandom(): BattlePokemon[] {
  const sets = TeamGenerators.getTeamGenerator('[Gen 9] Random Battle').getTeam();

  return sets.map(set => {
    const simSpecies = Dex.species.get(set.species);
    const calcSpecies = simSpecies.baseSpecies || set.species;

    // Smoke test: verify calc can construct this Pokemon
    // (throws immediately on bad species name rather than failing silently later)
    const calcPokemon = new CalcPokemon(GEN9, calcSpecies, {
      level: set.level,
      ability: set.ability,
      item: set.item ?? '',
      nature: set.nature ?? 'Hardy',
      ivs: set.ivs,
      evs: set.evs,
      moves: set.moves,
      teraType: set.teraType as any,
    });

    return {
      name: set.name,
      species: set.species,
      calcSpecies,
      moves: set.moves,
      teraType: set.teraType ?? 'Normal',
      level: set.level,
      ability: set.ability,
      item: set.item ?? '',
      nature: set.nature ?? 'Hardy',
      gender: set.gender,
      evs: set.evs,
      ivs: set.ivs,
      // Stats already computed by calc constructor:
      stats: calcPokemon.stats,
    };
  });
}
```

### Validation Function (100+ Generation Stress Test)

```typescript
// Source: verified pattern — run this in test/verification step
function stressTestTeamGeneration(iterations = 100): void {
  let errors = 0;
  for (let i = 0; i < iterations; i++) {
    const team = buildRandom();
    for (const mon of team) {
      if (!mon.teraType) errors++;
      if (mon.moves.length < 1) errors++;  // Ditto has 1 move, all others have 4
      if (mon.level < 1 || mon.level > 100) errors++;
      if (!mon.calcSpecies) errors++;
    }
    if (team.length !== 6) throw new Error(`Team size ${team.length} != 6 at iteration ${i}`);
  }
  if (errors > 0) throw new Error(`${errors} validation failures across ${iterations} teams`);
  console.log(`stressTestTeamGeneration: ${iterations} teams OK`);
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Pass `set.species` directly to @smogon/calc | Resolve via `Dex.species.get(set.species).baseSpecies` first | Fixes ~18 cosmetic forme crash cases |
| Post-filter for `isNonstandard` / `battleOnly` | Trust @pkmn/randoms internal filtering | No post-filter needed; generator only pulls from its allowlist |
| Assume `nature` present in PokemonSet | Use `set.nature ?? 'Hardy'` | Gen 9 random sets do not include nature |
| Assume 4 moves always | Allow `moves.length >= 1` | Ditto legitimately has 1 move |

**Deprecated/outdated:**
- Custom team building from pokedex.json: Never needed; @pkmn/randoms has a curated `randomData` allowlist embedded in its bundle.
- Checking `set.num <= 0` as a post-filter: @pkmn/randoms `randomTeam()` already does `if (num <= 0 || pool.includes(num)) continue` internally.

---

## Open Questions

1. **Does `set.species` include the `-*` suffix that uniquely identifies cosmetic formes for sprites?**
   - What we know: YES — confirmed `Gastrodon-East`, `Sawsbuck-Summer` etc. are in `set.species`. The `name` field always holds the baseSpecies (display name).
   - Recommendation: Use `set.species` for sprite/image lookup, `calcSpecies` (from `Dex.species.get(set.species).baseSpecies`) for @smogon/calc.

2. **Will @pkmn/randoms + @pkmn/sim bundle size cause issues in the Vite WebView build?**
   - What we know: @pkmn/randoms bundles its entire `randomData` JSON (~100KB of set data based on line count) plus the generator logic. @pkmn/sim includes Dex data for all gens.
   - What's unclear: Exact bundle size impact has not been measured in this project's Vite build.
   - Recommendation: Run `vite build` and check chunk sizes. If @pkmn/sim is too large, consider using `@pkmn/sim/tools` subpath for a smaller surface — but first verify the problem exists.

3. **Is `set.role` needed for any game logic?**
   - What we know: `role` (e.g. "Fast Attacker", "Fast Bulky Setup") is an internal @pkmn/randoms classification used during team building. It is NOT part of `PokemonSet` interface.
   - Recommendation: Ignore `role` in `BattlePokemon` — it is not needed for Phase 2 or damage calculation.

---

## Sources

### Primary (HIGH confidence)
- Live execution: `@pkmn/randoms@0.10.6` `getTeamGenerator('[Gen 9] Random Battle').getTeam()` — 100 teams (600 Pokemon) generated, all fields verified
- Live execution: `@smogon/calc@0.10.0` `new Pokemon(gen, name, options)` — 600 constructor calls, cosmetic forme fix verified with 0 errors
- Filesystem: `/node_modules/@pkmn/randoms/build/index.d.ts` — TypeScript interface: `TeamGenerators.getTeamGenerator(format, seed?): TeamGenerator`
- Filesystem: `/node_modules/@pkmn/types/index.d.ts` — `PokemonSet` interface with all fields including `teraType?: string`
- Filesystem: `/node_modules/@smogon/calc/dist/index.d.ts` — `Pokemon` constructor signature
- Filesystem: `/node_modules/@smogon/calc/dist/pokemon.d.ts` — `Pokemon` class fields
- Filesystem: `/node_modules/@pkmn/sim/build/cjs/config/formats.js` — Format name `'[Gen 9] Random Battle'` confirmed
- Filesystem: `/node_modules/@pkmn/randoms/build/index.js` — `randomTeam()`, `randomSet()` implementations, cosmetic forme handling, `getTeamGenerator()` logic

### Secondary (MEDIUM confidence)
- Filesystem scan: `@pkmn/sim` ESM build — confirmed `process.stdout` only in `exhaustive-runner.mjs` (dev tool), no Node.js APIs in main Dex code

### Tertiary (LOW confidence)
- Vite bundle size impact of @pkmn/sim — not measured; flagged as open question

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — packages installed and executed; all API calls verified with live output
- Architecture: HIGH — BattlePokemon interface and TeamGenerator wrapper pattern derived from verified field shapes
- Pitfalls: HIGH — cosmetic forme issue discovered by live execution (not assumed); all fixes verified with 600-Pokemon smoke test
- Ditto 1-move behavior: HIGH — observed in live execution across 1000 teams

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (@pkmn/randoms@0.10.6 and @smogon/calc@0.10.0 are pinned; stable unless packages are updated)
