# Phase 08 Plan 01: Speed Scaling & Instant Mode Summary

**One-liner:** SpeedConfig wired into AnimationEngine for scaled delays/frames, plus Instant mode bypass in ScreenController with tap-to-advance

## What Was Done

### Task 1: Wire SpeedConfig into AnimationEngine timing
- Added `scaledDelay(baseMs)` method that multiplies by `SpeedConfig.multiplier()` (0 for Instant, 0.5 for Fast, 1.0 for Normal, 2.0 for Slow)
- Added `scaledFrameCount(baseCount)` method that scales cycle/step counts (returns 0 for Instant, min 1 otherwise)
- Replaced ALL bare `this.delay()` calls with `this.scaledDelay()` throughout AnimationEngine
- Scaled frame counts: HIT_FLASH_CYCLES, FAINT_FLASH_CYCLES, MAX_HP_STEPS, SWITCH_SLIDE_FRAMES
- Only remaining `this.delay()` call is inside `scaledDelay` itself (the internal primitive)

### Task 2: Add Instant mode bypass in ScreenController
- `resolveTurn()`: After animation completes, if Instant, shows turn result text via `renderTurnResult()` + `glass.showText()`, sets TURN_RESULT state, returns early
- `resolveSwitch()`: Same pattern -- shows switch log text, sets TURN_RESULT, returns early
- `startNewBattleInner()`: Skips opening intro animation entirely when Instant
- Both Instant branches have explicit `return` after setting TURN_RESULT to prevent fall-through to transition logic

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | aaa7d61 | feat(08-01): wire SpeedConfig into AnimationEngine timing |
| 2 | 923db68 | feat(08-01): add Instant mode bypass in ScreenController |

## Key Files

### Modified
- `src/animation/AnimationEngine.ts` — scaledDelay, scaledFrameCount, all timing calls updated
- `src/screens/ScreenController.ts` — Instant bypass in resolveTurn, resolveSwitch, startNewBattleInner

### Unchanged
- `src/config/constants.ts` — ANIM values remain as Normal (1x) baseline
- `src/config/SpeedConfig.ts` — No changes needed, already provides multiplier() and isInstant()

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| scaledDelay resolves immediately when multiplier is 0 | Instant mode completes all animation loops with 0 iterations — no special-casing needed in loop bodies |
| scaledFrameCount returns 0 for Instant, min 1 otherwise | 0 iterations = skip loop; min 1 for non-Instant prevents degenerate 0-frame animations |
| Early return after TURN_RESULT in Instant branches | Prevents fall-through to transitionAfterTurn which would overwrite the text display |
| Opening intro skipped entirely in Instant mode | Cosmetic switch-in animations add no value when speed is Instant |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- `npx tsc --noEmit` passes with no errors
- `npm run build` completes successfully
- Zero bare `this.delay()` calls in AnimationEngine outside scaledDelay
- SpeedConfig.isInstant() checked in resolveTurn, resolveSwitch, startNewBattleInner
- Both Instant branches have explicit early returns after TURN_RESULT

## Duration

~2.4 minutes (21:45:59Z to 21:48:22Z)
