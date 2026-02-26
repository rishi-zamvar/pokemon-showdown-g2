# Phase 1: Data Foundation - Research

**Researched:** 2026-02-26
**Domain:** Pokemon Showdown data files, TypeScript singleton, Vite JSON loading
**Confidence:** HIGH (all key claims verified against live sources or filesystem)

## Summary

Phase 1 has three distinct sub-problems: (1) re-fetching three broken data files from the correct CDN endpoint, (2) building a typed singleton with O(1) lookups, and (3) making learnsets.json non-blocking given its 3.19 MB size.

The three broken files (abilities.json, items.json, typechart.json) are confirmed 404 HTML pages on disk. The correct source is `https://play.pokemonshowdown.com/data/` which serves `abilities.js`, `items.js`, and `typechart.js` as CommonJS files (`exports.BattleAbilities = {...}`, `exports.BattleItems = {...}`, `exports.BattleTypeChart = {...}`). The fix is a one-time Node.js fetch script that strips the CommonJS wrapper via the `vm` module and writes valid JSON to disk. No npm install is required for this step.

The @pkmn/randoms package (confirmed live on npm) provides `TeamGenerators.getTeamGenerator(format).getTeam()` for all random battle formats. The @smogon/calc package (0.10.0, last updated May 2024) provides the damage formula. Neither of these needs to be installed in Phase 1 — this phase is only about making data files valid and accessible; those packages are Phase 2+ concerns. The DataLoader singleton should be built now with the correct types so later phases can drop in.

For learnsets.json (3.19 MB), the correct approach is `fetch('/data/learnsets.json')` at battle start rather than a static `import`. This moves the file to `public/data/` so Vite does not bundle it, and the browser fetches it on demand. The @pkmn/randbats data at `https://data.pkmn.cc/randbats/gen9randombattle.json` is a valid alternative that delivers pre-computed sets (no learnset traversal needed) but is an external network dependency — keep as a fallback option, not the primary path.

**Primary recommendation:** Write a `scripts/fix-data.mjs` fetch script for the three broken files, move learnsets.json to `public/data/`, and build `src/data/DataLoader.ts` as a typed module-singleton backed by `Map<string, T>` for O(1) access.

---

## Standard Stack

### Core (already locked by prior decisions)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.7 (already installed) | Type safety for DataLoader | Already in project |
| Vite | 6.x (already installed) | Static JSON import + `public/` for large files | Already in project |
| Node.js vm module | built-in | Strip CommonJS wrapper from Showdown .js files | No install needed, safe eval in sandbox |

### To Install
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @pkmn/randoms | latest | Random team generation for all gens | Locked decision; auto-synced from Showdown source |
| @smogon/calc | 0.10.0 | Damage calculation | Locked decision; official Smogon calculator |

Note: @pkmn/randoms and @smogon/calc are locked decisions but are not exercised in Phase 1. Install them now so TypeScript can type-check against them, but their runtime use begins in later phases.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fetch()` for learnsets | Static `import learnsets from './learnsets.json'` | Static import bundles 3.19 MB into main chunk — unacceptable for WebView startup |
| `vm.runInNewContext` strip | Regex string replacement | Regex is fragile on minified JS; vm sandbox is reliable |
| Local learnsets.json | `https://data.pkmn.cc/randbats/gen9randombattle.json` | External network dependency; learnsets.json is already on disk |

**Installation:**
```bash
npm install @pkmn/randoms @smogon/calc
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── data/
│   ├── DataLoader.ts        # Typed singleton — the only consumer of data files
│   ├── pokedex.json         # 521 KB — static import (valid, needed at startup)
│   ├── moves.json           # 487 KB — static import (valid, needed at startup)
│   ├── abilities.json       # 3.7 KB — re-fetched and fixed; static import ok
│   ├── items.json           # 3.7 KB — re-fetched and fixed; static import ok
│   └── typechart.json       # 3.7 KB — re-fetched and fixed; static import ok
├── types/
│   └── pokemon.ts           # PokemonEntry, MoveEntry, TypeChart interfaces
scripts/
└── fix-data.mjs             # One-time fetch + strip script; run manually or in npm prepare
public/
└── data/
    └── learnsets.json       # 3.19 MB — NOT imported; served as static asset
```

### Pattern 1: Module Singleton (not class singleton)

**What:** Export a plain object or frozen module-level constant. TypeScript modules are singletons by definition — one import instance per bundler chunk.
**When to use:** For a data store that is read-only after initialization and needs no dependency injection.
**Why not class singleton:** Class singletons with `getInstance()` are harder to tree-shake, add boilerplate, and provide no benefit when the module itself enforces single instance.

