# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-26)

**Core value:** Players can play a complete random battle on G2 glasses with attack, switch, and Terastallize
**Current focus:** Phase 2 complete — Phase 3 (Battle State) is next

## Current Position

Phase: 2 of 6 (Team Generation) — Complete
Plan: 2 of 2 in Phase 2 (02-02 complete — Phase 2 fully done)
Status: In progress (Phase 3 next)
Last activity: 2026-02-26 — Completed 02-02-PLAN.md (TeamGenerator 100-iteration stress test, 600 Pokemon validated)

Progress: [█████░░░░░] ~20% (5/N plans complete — 3 Phase 1 + 2 Phase 2)

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Average duration: ~3 min
- Total execution time: ~12 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-data-foundation | 3 completed | ~10 min | ~3.3 min |
| 02-team-generation | 2 completed | ~3 min | ~1.5 min |

**Recent Trend:**
- Last 5 plans: 01-01 (~2 min), 01-02 (~4 min), 01-03 (~4 min), 02-01 (~2 min), 02-02 (~1 min)
- Trend: stable, Phase 2 plans faster than Phase 1

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Use @smogon/calc for damage, @pkmn/randoms for team gen — do not recreate mechanics
- [Roadmap]: Battle engine is pure (no glass calls) — screens are read-only views of BattleState
- [Roadmap]: Load only 12 match Pokemon at battle start; clear all match data on battle end
- [Roadmap]: Status conditions (burn, paralysis, poison, sleep, freeze) are IN scope for v0.1
- [Roadmap]: No sprites on glasses — text/list only; sprites only on phone companion screen
- [01-01]: Fetch .js not .json from PS CDN — .json paths return 404 HTML; .js paths return real data
- [01-01]: Drop function-valued keys via JSON.stringify — Phase 1 only needs static fields (name, num, desc)
- [01-01]: PS typechart damageTaken encoding: 0=1x, 1=2x(super), 2=0.5x(resist), 3=0x(immune)
- [01-01]: PS data keys are lowercase slugs — downstream lookups must use .toLowerCase() or slug normalization
- [01-02]: Module singleton pattern: export const DataLoader = { ... } object, not class with getInstance()
- [01-02]: JSON cast requires 'as unknown as' intermediate — some PS pokedex entries are sparse cosmetic formes
- [01-02]: getStandardPokemon() = !isNonstandard && !battleOnly = exactly 897 standard entries
- [01-02]: @pkmn/randoms and @smogon/calc installed and importable — ready for team gen and damage calc
- [01-02]: tsc and vite shims in node_modules/.bin/ had wrong relative paths — fixed; npm run build now works
- [01-03]: learnsets.json belongs in public/data/ not src/data/ — Vite bundles src/data/*.json at build time
- [01-03]: Match-scoped Maps use null (not empty Map) for clearance — null assignment makes Map GC-eligible
- [01-03]: loadMatchData extracts only 12 entries from 3.19 MB raw response — raw object discarded immediately
- [01-03]: validate() error handler calls setStatus() then returns — user sees error on glass before abort
- [02-01]: teraType cast as unknown as TypeName — @pkmn/randoms returns string, @smogon/calc wants TypeName union
- [02-01]: calcSpecies stored on BattlePokemon — downstream callers use it directly without re-doing Dex lookup
- [02-01]: stats computed at generation time via CalcPokemon constructor — no recalculation at battle runtime
- [02-01]: No post-filter for nonstandard Pokemon — @pkmn/randoms internal randomData allowlist is authoritative
- [02-02]: Stress test as standalone tsx script — no Jest/Vitest needed; tsx executes .ts directly
- [02-02]: 100 iterations confirmed: 0 failures, 2 Ditto appearances (~0.3%), 52 cosmetic forme resolutions (~8.7%) — all handled correctly

### Pending Todos

None.

### Blockers/Concerns

- [Phase 1 blocker RESOLVED]: abilities.json, items.json, typechart.json now contain valid data (314, 583, 19 entries)
- [Phase 1 blocker RESOLVED]: learnsets.json moved to public/data/ — lazy-loaded via fetch, not bundled
- [Phase 3 flag]: Damage formula modifier order is subtle — research phase recommended before implementation
- [Data note]: PS typechart damageTaken uses 1=2x (not 3) — plan had incorrect assertion; actual encoding documented above
- [Phase 4 note]: Pass BattlePokemon.calcSpecies (not species) to @smogon/calc — cosmetic forme crash avoided
- [Bundle note]: @pkmn/sim + @pkmn/randoms produce ~1.25 MB bundle (247 KB gzip) — chunk warning is cosmetic, not blocking

## Session Continuity

Last session: 2026-02-26T14:45:10Z
Stopped at: Completed 02-02-PLAN.md — TeamGenerator stress test; Phase 2 fully complete; Phase 3 (BattleState) next
Resume file: None
