---
phase: 09-navigation-hud-consolidation
plan: 02
subsystem: ui
tags: [typescript, gesture, battle-hud, tera, navigation, screen-controller]

# Dependency graph
requires:
  - phase: 09-01
    provides: DOUBLE_TAP GestureKind, glassAdapter mapEventToGesture, list renderers without < Back items, switchIndexMap direct mapping

provides:
  - ScreenName union without ACTION_MENU or TERA_CONFIRM
  - renderBattleHudActions() for action list overlay (Attack/Switch/Tera/Stats)
  - onDoubleTap() back navigation handler with forfeit confirmation
  - handleBattleHud() routing Attack/Switch/Tera/Stats from HUD
  - isTrapped() reading sim activeRequest for trapping detection
  - [TERA QUEUED] banner as non-selectable first list item in ATTACK_SELECT
  - Tera toggle: tap queues and opens ATTACK_SELECT, tap again un-queues and stays on BATTLE_HUD
  - Forced switch 'MUST SWITCH' status header
  - DOUBLE_TAP during animation calls skip() (same as TAP)

affects: [10-overlay-hud-layouts, 11-stats-screen]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Battle HUD dual render mode: sprite HUD (renderBattleHud) called by resolveTurn/resolveSwitch during animation; action list (renderBattleHudActions) called by render() during player decision phase"
    - "DOUBLE_TAP is back navigation, not selection -- no listIndex, routes to onDoubleTap()"
    - "Tera toggle: handleBattleHud calls render() without changing screen to stay on BATTLE_HUD when un-queueing"
    - "forfeitPending cleared by any TAP on BATTLE_HUD; auto-clears via setTimeout after 3s"
    - "[TERA QUEUED] banner prepended to items array in render() ATTACK_SELECT case; handleAttackSelect shifts moveIndex by -1 when banner present"

key-files:
  created: []
  modified:
    - src/screens/ScreenState.ts
    - src/screens/renderers/battleHudRenderer.ts
    - src/screens/ScreenController.ts
  deleted:
    - src/screens/renderers/actionMenuRenderer.ts
    - src/screens/renderers/teraConfirmRenderer.ts

key-decisions:
  - "BATTLE_HUD action list at indices 0=Attack, 1=Switch, 2=Tera, 3=Stats -- no < Back item"
  - "Tera toggle stays on BATTLE_HUD when un-queueing (does not re-open ATTACK_SELECT)"
  - "[TERA QUEUED] is a list item (not status bar) -- moves shift down by one; handleAttackSelect accounts for this"
  - "HUD-02 superseded: no 'Back to Menu' list item per CONTEXT.md -- double-tap forfeit only"
  - "isTrapped() reads sim activeRequest.active[0].trapped; returns false on any error"
  - "forfeitPending is an instance variable; first double-tap on BATTLE_HUD sets it, second forfeits"

patterns-established:
  - "Sprite HUD (renderBattleHud) is ONLY called by resolveTurn/resolveSwitch, never by render()"
  - "render() BATTLE_HUD case calls renderBattleHudActions (action list mode)"
  - "DOUBLE_TAP during animation hits skip() -- both TAP and DOUBLE_TAP skip animation"

# Metrics
duration: 16min
completed: 2026-03-02
---

# Phase 9 Plan 02: Navigation & HUD Consolidation Summary

**Double-tap back navigation, battle HUD as Attack/Switch/Tera/Stats action list, tera toggle, trapping detection, ACTION_MENU and TERA_CONFIRM eliminated**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-03-02T11:40:02Z
- **Completed:** 2026-03-02T11:55:39Z
- **Tasks:** 3
- **Files modified:** 3 (+ 2 deleted)

## Accomplishments

- Battle HUD is now a selectable action list (Attack/Switch/Tera/Stats) instead of sprite HUD that opens ACTION_MENU
- DOUBLE_TAP navigates back from ATTACK_SELECT/SWITCH_SELECT to BATTLE_HUD; double-tap on BATTLE_HUD triggers forfeit confirmation
- Tera is a toggle: first tap queues and opens ATTACK_SELECT with [TERA QUEUED] banner; second tap un-queues and stays on BATTLE_HUD
- ACTION_MENU and TERA_CONFIRM screens fully eliminated (2 renderer files deleted, ScreenName union cleaned)
- isTrapped() reads @pkmn/sim activeRequest for live trapping detection, showing 'Switch (trapped)' in HUD
- DOUBLE_TAP during animation correctly calls animationEngine.skip() (same behavior as TAP)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update ScreenState and battleHudRenderer for action list** - `9623c84` (feat)
2. **Task 2: Refactor ScreenController -- double-tap handler, HUD routing, tera toggle, trapping, screen elimination** - `6ebb556` (feat)
3. **Task 3: Delete obsolete renderer files and verify clean build** - `d1acc9c` (chore)

## Files Created/Modified

- `src/screens/ScreenState.ts` - Removed ACTION_MENU and TERA_CONFIRM from ScreenName union
- `src/screens/renderers/battleHudRenderer.ts` - Added renderBattleHudActions() export for action list overlay; renderBattleHud (sprite HUD) unchanged
- `src/screens/ScreenController.ts` - Full refactor: DOUBLE_TAP handler, handleBattleHud(), onDoubleTap(), isTrapped(), forfeitPending, tera toggle, [TERA QUEUED] banner, index offset fixes
- `src/screens/renderers/actionMenuRenderer.ts` - DELETED (ACTION_MENU screen eliminated)
- `src/screens/renderers/teraConfirmRenderer.ts` - DELETED (TERA_CONFIRM screen eliminated)

## Decisions Made

- **[TERA QUEUED] is a list item, not a status string** -- prepended to the items array in the ATTACK_SELECT render case; handleAttackSelect shifts moveIndex by -1 when it is present (idx === 0 ignored as non-selectable)
- **Tera un-queue stays on BATTLE_HUD** -- the `if (this.teraQueued)` branch in handleBattleHud calls `this.render()` WITHOUT changing `this.state.screen`, so render hits BATTLE_HUD case and shows action list, NOT ATTACK_SELECT
- **HUD-02 superseded by CONTEXT.md** -- no "Back to Menu" list item; back-to-menu is exclusively via double-tap forfeit confirmation on BATTLE_HUD
- **forfeitPending auto-clears after 3 seconds** via setTimeout; any TAP on BATTLE_HUD also clears it immediately
- **Dual render mode for BATTLE_HUD** -- sprite HUD (renderBattleHud) called directly by resolveTurn/resolveSwitch during animation; render() BATTLE_HUD case only calls renderBattleHudActions during player decision phase

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None. TypeScript compilation was clean after Task 2 with zero errors. The Task 1 compile errors (ACTION_MENU/TERA_CONFIRM references in ScreenController) were expected and resolved by Task 2.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- Double-tap navigation fully implemented and wired to glassAdapter DOUBLE_CLICK_EVENT (from 09-01)
- Battle HUD action list complete; ATTACK_SELECT/SWITCH_SELECT reachable in one tap from HUD
- Tera toggle and [TERA QUEUED] banner implemented
- Trapping detection via isTrapped() live
- Phase 10 (Overlay HUD Layouts) can proceed -- no dependencies on eliminated ACTION_MENU/TERA_CONFIRM
- Phase 11 (Stats Screen) should wire to index 3 ("Stats") in handleBattleHud when implemented

---
*Phase: 09-navigation-hud-consolidation*
*Completed: 2026-03-02*