```typescript
// src/data/DataLoader.ts
// Source: TypeScript module system guarantees single instance per bundle

import pokedexRaw from './pokedex.json' assert { type: 'json' };
import movesRaw from './moves.json' assert { type: 'json' };
import abilitiesRaw from './abilities.json' assert { type: 'json' };
import itemsRaw from './items.json' assert { type: 'json' };
import typechartRaw from './typechart.json' assert { type: 'json' };

import type { PokemonEntry, MoveEntry, AbilityEntry, ItemEntry, TypeChart } from '../types/pokemon';

// Build O(1) Maps at module load time
const _pokedex = new Map<string, PokemonEntry>(
  Object.entries(pokedexRaw as Record<string, PokemonEntry>)
);
const _moves = new Map<string, MoveEntry>(
  Object.entries(movesRaw as Record<string, MoveEntry>)
);
const _abilities = new Map<string, AbilityEntry>(
  Object.entries(abilitiesRaw as Record<string, AbilityEntry>)
);
const _items = new Map<string, ItemEntry>(
  Object.entries(itemsRaw as Record<string, ItemEntry>)
);
const _typechart = typechartRaw as TypeChart;

// Per-match data (populated at battle start, cleared at battle end)
let _matchPokemon: Map<string, PokemonEntry> | null = null;
let _matchLearnsets: Map<string, unknown> | null = null;

export const DataLoader = {
  // Startup validation — call once, throws on bad data
  validate(): void {
    if (_pokedex.size < 800) throw new Error('DataLoader: pokedex too small — possible 404 page');
    if (_moves.size < 900) throw new Error('DataLoader: moves too small — possible 404 page');
    if (_abilities.size === 0) throw new Error('DataLoader: abilities empty — possible 404 page');
    if (_items.size === 0) throw new Error('DataLoader: items empty — possible 404 page');
    if (Object.keys(_typechart).length < 18) throw new Error('DataLoader: typechart invalid — possible 404 page');
  },

  // Global lookups (O(1))
  getPokemon(id: string): PokemonEntry | undefined { return _pokedex.get(id); },
  getMove(id: string): MoveEntry | undefined { return _moves.get(id); },
  getAbility(id: string): AbilityEntry | undefined { return _abilities.get(id); },
  getItem(id: string): ItemEntry | undefined { return _items.get(id); },
  getTypechart(): TypeChart { return _typechart; },

  // Standard Pokemon filter: excludes isNonstandard and battleOnly
  getStandardPokemon(): PokemonEntry[] {
    const result: PokemonEntry[] = [];
    for (const entry of _pokedex.values()) {
      if (!entry.isNonstandard && !entry.battleOnly) result.push(entry);
    }
    return result;
  },

  // Per-match scoping
  async loadMatchData(pokemonIds: string[]): Promise<void> {
    _matchPokemon = new Map(
      pokemonIds
        .map(id => [id, _pokedex.get(id)] as [string, PokemonEntry | undefined])
        .filter((entry): entry is [string, PokemonEntry] => entry[1] !== undefined)
    );
    // Lazy-load learnsets only if needed for this match
    const raw = await fetch('/data/learnsets.json').then(r => r.json());
    _matchLearnsets = new Map(
      pokemonIds
        .filter(id => id in raw)
        .map(id => [id, raw[id]])
    );
  },

  clearMatchData(): void {
    _matchPokemon = null;
    _matchLearnsets = null;
  },

  getMatchPokemon(id: string): PokemonEntry | undefined {
    return _matchPokemon?.get(id);
  },
};
```

### Pattern 2: Fix Script — Fetch + Strip CommonJS

**What:** Node.js script that fetches the three .js files from Showdown CDN, strips the CommonJS wrapper using `vm.runInNewContext`, and writes clean JSON.
**When to use:** Run once as part of project setup; commit the resulting JSON files.

