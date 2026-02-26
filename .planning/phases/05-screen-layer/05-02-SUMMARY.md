---
phase: 05-screen-layer
plan: 02
subsystem: ui
tags: [state-machine, gesture-routing, screen-controller, g2-glasses]

# Dependency graph
requires:
  - phase: 05-01
    provides: "ScreenState types, all 8 renderer pure functions"
  - phase: 03-battle-engine
    provides: "BattleEngine.startBattle(), submitAction(), submitSwitch()"
  - phase: 04-ai-opponent
    provides: "AIOpponent.pickAction() for opponent turn resolution"
  - phase: 01-data-foundation
    provides: "DataLoader.loadMatchData()/clearMatchData() for match data lifecycle"
provides:
  - "ScreenController class — full navigation state machine with gesture routing"
  - "Turn resolution flow: player action + AI action -> engine -> result -> next screen"
  - "Forced switch handling with AI auto-switch on double faint"
  - "Tera two-step flow: confirm -> select move -> TERA_ATTACK"
  - "Match data lifecycle: loadMatchData at battle start, clearMatchData on main menu"
affects: [05-screen-layer/05-03, 09-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Screen state machine with render dispatch", "Gesture -> onTap -> screen handler -> render pipeline"]

key-files:
  created: ["src/screens/ScreenController.ts"]
  modified: []

key-decisions:
  - "teraQueued flag reset in ALL paths leaving ATTACK_SELECT (back, move selection, tera confirm back)"
  - "resolveSwitch auto-switches opponent first on double faint before player switch"
  - "SCROLL_FWD/BACK and FOREGROUND_EXIT are complete no-ops — no render calls"

patterns-established:
  - "Gesture routing: handleGesture dispatches to onTap, which switches on screen state"
  - "Each screen handler is a private method for clean separation"
  - "render() is the single point of glass.showList/showText dispatch"

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 5 Plan 02: ScreenController Summary

**Screen state machine with gesture routing, turn resolution, forced switch handling, and Tera two-step flow across all 8 screens**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-26T19:52:38Z
- **Completed:** 2026-02-26T19:54:25Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Complete navigation state machine covering all 8 screen states with correct transitions
- Turn resolution: player action + AIOpponent.pickAction -> BattleEngine.submitAction -> turn result -> next screen
- Forced switch handling with AI auto-switch on double faint (opponent switches first)
- Tera two-step flow: TERA_CONFIRM sets teraQueued flag, ATTACK_SELECT sends TERA_ATTACK
- Match data lifecycle: DataLoader.loadMatchData(12 slugs) at battle start, clearMatchData on main menu return

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement ScreenController with screen transitions and render dispatch** - `1f89bad` (feat)

## Files Created/Modified
- `src/screens/ScreenController.ts` - Screen state machine: gesture routing, turn resolution, forced switch, tera flow, render dispatch

## Decisions Made
- teraQueued flag is reset in every path that leaves ATTACK_SELECT (back button, move selection) and TERA_CONFIRM back — prevents stale tera state
- resolveSwitch handles double faint by auto-switching opponent first, then player, ensuring correct BattleEngine phase transitions
- SCROLL_FWD/BACK are complete no-ops (no render call) to avoid unnecessary glass rebuilds on text screens
- On text screens (BATTLE_HUD, TURN_RESULT), listIndex is ignored — any tap triggers the single action

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ScreenController is ready to be wired into the app entry point (05-03)
- All gesture routing, battle flow, and screen transitions are complete
- Only remaining work: create main.ts entry point that instantiates GlassAdapterImpl + ScreenController and connects them

---
*Phase: 05-screen-layer*
*Completed: 2026-02-26*
