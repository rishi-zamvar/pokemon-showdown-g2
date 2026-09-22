# Deferred items — Phase 13.1

Out-of-scope discoveries logged during execution. Not fixed here.

## sprite-146 — `public/sprites/back/146.png` is missing

**Found:** 13.1-02, full harness run 2026-09-22 (`.harness-runs/2026-09-22T17-35-48-783Z`)

**Symptom:** the run fails `battle / enter-battle` and `battle / <console clean>` with

```
[console/error] [SpriteBmpEncoder] Failed to convert /sprites/back/146.png: {}
```

**Cause:** an asset gap, not a code defect. `public/sprites/front/` holds 1025
files and `public/sprites/back/` holds 1024. The single missing file is
`146.png` (Moltres) — its neighbours `145.png` and `147.png` are both present
back and front. `front/146.png` exists.

**Why it is out of scope for 13.1-02:** nothing in this plan touches sprites,
asset loading or `SpriteBmpEncoder`. It surfaces at random, only when Moltres
is rolled onto the player's team by the Gen 9 random-battle generator, which is
why the suite was green on the immediately preceding run with the same code.

**Fix when picked up:** add the one missing file, and consider a build-time or
selfCheck assertion that `front/` and `back/` hold the same id set — one
missing sprite currently fails a whole battle run with an error that reads like
an encoder bug.

## D13-D recurrence — `[unhandledrejection] Not all choices done`

**Found:** 13.1-02, full harness run 2026-09-22
(`.harness-runs/2026-09-22T17-37-11-592Z`), `battle / turn-12` after turns
1-11 passed.

Already filed as **D13-D** in
`.planning/phases/13-container-safety-layer/deferred-items.md`. Not re-filed,
only cross-referenced: the recurrence confirms it is still live and still
intermittent. That item attributes it to battle-loop sequencing in
ScreenController's `submitSwitch` / `transitionAfterTurn` recursion and
SimAIOpponent's auto-switch path — none of which 13.1-02 touches. 13.1-02's
edits to ScreenController are confined to `render()`'s showList arguments,
`handleGesture`'s MENU_ITEM case, the new `onMenuItem`, `onDoubleTap`'s
MAIN_MENU no-op and `handleMainMenu`.

## cold `--only battle` races the app's first page

**Found:** 13.1-02, `npm run harness -- --only battle`
(`.harness-runs/2026-09-22T17-36-41-357Z`).

`battle / menu` failed on two `inject_input: no active event container`
warnings. The simulator log shows both warnings landing BEFORE the app's
`CreateStartUpPageContainer` line — `ensureMainMenu`'s recovery round fires
inputs while no page, and therefore no event-capture container, exists yet.

Independent of 13.1-02 (there was no UI at all at that instant). The supported
order is the full suite, where `boot` waits for MAIN_MENU first and
`battle / menu` passes; `scenarios/index.ts` already documents that the order
is load-bearing. If cold `--only battle` is meant to be supported,
`ensureMainMenu` needs to wait for the first page before its first input.
