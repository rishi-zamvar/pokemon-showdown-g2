---
phase: 09-navigation-hud-consolidation
plan: 01
subsystem: ui
tags: [gesture, typescript, renderer, glass-adapter, navigation]

# Dependency graph
requires:
  - phase: 08-animation-polish
    provides: GlassAdapter, renderers, and animation system used as base
provides:
  - DOUBLE_TAP gesture kind in GestureKind union
  - DOUBLE_CLICK_EVENT mapped to DOUBLE_TAP in glassAdapter
  - Attack select list starting at index 0 (moves, no Back entry)
  - Switch select list starting at index 0 (Pokemon, no Back entry)
  - Direct indexMap mapping without offset
affects:
  - 09-02-navigation-hud-consolidation (ScreenController double-tap wiring depends on this foundation)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - DOUBLE_TAP is a back-navigation gesture with no listIndex — distinct from TAP which carries selection semantics
    - List renderers omit back navigation entries — controller handles back via gesture kind, not list position 0

key-files:
  created: []
  modified:
    - src/types/contracts.ts
    - src/adapters/glassAdapter.ts
    - src/screens/renderers/attackSelectRenderer.ts
    - src/screens/renderers/switchSelectRenderer.ts
    - src/screens/ScreenState.ts

key-decisions:
  - "DOUBLE_TAP carries no listIndex — double-tap is purely a back-navigation signal with no list selection semantics"
  - "List renderers produce items starting at index 0 — no '< Back' sentinel; ScreenController back navigation handled via DOUBLE_TAP gesture in Plan 02"
  - "indexMap[displayIndex] = teamIndex directly — removed -1 offset that existed only to skip '< Back' at slot 0"

patterns-established:
  - "Gesture kinds are semantically distinct: TAP selects (carries listIndex), DOUBLE_TAP navigates back (no listIndex)"
  - "Renderer arrays start at 0 with real content — no navigation sentinels in item arrays"

# Metrics
duration: 1min
completed: 2026-03-02
---

# Phase 9 Plan 01: Gesture Foundation & Renderer Cleanup Summary

**DOUBLE_TAP gesture kind added to contracts with DOUBLE_CLICK_EVENT mapping, and attack/switch renderers stripped of '< Back' sentinels so Plan 02 can wire tap indices cleanly**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-02T11:33:25Z
- **Completed:** 2026-03-02T11:34:34Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `DOUBLE_TAP` to the `GestureKind` union type in `contracts.ts`, positioned after `TAP`
- Remapped `DOUBLE_CLICK_EVENT` in `glassAdapter.ts` from `{ kind: "TAP", listIndex: ... }` to `{ kind: "DOUBLE_TAP" }` — no listIndex since it is purely a back gesture
- Removed `'< Back'` as the first item in `attackSelectRenderer` — moves now occupy indices 0-3 directly
- Removed `'< Back'` as the first item in `switchSelectRenderer` — eligible Pokemon now occupy indices 0-N directly
- Updated `ScreenState.ts` JSDoc on `SwitchListScreen.indexMap` to reflect direct mapping without offset

## Task Commits

Each task was committed atomically:

1. **Task 1: Add DOUBLE_TAP gesture kind and map SDK event** - `dc56e1c` (feat)
2. **Task 2: Remove "< Back" from attack and switch renderers, fix index mapping** - `0caa4a0` (feat)

## Files Created/Modified
- `src/types/contracts.ts` - Added `'DOUBLE_TAP'` to `GestureKind` union after `'TAP'`
- `src/adapters/glassAdapter.ts` - `DOUBLE_CLICK_EVENT` now maps to `{ kind: "DOUBLE_TAP" }` without `listIndex`
- `src/screens/renderers/attackSelectRenderer.ts` - Items array starts empty; moves at indices 0-3
- `src/screens/renderers/switchSelectRenderer.ts` - Items array starts empty; Pokemon at direct display indices
- `src/screens/ScreenState.ts` - Updated `indexMap` JSDoc: direct mapping, no -1 offset

## Decisions Made
- DOUBLE_TAP has no `listIndex` property — double-tap is a back-navigation gesture, not a list selection; including `listIndex` would add noise and mislead Plan 02's handler
- List renderers no longer own back navigation — the "< Back" pattern embedded navigation concerns inside renderers; Plan 02's ScreenController will handle back via gesture kind instead
- `indexMap` now maps display index directly to team index with zero offset — the -1 offset existed solely to compensate for the removed "< Back" slot 0

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Foundation complete for Plan 02: ScreenController can check `gesture.kind === 'DOUBLE_TAP'` to navigate back from ATTACK_SELECT and SWITCH_SELECT
- Plan 02's tap handlers need to be updated — tap indices now reference items at 0-based positions without the "< Back" offset that previously existed at index 0
- TypeScript compiles cleanly; no type errors introduced

---
*Phase: 09-navigation-hud-consolidation*
*Completed: 2026-03-02*
