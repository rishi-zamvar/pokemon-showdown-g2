# Phase 08 Plan 02: Text Box Frame & Lunge Animation Summary

**One-liner:** Unicode double-line bordered text box for animation text plus contact move lunge animation with speed-scaled timing

## What Was Done

### Task 1: Create TextBoxRenderer and wire into AnimationEngine
- Created `src/animation/TextBoxRenderer.ts` with pure `renderTextBox(text, lineWidth)` function
- Uses Unicode double-line box drawing characters (U+2550 series) for classic RPG frame
- Word-wraps text, truncates to last 4 lines (most recent visible), pads to fill box
- Default lineWidth=62 (leaving 2-char margin on each side of 64-char G2 line)
- Wired into AnimationEngine's `updateDisplay` closure: `renderTextBox(currentText)` wraps all text before `glass.updateText()`
- Box persists across all entries in a turn (each entry replaces text inside same frame)

### Task 2: Add lunge animation for contact/physical attacking moves
- Added `LUNGE_OFFSET_PX: 10`, `LUNGE_FRAMES: 2`, `LUNGE_FRAME_MS: 60` constants
- Added `isContactMove(moveSlug)`: looks up via `DataLoader.getMove()`, returns true only if non-Status AND `flags.contact` is truthy
- Added `lungeAnimation(side, state, glass)`: shifts attacker sprite toward target using `shiftSpriteBmp()`
- Player lunges right (+offset), opponent lunges left (-offset)
- Lunge runs SEQUENTIALLY before concurrent spriteFlash/typewriter/hpDrain effects
- Snap back to original position instantly after peak offset
- Track `lastMoveSlug` from MOVE_USE entries, reset at start of each `playTurn`
- All lunge timing speed-scaled via `scaledDelay(ANIM.LUNGE_FRAME_MS)`

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | f450423 | feat(08-02): add TextBoxRenderer and wire into AnimationEngine |
| 2 | 4c3dc3c | feat(08-02): add lunge animation for contact attacking moves |

## Key Files

### Created
- `src/animation/TextBoxRenderer.ts` -- pure function for Unicode box-drawing text frame

### Modified
- `src/animation/AnimationEngine.ts` -- renderTextBox wiring, lunge animation, contact move detection, lastMoveSlug tracking
- `src/config/constants.ts` -- LUNGE_OFFSET_PX, LUNGE_FRAMES, LUNGE_FRAME_MS constants

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| lineWidth default 62 (not 64) | Leaves 1 char margin each side of 64-char G2 line for visual breathing room |
| Truncate to last 4 lines (not first 4) | Most recent text is most relevant during animation playback |
| Box always renders 4 content lines | Consistent frame height prevents visual jitter as text grows |
| isContactMove checks flags.contact, not just category | Ranged special moves (Thunderbolt) should not lunge; contact specials (Grass Knot) should |
| Lunge snaps back instantly | Per context decisions -- no smooth return animation needed |
| lastMoveSlug reset at playTurn start | Prevents stale state from previous turn leaking into current turn |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- `npx tsc --noEmit` passes with no errors
- `npm run build` (vite) completes successfully
- TextBoxRenderer.ts exports `renderTextBox`
- AnimationEngine imports and calls `renderTextBox` in updateDisplay closure
- AnimationEngine has `lungeAnimation` and `isContactMove` methods
- `LUNGE_*` constants present in constants.ts
- `lungeAnimation` uses `scaledDelay` for speed-scaled timing
- Lunge only triggers for contact moves (checked via DataLoader.getMove flags)

## Duration

~7 minutes (21:51:40Z to 21:58:50Z)
