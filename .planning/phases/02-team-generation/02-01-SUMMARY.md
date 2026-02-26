---
phase: 02-team-generation
plan: 01
subsystem: battle
tags: [pkmn-randoms, smogon-calc, pkmn-sim, team-generation, typescript]

# Dependency graph
requires:
  - phase: 01-data-foundation
    provides: "@pkmn/randoms and @smogon/calc installed; DataLoader singleton pattern established"
provides:
  - BattlePokemon interface (StatsTable + BattlePokemon) in src/types/battle.ts
  - TeamGenerator.buildRandom() — generates 6-Pokemon Gen 9 random battle team with computed stats
affects:
  - 02-02 and beyond: all battle phases that consume BattlePokemon objects
  - 03-battle-state: BattleState will hold two BattlePokemon[] teams
  - 04-damage-calc: damage calculator receives BattlePokemon (uses calcSpecies field)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module singleton: export const TeamGenerator = { ... } as const (same as DataLoader)"
    - "Cosmetic forme resolution: Dex.species.get(set.species).baseSpecies || set.species"
    - "Lazy team generation: buildRandom() called at battle start, not at module load"
    - "Computed stats via @smogon/calc constructor: new CalcPokemon(GEN9, calcSpecies, options).stats"

key-files:
  created:
    - src/types/battle.ts
    - src/battle/TeamGenerator.ts
  modified: []

key-decisions:
  - "teraType cast as unknown as TypeName — @pkmn/randoms returns string, @smogon/calc wants TypeName union"
  - "calcSpecies is a separate BattlePokemon field — downstream code (damage calc, display) can pick the right name"
  - "stats field holds computed final values at generation time — no recalculation needed at battle runtime"
  - "No post-filter for nonstandard Pokemon — @pkmn/randoms internal randomData allowlist handles it"

patterns-established:
  - "BattlePokemon: self-contained battle type, no imports from data layer types (pokemon.ts)"
  - "src/battle/ directory: home for battle-logic modules (TeamGenerator, future BattleEngine)"

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 2 Plan 1: Team Generation Summary

**BattlePokemon interface + TeamGenerator.buildRandom() wrapping @pkmn/randoms with cosmetic forme resolution via @pkmn/sim and computed stats via @smogon/calc**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-26T14:40:27Z
- **Completed:** 2026-02-26T14:42:23Z
- **Tasks:** 2 completed
- **Files modified:** 2 created

## Accomplishments

- Defined `BattlePokemon` interface with all required fields (name, species, calcSpecies, moves, teraType, level, ability, item, nature, gender, evs, ivs, stats) plus `StatsTable` type — fully self-contained, no data layer imports
- Implemented `TeamGenerator.buildRandom()` as a module singleton wrapping `@pkmn/randoms` `getTeamGenerator('[Gen 9] Random Battle').getTeam()` with cosmetic forme resolution via `Dex.species.get(set.species).baseSpecies`
- Computed final stats populated at generation time via `@smogon/calc` `new CalcPokemon(GEN9, calcSpecies, options).stats` — no runtime recalculation needed
- TypeScript compiles cleanly (`npx tsc --noEmit` 0 errors); Vite build succeeds (608ms)

## Task Commits

Each task was committed atomically:

1. **Task 1: Define BattlePokemon interface** - `0c2b993` (feat)
2. **Task 2: Implement TeamGenerator module singleton** - `e31b1ed` (feat)

**Plan metadata:** (committed with this summary)

## Files Created/Modified

- `src/types/battle.ts` - StatsTable interface + BattlePokemon interface (73 lines, self-contained)
- `src/battle/TeamGenerator.ts` - TeamGenerator singleton with buildRandom() method (94 lines)

## Decisions Made

- **teraType cast:** `@pkmn/randoms` returns `teraType` as `string`; `@smogon/calc` expects `TypeName` union. Cast via `as unknown as import("@pkmn/types").TypeName` to satisfy strict TypeScript without widening the BattlePokemon field to `any`.
- **calcSpecies as separate field:** Rather than computing calcSpecies only inside TeamGenerator, it's stored on BattlePokemon so downstream callers (damage calc, display logic) can pick the right name without re-doing the Dex lookup.
- **stats at generation time:** Computing stats during `buildRandom()` means battle engine always has final stat values — no need to carry EVs/IVs through battle logic (though they're stored too, for completeness and damage calc).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] teraType string cast required by @smogon/calc TypeName**
- **Found during:** Task 2 (TeamGenerator implementation)
- **Issue:** `tsc --noEmit` reported `Type 'string' is not assignable to type 'TypeName | undefined'` on the `teraType` field passed to `new CalcPokemon()`. Plan specified `set.teraType as any` but `as any` with `skipLibCheck: true` was insufficient due to strict mode.
- **Fix:** Cast via `set.teraType as unknown as import("@pkmn/types").TypeName` — preserves type safety on BattlePokemon while satisfying the calc constructor.
- **Files modified:** src/battle/TeamGenerator.ts
- **Verification:** `npx tsc --noEmit` returns 0 errors after fix.
- **Committed in:** e31b1ed (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 type cast bug)
**Impact on plan:** Minimal — single cast change. No scope creep. All plan objectives met.

## Issues Encountered

None beyond the teraType cast documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `BattlePokemon` type ready for consumption by BattleState (Phase 3) and damage calculator (Phase 4)
- `TeamGenerator.buildRandom()` callable at battle start for both player and AI teams
- `src/battle/` directory established as home for battle-logic modules
- Vite build confirmed clean — @pkmn/sim + @pkmn/randoms bundle safely (~1.25 MB total, 247 KB gzip; chunk size warning is cosmetic, not an error)
- **Note for Phase 4:** `calcSpecies` field on BattlePokemon should be passed to `@smogon/calc` — not `species` (avoids cosmetic forme crash)

---
*Phase: 02-team-generation*
*Completed: 2026-02-26*
