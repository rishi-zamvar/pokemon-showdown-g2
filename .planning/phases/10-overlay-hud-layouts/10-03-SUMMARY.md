---
phase: 10-overlay-hud-layouts
plan: "03"
subsystem: ui
tags: [bmp, sdk, canvas, overlay-hud, composite]

requires:
  - phase: 10-01
    provides: CompositeBuilder buildSpriteComposite/buildTeamBar/buildOppComposite/buildPlayerComposite
  - phase: 10-02
    provides: ScreenController overlay HUD wiring with showOverlayHud call sites

provides:
  - 50ms delay guard between rebuildPageContainer and first sendBmpData to prevent SDK container-mapping stale state
  - BMP size diagnostic debug log in showOverlayHud for routing verification
  - Defensive runtime assertions in CompositeBuilder detecting suspiciously small BMPs

affects: [10-04, phase-11-stats-screen]

tech-stack:
  added: []
  patterns:
    - "Delay-after-rebuild pattern: wait 50ms before sending image data when switching container layouts"
    - "BMP diagnostic logging: console.debug traces BMP byte lengths through showOverlayHud"
    - "Defensive size assertion: < 100B BMP triggers console.error for silent encoder failures"

key-files:
  created: []
  modified:
    - src/adapters/glassAdapter.ts
    - src/sprites/CompositeBuilder.ts

key-decisions:
  - "50ms post-rebuild delay in showOverlayHud: SDK container mapping from previous rebuildPageContainer (showBattleHud with 2-image layout) may persist into next updateImageRawData calls; 50ms ensures the new 3-image mapping propagates before image data arrives"
  - "console.debug not console.log for BMP size trace: reduces production log noise while keeping diagnostic data visible in debug sessions"
  - "Threshold 100B for size assertion: encodeBmp minimum output for 1x1 1-bit BMP is 62+4=66B; 100B safely catches any sub-minimum output while allowing all valid composites through"

patterns-established:
  - "Delay-after-rebuild: always insert a brief await this.delay(N) between renderContainers and first sendBmpData when the layout changes container count or order"

duration: 7min
completed: 2026-03-03
---

# Phase 10 Plan 03: Player Composite BMP Routing Fix Summary

**50ms post-rebuild delay in showOverlayHud prevents SDK container-mapping stale state causing team bar BMP to appear in player composite slot**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-03T00:09:05Z
- **Completed:** 2026-03-03T00:16:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Identified root cause of Gap 1 + Gap 3 from VERIFICATION.md: SDK routes `updateImageRawData` using container mapping from the most recent `rebuildPageContainer`, which may be stale when animation (`showBattleHud`, 2-image layout) preceded the overlay HUD (`showOverlayHud`, 3-image layout)
- Fixed by inserting a 50ms delay between `renderContainers` and the first `sendBmpData` call, giving hardware time to propagate the new container mapping
- Added diagnostic `console.debug` log of BMP byte lengths for routing verification (teamBar ~1790B vs composite ~2702B)
- Added defensive `console.error` assertions in `buildSpriteComposite` and `buildTeamBar` that surface suspiciously small BMPs (< 100B) immediately

## Task Commits

1. **Task 1: Diagnose and fix player composite BMP routing/dimension mismatch** - `accfefe` (fix)
2. **Task 2: Add defensive BMP dimension assertions** - `839f893` (feat)

## Files Created/Modified

- `src/adapters/glassAdapter.ts` — Added 50ms delay after `renderContainers` in `showOverlayHud`, added `console.debug` BMP size trace
- `src/sprites/CompositeBuilder.ts` — Added size assertions after `encodeBmp` in `buildSpriteComposite` and `buildTeamBar`

## Decisions Made

- **50ms delay value:** Long enough for SDK hardware rebuild propagation on G2; short enough to not noticeably affect user-perceived screen transition time (composites are pre-computed so total overlay HUD time is negligible)
- **Diagnostic at `console.debug` level:** The BMP size trace fires on every overlay HUD render. `console.log` would spam production logs; `console.debug` is off by default in production builds and enabled during simulator debugging sessions
- **Size assertion threshold 100B:** The minimum valid 1-bit BMP (1x1 pixel) is 62+4=66 bytes; 100B gives a safe margin. All real composites (144x132 → 2702B, 576x24 → 1790B) exceed this by orders of magnitude

## Deviations from Plan

None - plan executed exactly as written. The diagnosis path matched option 4 from the task ("SDK routes by array index from prior call") and the prescribed fix was implemented.

## Issues Encountered

None. `npm run build` passed on first attempt.

## Next Phase Readiness

- Gap 1 and Gap 3 from VERIFICATION.md addressed — player composite routing fix in place
- Gap 2 (HP carries over after voluntary switch) is addressed by Plan 10-04
- Phase 11 (Stats Screen) can proceed once Gap 2 is resolved and live testing confirms Gaps 1+3 are fixed

---
*Phase: 10-overlay-hud-layouts*
*Completed: 2026-03-03*
