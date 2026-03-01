---
phase: 07-speed-config-model-foundation
plan: 02
subsystem: battle-state
tags: [typescript, battlestate, activepokemon, stat-stages, ability, held-item, sim-adapter]

# Dependency graph
requires:
  - phase: 05.2-sim-engine
    provides: SimBattleAdapter.deriveSide() and BattleState types
  - phase: 07-01
    provides: SpeedConfig singleton; plan 02 is same phase Wave 1

provides:
  - StatStages interface (7 stats: atk/def/spa/spd/spe/accuracy/evasion, -6 to +6)
  - ActivePokemon extended with statStages, revealedAbility, heldItem, heldItemConsumed
  - deriveSide() populates all new fields from @pkmn/sim Pokemon objects every turn

affects:
  - Phase 11 Stats Screen (reads statStages and revealedAbility from BattleState)
  - Any future renderer that displays item or ability info

# Tech tracking
tech-stack:
  added: []
  patterns:
    - StatStages mirrors @pkmn/sim boosts object shape exactly — no transformation needed at read site
    - heldItemConsumed uses BattlePokemon.item as source-of-truth for "originally had item" check

key-files:
  created: []
  modified:
    - src/types/battleState.ts
    - src/battle/SimBattleAdapter.ts

key-decisions:
  - "StatStages interface exported from battleState.ts — mirrors @pkmn/sim boosts keys directly"
  - "revealedAbility reads simMon.ability unconditionally — visibility logic deferred to Phase 11"
  - "heldItemConsumed: prev.heldItemConsumed || (simMon.item === '' && prev.item !== '') — uses BattlePokemon.item (team gen) as original item reference"
  - "All new ActivePokemon fields get zero-state defaults in initActivePokemon() — backward compatible, no breaking changes"

patterns-established:
  - "New BattleState fields follow: type in battleState.ts → default in initActivePokemon() → deriveSide() wiring → downstream consumers"

# Metrics
duration: ~1.5min
completed: 2026-03-01
---

# Phase 7 Plan 02: BattleState Model Extension Summary

**StatStages interface + ActivePokemon extended with stat stages, revealed ability, and held item tracking; SimBattleAdapter.deriveSide() wired to @pkmn/sim boosts/ability/item fields**

## Performance

- **Duration:** ~1.5 min
- **Started:** 2026-03-01T21:07:52Z
- **Completed:** 2026-03-01T21:09:03Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Exported StatStages interface (7 stats matching @pkmn/sim boosts: atk, def, spa, spd, spe, accuracy, evasion)
- Extended ActivePokemon interface with statStages, revealedAbility, heldItem, heldItemConsumed
- initActivePokemon() provides zero-state defaults — no breaking changes to existing consumers
- deriveSide() reads all three new data sources from sim on every turn: simMon.boosts, simMon.ability, simMon.item

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend ActivePokemon type with stat stages, ability, and held item** - `a32c7db` (feat)
2. **Task 2: Populate new fields in SimBattleAdapter.deriveSide()** - `47dfd7e` (feat)

## Files Created/Modified
- `src/types/battleState.ts` - Added StatStages interface; added 4 new fields to ActivePokemon; updated initActivePokemon() defaults
- `src/battle/SimBattleAdapter.ts` - Imported StatStages; deriveSide() now reads boosts, ability, item from sim and populates new ActivePokemon fields

## Decisions Made
- StatStages keys mirror @pkmn/sim boosts object verbatim — avoids any key-mapping indirection at the read site
- revealedAbility reads simMon.ability for all pokemon unconditionally — sim always knows the real ability; Phase 11 (Stats Screen) will add opponent visibility filtering if needed
- heldItemConsumed: `prev.heldItemConsumed || (simMon.item === '' && prev.item !== '')` — prev.item (BattlePokemon.item from team gen) is the authoritative original item; once consumed flag is true it stays true
- initActivePokemon() zero-state defaults ensure every existing call site is backward compatible with no changes required

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- BattleState now carries all data Phase 11 (Stats Screen) needs: statStages for boost display, revealedAbility for ability name, heldItem/heldItemConsumed for item tracking
- Build clean, zero TypeScript errors
- No blockers for subsequent Wave 1 plans in Phase 7

---
*Phase: 07-speed-config-model-foundation*
*Completed: 2026-03-01*
