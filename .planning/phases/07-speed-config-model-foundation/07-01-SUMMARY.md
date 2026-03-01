---
phase: 07-speed-config-model-foundation
plan: 01
subsystem: ui
tags: [speed-config, main-menu, singleton, animation]

# Dependency graph
requires:
  - phase: 05-screen-layer
    provides: ScreenController, mainMenuRenderer, GlassAdapter interface
provides:
  - SpeedConfig singleton with cycle/multiplier/isInstant API
  - Main menu updated to 3 items with dynamic Battle Speed label
  - Speed cycling inline in ScreenController (no screen transition)
  - About/Credits screen via showText in main menu
affects:
  - 07-speed-config-model-foundation (plan 02+)
  - 08-animation-polish (wires SpeedConfig.multiplier() into AnimationEngine)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level mutable singleton: export const SpeedConfig = { ... } (same as DataLoader)"
    - "Cycle order encoded as const array for index-based wrapping"
    - "Inline menu cycling: cycle() + setState(cursorIndex: 1) + render() in single tap handler"

key-files:
  created:
    - src/config/SpeedConfig.ts
  modified:
    - src/screens/renderers/mainMenuRenderer.ts
    - src/screens/ScreenController.ts

key-decisions:
  - "SpeedConfig is a module-level mutable singleton (not a class) — same pattern as DataLoader"
  - "Cycle order array: ['Normal', 'Fast', 'Instant', 'Slow'] — index wrapping for next preset"
  - "About/Credits uses showText() directly then keeps state=MAIN_MENU so next tap re-renders menu"
  - "Battle Speed case keeps cursorIndex=1 after cycle so highlighted item stays visible"

patterns-established:
  - "SpeedConfig.multiplier(): Phase 8 AnimationEngine uses this to scale all animation durations"
  - "SpeedConfig.isInstant(): Convenience check so callers can skip animation entirely"

# Metrics
duration: 1min
completed: 2026-03-01
---

# Phase 7 Plan 01: Speed Config & Model Foundation Summary

**SpeedConfig mutable singleton with 4 presets (Slow/Normal/Fast/Instant) and multiplier API, wired into main menu as an inline cycling option alongside About/Credits**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-01T21:04:25Z
- **Completed:** 2026-03-01T21:05:35Z
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- SpeedConfig singleton with current(), cycle(), multiplier(), isInstant(), reset() — the foundation for Phase 8 animation scaling
- Main menu upgraded from 2 items to 3: Enter Battle / Battle Speed: [preset] / About/Credits
- Speed cycling is instant (tap -> cycle() -> re-render, cursor stays at 1) with no screen transition
- About/Credits shows credits text via showText() and returns to menu on next tap

## Task Commits

Each task was committed atomically:

1. **Task 1: Create SpeedConfig singleton** - `b9ea59e` (feat)
2. **Task 2: Wire speed cycling into main menu and ScreenController** - `e69024b` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/config/SpeedConfig.ts` - Mutable module-level singleton; cycle order Normal->Fast->Instant->Slow->Normal; multiplier() returns 2.0/1.0/0.5/0
- `src/screens/renderers/mainMenuRenderer.ts` - 3-item menu with dynamic `Battle Speed: ${SpeedConfig.current()}` label
- `src/screens/ScreenController.ts` - SpeedConfig import, handleMainMenu updated with 3 cases; Clear Sprites case removed from main menu

## Decisions Made
- SpeedConfig uses module-level `let currentPreset` (not class state) so it resets to Normal on every app open without explicit reset calls
- Cycle order is `['Normal', 'Fast', 'Instant', 'Slow']` — array index wrapping makes adding presets trivial
- About/Credits does not use a new screen state — showText() is called directly and state remains MAIN_MENU, so next TAP re-renders the menu naturally
- `cursorIndex: 1` preserved after cycling so the speed item stays highlighted (better UX)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SpeedConfig.multiplier() is ready for Phase 8 AnimationEngine integration
- SpeedConfig.isInstant() enables instant-skip animation paths in Phase 8
- Module-level state persists across battles, resets on app restart — matches spec
- No blockers for remaining Phase 7 plans

---
*Phase: 07-speed-config-model-foundation*
*Completed: 2026-03-01*
