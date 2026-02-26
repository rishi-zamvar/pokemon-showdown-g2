---
phase: 01-data-foundation
plan: "03"
subsystem: data
tags: [vite, typescript, fetch, lazy-loading, memory-management, learnsets]

# Dependency graph
requires:
  - phase: 01-02
    provides: DataLoader singleton with validate(), getPokemon(), getMove(), getAbility(), getItem(), getTypechart(), getStandardPokemon()
provides:
  - learnsets.json served as 3.19 MB static asset from public/data/ (not bundled into JS)
  - DataLoader.loadMatchData(pokemonIds) — lazy-fetches learnsets and builds match-scoped Maps for 12 Pokemon
  - DataLoader.clearMatchData() — nullifies both match Maps for GC between matches
  - DataLoader.getMatchPokemon(id), getMatchLearnset(id), isMatchLoaded() — match-scoped accessors
  - DataLoader.validate() wired into main.ts bootstrap (aborts boot if data is corrupt)
affects:
  - 02-battle-engine (uses loadMatchData/clearMatchData for match lifecycle)
  - 03-team-generation (team gen triggers loadMatchData after selecting 12 Pokemon)
  - All phases that import DataLoader and call validate()

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy fetch pattern: fetch('/data/learnsets.json').then(r => r.json()) — large JSON served as public static asset, not bundled"
    - "Match scoping pattern: nullable module-level Maps (_matchPokemon, _matchLearnsets) set to null between matches for GC"
    - "Boot validation pattern: DataLoader.validate() in bootstrap() before any game logic — abort on corrupt data"

key-files:
  created:
    - public/data/learnsets.json
  modified:
    - src/data/DataLoader.ts
    - src/main.ts

key-decisions:
  - "learnsets.json belongs in public/data/, not src/data/ — Vite would bundle src/data/*.json at build time"
  - "Match-scoped Maps use null (not empty Map) so they are GC-eligible between matches — setting to null is the clearance signal"
  - "loadMatchData extracts only 12 entries from the 3.19 MB raw response — raw object discarded immediately after Map construction"
  - "validate() error handler calls setStatus() then returns early — user sees error on glass before abort"

patterns-established:
  - "Static asset pattern: large data files go in public/ not src/data/ to avoid bundle bloat"
  - "Match lifecycle: loadMatchData() at battle start, clearMatchData() at battle end"
  - "Boot guard: validate() as first operation after glass connect, before any screen initialization"

# Metrics
duration: 4min
completed: 2026-02-26
---

# Phase 1 Plan 3: Match Data Scoping and Learnsets Lazy-Load Summary

**learnsets.json (3.19 MB) moved to public/data/ for lazy fetch; DataLoader gains match lifecycle (loadMatchData/clearMatchData) and validate() wired into app bootstrap**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-02-26T14:18:00Z
- **Completed:** 2026-02-26T14:22:00Z
- **Tasks:** 2
- **Files modified:** 3 (public/data/learnsets.json created, src/data/DataLoader.ts modified, src/main.ts modified)

## Accomplishments
- Moved learnsets.json from src/data/ to public/data/ — build output is 59.50 kB JS + 3.19 MB static asset (not bundled)
- Added _matchPokemon and _matchLearnsets nullable Maps plus full match lifecycle API to DataLoader
- Wired DataLoader.validate() into app bootstrap with error reporting and early abort

## Task Commits

Each task was committed atomically:

1. **Task 1: Move learnsets.json to public/ and add match lifecycle to DataLoader** - `cc99c15` (feat)
2. **Task 2: Wire DataLoader.validate() into app bootstrap and verify full build** - `75e747c` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `public/data/learnsets.json` - 3.19 MB learnset data, served as static asset by Vite from public/
- `src/data/DataLoader.ts` - Added _matchPokemon/_matchLearnsets nullable Maps and loadMatchData(), clearMatchData(), getMatchPokemon(), getMatchLearnset(), isMatchLoaded() methods
- `src/main.ts` - Added DataLoader import and validate() call at boot with error handling

## Decisions Made
- **learnsets.json in public/ not src/data/:** Vite bundles everything in src/ — moving to public/ ensures it is served as a separate static file, not inlined into the JS chunk
- **null vs empty Map for clearance:** Using null instead of clearing the Map ensures the Map object itself becomes GC-eligible, not just its contents
- **Extract 12 entries before discarding raw:** The 3.19 MB raw JSON is parsed in full but only 12 Pokemon's learnsets are retained in _matchLearnsets — the raw object is immediately eligible for GC after Map construction
- **validate() error shows setStatus() before return:** Glass display updates to show the data error before abort, so the user sees a message instead of a blank screen

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type error in _matchLearnsets Map construction**
- **Found during:** Task 1 (adding match lifecycle methods)
- **Issue:** `.map(id => [id, raw[id]])` produced `(string | Record<string, unknown>)[][]` — TypeScript inferred array not tuple, causing assignment error to `Map<string, Record<string, unknown>>`
- **Fix:** Added explicit tuple cast `as [string, Record<string, unknown>]` to the map call
- **Files modified:** src/data/DataLoader.ts
- **Verification:** `npx tsc --noEmit` passed after fix
- **Committed in:** cc99c15 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 type bug)
**Impact on plan:** Minimal — single-line tuple cast fix for TypeScript strictness. No scope creep.

## Issues Encountered
None — build, TypeScript check, and file structure all verified cleanly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 1 (Data Foundation) is complete — all 3 plans done
- DataLoader is fully initialized with: pokedex, moves, abilities, items, typechart (global), and match lifecycle (loadMatchData/clearMatchData)
- Phase 2 (Battle Engine) can call `DataLoader.loadMatchData(pokemonIds)` to populate match-scoped data at battle start
- No blockers. The Phase 1 learnsets.json lazy-loading concern is resolved.

---
*Phase: 01-data-foundation*
*Completed: 2026-02-26*
