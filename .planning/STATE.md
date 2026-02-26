# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-26)

**Core value:** Players can play a complete random battle on G2 glasses with attack, switch, and Terastallize
**Current focus:** Phase 1 complete — ready for Phase 2 (Battle Engine)

## Current Position

Phase: 1 of 6 (Data Foundation) — COMPLETE
Plan: 3 of 3 in Phase 1
Status: Phase complete
Last activity: 2026-02-26 — Completed 01-03-PLAN.md (match data scoping + learnsets lazy-load)

Progress: [███░░░░░░░] ~10% (3/3 plans in Phase 1; phases 2-6 not yet planned in full)

## Performance Metrics

**Velocity:**
- Total plans completed: 3
- Average duration: ~3.3 min
- Total execution time: ~10 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-data-foundation | 3 completed | ~10 min | ~3.3 min |

**Recent Trend:**
- Last 5 plans: 01-01 (~2 min), 01-02 (~4 min), 01-03 (~4 min)
- Trend: stable

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

### Pending Todos

None.

### Blockers/Concerns

- [Phase 1 blocker RESOLVED]: abilities.json, items.json, typechart.json now contain valid data (314, 583, 19 entries)
- [Phase 1 blocker RESOLVED]: learnsets.json moved to public/data/ — lazy-loaded via fetch, not bundled
- [Phase 3 flag]: Damage formula modifier order is subtle — research phase recommended before implementation
- [Data note]: PS typechart damageTaken uses 1=2x (not 3) — plan had incorrect assertion; actual encoding documented above

## Session Continuity

Last session: 2026-02-26T14:22:00Z
Stopped at: Completed 01-03-PLAN.md — match data scoping, learnsets lazy-load, validate() wired into bootstrap
Resume file: None
