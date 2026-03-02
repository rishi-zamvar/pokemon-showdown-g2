---
phase: 10-overlay-hud-layouts
plan: "01"
subsystem: ui
tags: [bmp, canvas, compositing, sprites, overlay, hud, even-g2-sdk]

# Dependency graph
requires:
  - phase: 09-navigation-hud-consolidation
    provides: ScreenController, showBattleHud, renderBattleHudActions — adapter pattern this extends
  - phase: 05.3-switch-animation-polish
    provides: SpriteBmpEncoder (encodeBmp, emptyBmp) — BMP encoding primitives reused here
  - phase: 07-speed-config-model-foundation
    provides: StatStages, ActivePokemon fields (statStages, revealedAbility, heldItem) — used in buildStatusLine

provides:
  - CompositeBuilder.ts — 6 exports for generating 144x132 and 576x24 composite BMPs
  - OVERLAY_LAYOUT constants — complete 4-container 576x288 HUD geometry
  - teamBar container ID/name (id=8) in CONTAINER_IDS / CONTAINER_NAMES
  - emptyBmpRect(w, h) — non-square fallback BMP generator
  - loadImageFromUrl() — public PNG loader for canvas compositing
  - showOverlayHud() — 4-container SDK layout method on GlassAdapter interface + impl

affects:
  - 10-overlay-hud-layouts (Plans 02+): screen-specific HUD wiring that calls showOverlayHud
  - 11-stats-screen: may use buildSpriteComposite / CompositeBuilder for stats display

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composite BMP pattern: bake multiple data layers (text + sprite) into single BMP to stay within 4-container SDK limit"
    - "Stage-to-multiplier lookup table for stat mod display (0.5x, 1.5x format)"
    - "sendBmpData private helper in GlassAdapterImpl to reduce BMP send repetition"
    - "Canvas-based compositing: white nameplate region + black sprite region in single 144x132 canvas"

key-files:
  created:
    - src/sprites/CompositeBuilder.ts
  modified:
    - src/config/constants.ts
    - src/sprites/SpriteBmpEncoder.ts
    - src/types/contracts.ts
    - src/adapters/glassAdapter.ts

key-decisions:
  - "OVERLAY_LAYOUT defines all geometry as single const block — no magic numbers in adapter or builder"
  - "buildSpriteComposite is the low-level primitive; buildOppComposite/buildPlayerComposite are BattleState-aware wrappers"
  - "teamBar container reuses ID 8 (not conflicting with existing 1-7 range)"
  - "sendBmpData private helper sends BMP sequentially after container creation — same pattern as existing showBattleHud"
  - "Status line uses multiplier format (0.5x, 1.5x) not stage notation (+1, -2) for readability on small display"
  - "loadImageFromUrl() is a public wrapper around private loadImage() — avoids breaking existing callers"

patterns-established:
  - "Composite BMP: canvas compositing → binarizeCanvas → encodeBmp pipeline"
  - "Fallback chain: sprite load failure → sprite region stays black (no crash)"
  - "OVERLAY_LAYOUT import: CompositeBuilder + glassAdapter both import from constants (single source of truth)"

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 10 Plan 01: Overlay HUD Layouts Summary

**CompositeBuilder module + showOverlayHud adapter method establish the 4-container SDK overlay HUD infrastructure: 144x132 composite BMPs with nameplate/HP bar/status/sprite, 576x24 team preview bar, and a single rebuildPageContainer call for all decision screens**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T12:52:20Z
- **Completed:** 2026-03-02T12:55:12Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments

- Created CompositeBuilder.ts (370 lines) with 6 exports: buildSpriteComposite, buildOppComposite, buildPlayerComposite, buildTeamBar, emptyComposite, emptyTeamBarBmp
- Added OVERLAY_LAYOUT constant block defining complete 4-container 576x288 HUD geometry plus teamBar container ID/name (id=8)
- Implemented showOverlayHud() on both GlassAdapter interface and GlassAdapterImpl — sends 3 ImageContainers + 1 ListContainer in a single rebuildPageContainer call

## Task Commits

Each task was committed atomically:

1. **Task 1: Layout constants + emptyBmpRect + CompositeBuilder module** - `ae76fac` (feat)
2. **Task 2: showOverlayHud adapter method** - `f53fcda` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/sprites/CompositeBuilder.ts` — 6 composite BMP generation functions; canvas-based nameplate + sprite compositing with binarization
- `src/config/constants.ts` — OVERLAY_LAYOUT const block (16 geometry values), teamBar added to CONTAINER_IDS/NAMES
- `src/sprites/SpriteBmpEncoder.ts` — emptyBmpRect(w,h) for non-square fallback BMPs; loadImageFromUrl() public PNG loader
- `src/types/contracts.ts` — showOverlayHud() signature on GlassAdapter interface
- `src/adapters/glassAdapter.ts` — showOverlayHud() implementation with 4 containers + sendBmpData() private helper

## Decisions Made

- `buildSpriteComposite` is the reusable low-level primitive; `buildOppComposite`/`buildPlayerComposite` are thin BattleState wrappers — keeps compositing logic DRY
- Stat modifier display uses multiplier format (0.5x, 1.5x) rather than stage notation (+1, -2) — more intuitive for players reading at a glance on glasses
- `loadImageFromUrl` wraps private `loadImage` rather than replacing it — additive change, no existing callers broken
- teamBar uses container ID 8 — avoids collision with existing IDs 1-7; reserves room for future containers if SDK limit ever increases
- Container count is exactly 4 in `showOverlayHud`: 3 ImageContainers + 1 ListContainer — at the hardware limit

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - TypeScript compiled clean on first attempt, build succeeded.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All overlay HUD building blocks are in place for Phase 10 Plan 02+
- CompositeBuilder is ready to be called from ScreenController decision screens (BATTLE_HUD, ATTACK_SELECT, SWITCH_SELECT)
- showOverlayHud() is callable from ScreenController via the GlassAdapter interface
- No blockers — TypeScript compiles with zero errors, Vite build succeeds

---
*Phase: 10-overlay-hud-layouts*
*Completed: 2026-03-02*