```javascript
// scripts/fix-data.mjs
// Source: verified against live https://play.pokemonshowdown.com/data/abilities.js
// CDN exports: exports.BattleAbilities, exports.BattleItems, exports.BattleTypeChart

import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { createContext, runInContext } from 'vm';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FILES = [
  {
    url: 'https://play.pokemonshowdown.com/data/abilities.js',
    exportKey: 'BattleAbilities',
    out: '../src/data/abilities.json',
  },
  {
    url: 'https://play.pokemonshowdown.com/data/items.js',
    exportKey: 'BattleItems',
    out: '../src/data/items.json',
  },
  {
    url: 'https://play.pokemonshowdown.com/data/typechart.js',
    exportKey: 'BattleTypeChart',
    out: '../src/data/typechart.json',
  },
];

for (const { url, exportKey, out } of FILES) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const js = await res.text();

  // Verify it's not a 404 HTML page
  if (js.trimStart().startsWith('<!')) {
    throw new Error(`${url} returned HTML — URL may have changed`);
  }

  // Strip CommonJS wrapper safely
  const sandbox = { exports: {} };
  runInContext(js, createContext(sandbox));

  const data = sandbox.exports[exportKey];
  if (!data || typeof data !== 'object') {
    throw new Error(`${exportKey} not found in ${url}`);
  }

  const outPath = join(__dirname, out);
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Wrote ${outPath} (${Object.keys(data).length} entries)`);
}
```

### Pattern 3: Learnsets in public/ — Lazy via fetch()

**What:** Move learnsets.json to `public/data/learnsets.json`. Vite copies `public/` files to the build output root as-is, without bundling. Fetch at battle start, extract only the 12 match Pokemon.
**When to use:** Any JSON file over ~500 KB that is not needed at app startup.

```typescript
// Only load learnsets when a battle starts, extract only what's needed
async function loadLearnsets(pokemonIds: string[]): Promise<Map<string, unknown>> {
  const raw = await fetch('/data/learnsets.json').then(r => r.json());
  return new Map(pokemonIds.filter(id => id in raw).map(id => [id, raw[id]]));
}
```

### Anti-Patterns to Avoid

- **Static import of learnsets.json from `src/data/`:** Vite will bundle it into the JS chunk. 3.19 MB into the main bundle destroys WebView startup time.
- **Importing raw JSON as `any`:** Loses all type safety; every caller must cast. Define interfaces in `src/types/pokemon.ts` and cast once in DataLoader.
- **`new Map(Object.entries(...))` on every lookup:** Build Maps once at module load, not on each access call.
- **Validate after first use:** Call `DataLoader.validate()` at app boot, before any game logic runs, so a bad data file surfaces immediately with a clear error message rather than a cryptic runtime failure.
- **Using class singleton with `getInstance()`:** Unnecessary ceremony; TypeScript module scope is a singleton.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Random team generation | Custom team builder from pokedex | @pkmn/randoms | Handles all gen formats, move legality, item assignment, IV/EV spreads — thousands of edge cases |
| Damage formula | Custom damage calc | @smogon/calc 0.10.0 | Handles gen-specific modifiers, critical hits, weather, terrain, burn/paralysis — do not recreate |
| TypeChart effectiveness | Custom multiplier table | The typechart.json data + lookup | Data already encodes damageTaken for all 18 types |
| Learnset legality | Custom learnset parser | learnsets.json + @pkmn/randoms | Learnset data is already in the file; @pkmn/randoms handles legality for team gen |

**Key insight:** The Showdown data files encode everything needed; the risk is in loading them incorrectly (bundling 3 MB, or using HTML 404 pages as data).

---

## Common Pitfalls

### Pitfall 1: Fetching the .json URL instead of the .js URL

**What goes wrong:** `https://play.pokemonshowdown.com/data/abilities.json` returns a 404 HTML page (confirmed). The correct URL is `abilities.js`.
**Why it happens:** The Showdown client serves compiled JS bundles, not raw JSON files, for these three data files. `pokedex.json` and `moves.json` happen to be served as JSON — but abilities, items, and typechart are not.
**How to avoid:** Always use the `.js` URL. Verify with a HEAD request that `Content-Type` is not `text/html` before writing to disk.
**Warning signs:** Written file starts with `<!DOCTYPE html>` — add a guard in the fix script (`if (js.trimStart().startsWith('<!')) throw`).

### Pitfall 2: The CommonJS wrapper contains function values

**What goes wrong:** Ability and item entries have function properties (e.g., `onModifyAtkPriority: -1`, `onDamagingHitOrder: 1`, callbacks). `JSON.stringify` silently drops function-valued keys.
**Why it happens:** Showdown .js files are the full simulation data including event handler hooks, not just stat data.
**How to avoid:** For Phase 1 this is acceptable — the DataLoader only needs `name`, `num`, `flags`, `rating`, `desc` from abilities/items. Function-valued keys will be dropped by JSON.stringify; verify the resulting JSON has the keys your code needs. If battle simulation hooks are needed later, use @pkmn/sim instead.
**Warning signs:** An ability entry has `name` and `num` but no `onStart` or similar — that is expected and correct behavior for this use case.

