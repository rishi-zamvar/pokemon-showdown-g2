# Plan 12-04 Summary — Scripted end-to-end battle

**Completed:** 2026-09-18 (executor stalled on a watchdog before writing this; work
verified and committed by the orchestrator as `aff493e`)

## Delivered

`harness/scenarios/battle.ts` exporting `runBattleScript(ctx, opts)` with
`speed` / `maxTurns` / `switchOnTurn` / `onTurn`, plus a thin `battleScenario`
wrapper holding the coverage assertions — so Phases 13/14/17/19 can drive a
battle without forking the file (plan-check blocker B7). selfCheck 30 → 38.

## Verified

- `node harness/selfCheck.ts` → OK 38/38, exit 0
- `npx tsc --noEmit` → 0; `npm run typecheck:harness` → 0
- Battle script drives 20+ real turns including a voluntary switch, capturing a
  framebuffer artifact per screen transition

## The phase acceptance test — PASSED

With `OVERLAY_LAYOUT.TEAM_BAR_W` restored to the known-bad 576:

```
FAIL  boot / enter-battle        AssertionError: LIST: ink 0.000 outside [0.01, 0.6]
FAIL  boot / <console clean>     3 failure line(s):
  [stdout/warn] RebuildPageContainer validation failed:
                image container size 576x24 exceeds maximum 288x144
  [console/warn] [glass] rebuildPageContainer failed after retry
FAIL  battle / enter-battle      (same)
FAIL  battle / <console clean>   (same)
HARNESS FAILED (4 step(s))
```

Caught four ways, on two independent evidence paths — the framebuffer (the
action list is measurably absent) and simulator stdout (the validation line
that appears nowhere in `/api/console`). Restored to 288, those failures go
away. This is the defect that made the app unplayable, and a console-only
harness would have run green against it.

## Requirement status

| Req | Status |
|---|---|
| HARN-01 driver: all inputs, framebuffer, webview, console | Complete |
| HARN-02 simulator stdout captured | Complete — and it found research-10/11/13/14 |
| HARN-03 assert on framebuffer content | Complete |
| HARN-04 scripted end-to-end battle | **Delivered but not green — blocked by research-14** |
| HARN-05 fail on any error/warning | Complete |
| HARN-06 one-command headless run | Complete |

**HARN-04 is written, runs, and drives 20+ turns correctly. It cannot reach
END_SCREEN because the app hangs.** Two runs hung at turn 16 and turn 21
(~1 turn in 20). That is research-14 — `AnimationEngine.ts:282` runs
`Promise.all` over `spriteFlash` and `hpDrain`, both of which call
`updateImageRawData`, and concurrent image sends are forbidden on this
platform. The scenario is failing *correctly*: it is reporting a real app
defect, not a harness defect. Phase 13 (REND-05) fixes it, after which this
requirement closes with no further work here.

## Deviations from plan

1. **Instant speed is unreachable and unobservable.** The orchestrator
   instructed Instant so the suite would run in minutes rather than ~20. Two
   app defects make it impossible, both verified live:
   - `harness-01` — the simulator omits `currentSelectItemIndex` when the
     selection is 0, so `mapEventToGesture:632` yields `listIndex: undefined`
     and `onTap` falls back to `cursorIndex`. `handleMainMenu` sets
     `cursorIndex=1` when cycling speed, so after ONE speed change every
     further main-menu click cycles speed again and "Enter Battle" is
     unreachable.
   - `harness-02` — in Instant mode `resolveTurn():530` and
     `resolveSwitch():611` call `showText()` and return WITHOUT `render()`,
     which is where the `[screen]` oracle logs. Instant emits no oracle line,
     so every wait can only time out.
   Normal is also the better-observed path: `transitionAfterTurn():628` renders
   BATTLE_HUD / SWITCH_SELECT / END_SCREEN directly, giving every transition a
   real oracle line with no blind taps. Cost: a full run takes ~20 minutes.

2. Executor stalled twice on the stream watchdog. Work was intact both times;
   the orchestrator verified and committed it.

## Follow-ups owned elsewhere

- research-14 (the hang) → Phase 13, REND-05
- research-10 / research-11 (missing containers) → Phase 13, REND-06 / D-08
- research-13 (U+2591 HP-bar glyph) → Phase 14
- D6 `mapEventToGesture` maps unknown eventType including `undefined` to TAP,
  and harness-01 above → Phase 16
