---
phase: 01-data-foundation
plan: 01
subsystem: data
tags: [pokemon-showdown, json, cdn, vm, fetch, data-files]

# Dependency graph
requires: []
provides:
  - "scripts/fix-data.mjs: reproducible one-time script to re-fetch and strip PS CDN data files"
  - "src/data/abilities.json: 314 valid Pokemon ability entries with name, num, desc, rating fields"
  - "src/data/items.json: 583 valid item entries with name, num, desc, flags fields"
  - "src/data/typechart.json: 19 type entries with damageTaken mappings for damage calculation"
affects:
  - 01-data-foundation
  - 02-battle-engine
  - 03-damage-calc
  - all phases requiring type effectiveness, ability lookups, or item lookups

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CDN fetch + vm.createContext strip: fetch .js file, run in sandbox to extract exports object, write as JSON"
    - "PS typechart encoding: damageTaken values are 0=1x, 1=2x, 2=0.5x, 3=0x (immune)"
    - "PS data keys are lowercase slugs (e.g. 'overgrow', 'leftovers', 'fire') not title case"

key-files:
  created:
    - scripts/fix-data.mjs
    - src/data/abilities.json
    - src/data/items.json
    - src/data/typechart.json
  modified:
    - package.json

key-decisions:
  - "Fetch .js files not .json files — the .json CDN endpoints return 404 HTML"
  - "Drop function-valued keys (onModifyAtk, onStart, etc.) via JSON.stringify — Phase 1 needs name/num/desc only"
  - "Use vm.createContext sandbox not eval — safer, cleanly extracts exports object"

patterns-established:
  - "PS data keys: lowercase slug format (overgrow, leftovers, fire, water)"
  - "PS damageTaken encoding: 1=2x, 2=0.5x, 3=immune, 0=1x"

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 01 Plan 01: Data Foundation — Fix Broken Data Files Summary

**Re-fetched abilities (314 entries), items (583 entries), and typechart (19 types) from PS CDN .js endpoints, stripping CommonJS wrapper via Node vm sandbox to produce valid JSON**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-26T14:09:53Z
- **Completed:** 2026-02-26T14:11:36Z
- **Tasks:** 2
- **Files modified:** 5 (scripts/fix-data.mjs, package.json, abilities.json, items.json, typechart.json)

## Accomplishments
- Created reproducible `scripts/fix-data.mjs` that fetches from correct CDN endpoints and strips CommonJS wrapper
- Replaced three 3,803-byte HTML 404 pages with valid JSON data (128KB + 207KB + 9KB)
- Cleared the Phase 1 blocker: all three data files now parse cleanly and contain expected entries

## Task Commits

Each task was committed atomically:

1. **Task 1: Create fix-data.mjs fetch script** - `72f3be6` (feat)
2. **Task 2: Run fix script and validate output** - `944eabb` (feat)

## Files Created/Modified
- `scripts/fix-data.mjs` - Node ESM script to fetch .js CDN files, strip CommonJS wrapper, write JSON
- `package.json` - Added `npm run fix-data` script
- `src/data/abilities.json` - 314 ability entries (name, num, desc, rating, flags)
- `src/data/items.json` - 583 item entries (name, num, desc, flags)
- `src/data/typechart.json` - 19 type entries with damageTaken mappings

## Decisions Made
- Fetch `.js` files not `.json` — the `.json` CDN paths return 404 HTML pages; the `.js` paths serve real data
- Drop function-valued keys via `JSON.stringify` — Phase 1 only needs static fields; battle hooks come from `@pkmn/sim` later if needed
- Use `vm.createContext` + `runInContext` sandbox — cleaner than regex stripping, safely evaluates CommonJS `exports` assignment

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan assertion for typechart damageTaken value was incorrect**
- **Found during:** Task 2 (validation step)
- **Issue:** Plan specified `damageTaken['Water'] === 3` for Fire type, but PS encoding uses `1` for 2x (super effective). The value `3` means immune (0x) in PS encoding. The data is correct; the plan's test assertion value was wrong.
- **Fix:** Verified the actual encoding (0=1x, 1=2x, 2=0.5x, 3=immune) and confirmed fire takes 2x from Water (value=1). Data is valid.
- **Files modified:** None — data correct as fetched
- **Verification:** `t['fire'].damageTaken['Water'] === 1` confirmed; fire type is super effective against water attacks
- **Committed in:** 944eabb (Task 2 commit)

---

**Total deviations:** 1 (documentation error in plan assertion, no code change required)
**Impact on plan:** No scope creep. Data is correct; only the plan's expected test value was wrong.

## Issues Encountered
- PS typechart uses lowercase slugs as keys (`fire` not `Fire`). The node validation commands in the plan used `t['Fire']` which would return undefined. Used `t['fire']` instead. The data structure is correct and matches expected PS format.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 1 data blocker resolved: abilities.json, items.json, typechart.json are valid JSON
- Phase 1 Plan 02 (likely moves.json / pokedex.json validation or learnsets lazy-load strategy) can proceed
- PS typechart damageTaken encoding documented for Phase 3 (damage calc): `1=2x, 2=0.5x, 3=immune, 0=1x`
- Data keys are lowercase slugs — downstream code must look up with `.toLowerCase()` or slug normalization

---
*Phase: 01-data-foundation*
*Completed: 2026-02-26*