### Pitfall 3: Vite JSON import assertion syntax

**What goes wrong:** `import foo from './foo.json' assert { type: 'json' }` may warn in some TypeScript/Vite 6 configurations. Vite 6 supports JSON imports natively without the assertion.
**Why it happens:** The `assert` syntax is a Stage 3 proposal that TypeScript and Vite handle differently across versions.
**How to avoid:** In Vite 6 with TypeScript 5.7, plain `import foo from './foo.json'` works without the assertion. Add `"resolveJsonModule": true` to tsconfig if not already present. Test with `vite build` to confirm no warnings.
**Warning signs:** TypeScript error `TS1131: Property or signature expected` on the assert clause.

### Pitfall 4: isNonstandard filter is sufficient for Megas

**What goes wrong:** Developer writes a custom `forme.includes('Mega')` filter, missing other non-standard formes.
**Why it happens:** Mega formes are the most visible non-standard formes, leading to targeted filtering.
**How to avoid:** Filter on `!isNonstandard && !battleOnly`. Verified: ALL Mega formes in the current pokedex.json have `isNonstandard: 'Past'`. CAP Pokemon have `isNonstandard: 'CAP'`. Future formes have `isNonstandard: 'Future'`. The `battleOnly` field covers Castform weather forms, Cherrim Sunshine, Darmanitan-Zen, etc. Together these two checks correctly reduce 1,515 entries to 897 standard Pokemon.
**Warning signs:** Team generation produces Venusaur-Mega or Zygarde-Complete as options — the filter is wrong.

### Pitfall 5: learnsets.json fetch blocks battle start

**What goes wrong:** `await fetch('/data/learnsets.json')` takes 100-500ms on first load, stalling the battle start UI.
**Why it happens:** 3.19 MB fetch on a WebView over localhost is fast but not instant.
**How to avoid:** Start the fetch in parallel with other battle setup work. Show a "Generating teams..." status on the glasses while fetch is in progress. Only await the result when team gen actually needs learnset data. Alternatively, use @pkmn/randoms which handles learnsets internally — if @pkmn/randoms is used for team gen, learnsets.json may not be needed at all.
**Warning signs:** Battle start takes >500ms before first glass frame is shown.

---

## Code Examples

### Building Maps at Module Load

```typescript
// Source: TypeScript Map documentation + verified pattern
// Build once, look up O(1) forever
const _pokedex = new Map<string, PokemonEntry>(
  Object.entries(pokedexRaw as Record<string, PokemonEntry>)
);

// O(1) lookup
const mon = _pokedex.get('pikachu'); // undefined if not found
```

### Filtering Standard Pokemon

```typescript
// Source: verified against live pokedex.json
// isNonstandard values in current data: 'Past', 'LGPE', 'Future', 'Custom', 'CAP'
// battleOnly values: string (base species name) for forme-change Pokemon

function getStandardPokemon(pokedex: Map<string, PokemonEntry>): PokemonEntry[] {
  const result: PokemonEntry[] = [];
  for (const entry of pokedex.values()) {
    if (!entry.isNonstandard && !entry.battleOnly) {
      result.push(entry);
    }
  }
  return result;
  // Returns 897 entries from current pokedex.json
}
```

### Startup Assertion Guard

```typescript
// Call at app boot — before any game logic
DataLoader.validate();
// Throws immediately if data files are HTML 404 pages
// Good error: "DataLoader: abilities empty — possible 404 page"
// Bad: silent NaN in damage calc 3 seconds later
```

### Lazy-loading learnsets from public/

```typescript
// In vite.config.ts: public/ files are copied as-is, never bundled
// Place learnsets.json at public/data/learnsets.json

// At battle start:
const raw = await fetch('/data/learnsets.json').then(r => r.json());
// Extract only the 12 battle Pokemon
const matchLearnsets = new Map(
  battlePokemonIds
    .filter(id => id in raw)
    .map(id => [id, raw[id]])
);
// raw is now eligible for GC — only matchLearnsets is retained
```

### TypeChart Lookup Pattern

