---
phase: 01-data-foundation
plan: 02
subsystem: database
tags: [typescript, pokemon-showdown, data-access, types, pkmn-randoms, smogon-calc]

# Dependency graph
requires:
  - phase: 01-01
    provides: valid abilities.json, items.json, typechart.json (314, 583, 19 entries)
provides:
  - src/types/pokemon.ts — PokemonEntry, MoveEntry, AbilityEntry, ItemEntry, TypeChart interfaces matching actual PS JSON
  - src/data/DataLoader.ts — module singleton with O(1) Map accessors and validate()
  - @pkmn/randoms and @smogon/calc installed as runtime dependencies
affects: [01-03, 02-team-gen, 03-battle-engine, 04-ai, 05-screens]

# Tech tracking
tech-stack:
  added: ["@pkmn/randoms", "@smogon/calc"]
  patterns: ["module-level singleton (not class)", "Map-backed O(1) data access", "cast-via-unknown for JSON type narrowing"]

key-files:
  created:
    - src/types/pokemon.ts
    - src/data/DataLoader.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Module singleton pattern: export const DataLoader = { ... } object, not a class with getInstance()"
  - "Cast JSON imports via 'as unknown as Record<string, T>' to handle sparse PS formes that lack required fields"
  - "drain/recoil/heal typed as number[] not [number,number] — TypeScript infers literal arrays from JSON"
  - "tsc shim had wrong relative path (../lib instead of ../typescript/lib); fixed inline as blocking deviation"
  - "vite shim had same wrong relative path (../dist instead of ../vite/dist); fixed inline as blocking deviation"
  - "getStandardPokemon() filters !isNonstandard && !battleOnly — yields exactly 897 standard entries"

patterns-established:
  - "DataLoader as module singleton: import { DataLoader } from './data/DataLoader'"
  - "All data lookups are O(1) via pre-built Maps constructed at module load time"
  - "validate() called once at app boot before any battle logic"
  - "PS slug convention: lowercase keys, callers normalize to lowercase before lookup"

# Metrics
duration: 4min
completed: 2026-02-26
---

# Phase 1 Plan 2: DataLoader Module Singleton Summary

**TypeScript-typed O(1) Map accessors over all PS data files via module singleton, with startup validation and standard-Pokemon filter returning exactly 897 entries**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-02-26T14:14:00Z
- **Completed:** 2026-02-26T14:17:28Z
- **Tasks:** 2
- **Files modified:** 4 (created: 2, modified: 2)

## Accomplishments

- Created `src/types/pokemon.ts` with 6 interfaces (PokemonEntry, MoveEntry, AbilityEntry, ItemEntry, TypeEntry, TypeChart) matching actual PS JSON field names verified against live data
- Created `src/data/DataLoader.ts` as module-level singleton: Maps built once at import time, 8 typed accessors exported, validate() throws on undersized data
- Installed `@pkmn/randoms` and `@smogon/calc` — both importable; ready for team gen and damage calc in later phases
- getStandardPokemon() correctly returns 897 entries by filtering isNonstandard + battleOnly formes

## Task Commits

Each task was committed atomically:

1. **Task 1: Define Pokemon data interfaces and install packages** - `ce51fbb` (feat)
2. **Task 2: Build DataLoader module singleton** - `eef1c30` (feat)

**Plan metadata:** (next commit — docs)

## Files Created/Modified

- `src/types/pokemon.ts` — PokemonEntry, MoveEntry, AbilityEntry, ItemEntry, TypeEntry, TypeChart interfaces with full PS field coverage
- `src/data/DataLoader.ts` — module singleton exporting DataLoader object with O(1) Map accessors and validate()
- `package.json` — added @pkmn/randoms and @smogon/calc
- `package-lock.json` — lockfile for new dependencies

## Decisions Made

- **Module singleton, not class:** `export const DataLoader = { ... }` avoids getInstance() boilerplate and is tree-shakeable
- **cast via `as unknown as`:** PS pokedex has "cosmetic forme" entries (e.g. `burmysandy`) with no `num`/`types`/`baseStats` — TypeScript rejects direct cast; `unknown` intermediate is correct pattern
- **drain typed as `number[]`:** TypeScript infers `number[]` from JSON arrays even when we know they're always length-2 tuples; relaxed to `number[]` to match inferred type
- **Standard Pokemon = !isNonstandard && !battleOnly:** Yields exactly 897 entries, matching the plan's `~897` assertion

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tsc shim had wrong relative path**
- **Found during:** Task 2 verification (`npm run build`)
- **Issue:** `node_modules/.bin/tsc` contained `require('../lib/tsc.js')` — from `.bin/`, `../lib` resolves to `node_modules/lib/tsc.js` which does not exist; TypeScript is at `node_modules/typescript/lib/tsc.js`
- **Fix:** Rewrote shim to `require('../typescript/lib/tsc.js')`; verified `tsc --noEmit` passes
- **Files modified:** `node_modules/.bin/tsc` (not tracked in git — shim file)
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** eef1c30 (part of Task 2 commit message; shim itself not in git)

**2. [Rule 3 - Blocking] vite shim had wrong relative path**
- **Found during:** Task 2 verification (`npm run build`)
- **Issue:** `node_modules/.bin/vite` imported `'../dist/node/cli.js'` — from `.bin/` that resolves to `node_modules/dist/node/cli.js` which does not exist; Vite is at `node_modules/vite/dist/node/cli.js`
- **Fix:** Rewrote shim to import `'../vite/dist/node/cli.js'`
- **Files modified:** `node_modules/.bin/vite` (not tracked in git — shim file)
- **Verification:** `npm run build` completes successfully, 59.5kB bundle, 0 errors
- **Committed in:** eef1c30 (part of Task 2 commit message)

**3. [Rule 1 - Bug] drain/recoil/heal typed as number[] not tuple**
- **Found during:** Task 2 type check (`tsc --noEmit`)
- **Issue:** Interface declared `drain?: [number, number]` but TypeScript infers `number[]` from JSON; type mismatch caused compile error
- **Fix:** Relaxed to `drain?: number[]` in `src/types/pokemon.ts`
- **Files modified:** src/types/pokemon.ts
- **Verification:** tsc --noEmit passes with 0 errors
- **Committed in:** eef1c30

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug)
**Impact on plan:** All auto-fixes required for builds to work. Shim fixes are environmental issues from npm install; not scope creep. Type fix maintains correctness.

## Issues Encountered

- JSON cast to typed Record required `as unknown as` intermediate — TypeScript strict mode correctly rejects direct cast when some JSON entries don't fully satisfy the interface (cosmetic formes). Pattern is established for future phases.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DataLoader is ready for consumption by Plan 03 (match data loading)
- `DataLoader.getPokemon('pikachu')` returns typed entry with name, types, baseStats — verified
- `DataLoader.getMove('thunderbolt')` returns typed entry with basePower, type, accuracy — verified
- `DataLoader.getTypechart()` returns 19-type chart with damageTaken mappings — verified
- `DataLoader.validate()` throws on undersized data — logic verified
- `DataLoader.getStandardPokemon()` returns exactly 897 entries — verified
- @pkmn/randoms and @smogon/calc installed and importable — verified
- No blockers for Plan 03

---
*Phase: 01-data-foundation*
*Completed: 2026-02-26*