```typescript
// typechart.js exports: BattleTypeChart[type].damageTaken[otherType]
// damageTaken values: 0 = normal, 1 = immune, 2 = 0.5x, 3 = 2x

function getEffectiveness(attackType: string, defenseType: string, typechart: TypeChart): number {
  const entry = typechart[defenseType];
  if (!entry) return 1;
  const taken = entry.damageTaken[attackType];
  if (taken === 1) return 0;    // immune
  if (taken === 2) return 0.5;  // not very effective
  if (taken === 3) return 2;    // super effective
  return 1;                     // normal
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `import typechart from './typechart.json'` (HTML file) | Re-fetch from `.js` URL, strip wrapper, save clean JSON | Unblocks all type effectiveness code |
| Static import of learnsets.json | Move to `public/`, fetch at battle start | Removes 3.19 MB from startup bundle |
| Custom team generator | @pkmn/randoms | All gens, all move legality handled |
| Custom damage calc | @smogon/calc 0.10.0 | Correct gen-specific formulas |

**Deprecated/outdated:**
- `import.meta.glob` for data files: Not needed here — we have fixed file paths, not dynamic discovery.
- Pokemon Showdown REST API: No server-side component in this project; all data is local.

---

## Open Questions

1. **Does @pkmn/randoms require @pkmn/sim as a peer dependency?**
   - What we know: npm page says "use with @pkmn/sim". TeamGenerators can be used standalone with `getTeamGenerator(format).getTeam()`.
   - What's unclear: Whether @pkmn/sim must be installed for the package to import without errors, or if it's optional.
   - Recommendation: Install @pkmn/randoms and run `vite build` immediately to check for peer dependency warnings. If @pkmn/sim is required, add it — it is the Showdown sim engine.

2. **Are function-valued keys in abilities/items needed for Phase 1?**
   - What we know: JSON.stringify drops functions. The fix script will strip battle hooks from ability/item data.
   - What's unclear: Whether any Phase 1 code (DataLoader, validation) needs those hooks. @smogon/calc provides its own damage formula and does NOT use these hooks from JSON data.
   - Recommendation: For Phase 1, JSON data without hooks is sufficient. If @smogon/calc needs full ability data, it reads from its own bundled data, not our JSON files.

3. **Exact `resolveJsonModule` tsconfig requirement for Vite 6**
   - What we know: Vite 6 handles JSON imports natively. TypeScript 5.7 with `moduleResolution: bundler` may not need `resolveJsonModule`.
   - What's unclear: Whether TypeScript type inference for the imported JSON objects works without `resolveJsonModule: true`.
   - Recommendation: Add `"resolveJsonModule": true` to tsconfig.json as a defensive measure. It costs nothing.

---

## Sources

### Primary (HIGH confidence)
- Live CDN verified: `https://play.pokemonshowdown.com/data/abilities.js` — confirmed `exports.BattleAbilities` CommonJS format
- Live CDN verified: `https://play.pokemonshowdown.com/data/items.js` — confirmed `exports.BattleItems` CommonJS format
- Live CDN verified: `https://play.pokemonshowdown.com/data/typechart.js` — confirmed `exports.BattleTypeChart` CommonJS format
- Filesystem verified: `src/data/abilities.json`, `items.json`, `typechart.json` confirmed as HTML 404 pages (3,803 bytes each, starts with `<!DOCTYPE html>`)
- Filesystem verified: `src/data/pokedex.json` — 1,515 entries, isNonstandard values enumerated, 897 standard Pokemon confirmed
- Node.js vm module docs — `vm.runInNewContext` pattern for safe CommonJS stripping
- Vite 6 docs — `public/` directory serves files as-is without bundling; JSON imports supported natively

### Secondary (MEDIUM confidence)
- @pkmn/randoms npm page + GitHub pkmn/ps — `TeamGenerators.getTeamGenerator(format).getTeam()` API confirmed
- @smogon/calc libraries.io — version 0.10.0, last updated May 2024
- pkmn.github.io/randbats — @pkmn/randbats data available at `data.pkmn.cc/randbats/`

### Tertiary (LOW confidence)
- @pkmn/randoms peer dependency on @pkmn/sim — stated in documentation but runtime behavior unverified; test with `npm install && vite build`

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — CDN URLs live-verified, npm packages confirmed
- Architecture: HIGH — module singleton pattern and Map<> O(1) are TypeScript fundamentals; Vite public/ behavior is documented
- Pitfalls: HIGH for isNonstandard filter (filesystem-verified counts), HIGH for CDN .js vs .json distinction (live-verified), MEDIUM for Vite JSON assert syntax (documented but not tested in this project)

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (CDN URLs stable; @smogon/calc slow-moving)
