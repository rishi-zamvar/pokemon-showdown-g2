---
phase: 12-automation-test-harness
plan: 03
subsystem: testing
tags: [harness, assertions, scenarios, screen-oracle, negative-proof, falsifiability, zero-dep]

requires:
  - phase: 12-01
    provides: "decodePng, Frame/Region, inkRatio/greyLevels, REGIONS, selfCheck runner"
  - phase: 12-02
    provides: "Driver, waitFor, LogStream (failure policy + nextSeq watermark + stdoutLineCount), startStack"
provides:
  - "harness/assert.ts — the ROADMAP assertion vocabulary Phases 13-19 cite by name, incl. expectFrameDiff as a documented throwing stub"
  - "npm run harness — one command, cold start, pass/fail table, PNG artifacts, result.json, non-zero exit"
  - "Ctx (capture/press/step/waitScreen/runDir) and Scenario — the contract plan 12-04 builds runBattleScript on"
  - "[screen] <NAME> cursor=<n> screen oracle in ScreenController.render()"
  - "negativeProof — the meta-scenario that fails the run if the assertions stop detecting defects"
  - "KNOWN_DEFECTS — the named, anchored, reported waiver list (the only bend in D-05)"
affects: [12-04, 13-container-safety, 14-battle-text-hud, 15-sprite-pipeline, 16-input-model, 17-context-menu, 18-inspect, 19-call-count]

tech-stack:
  added: []
  patterns:
    - "Assertion messages carry the observed value, because the message IS the failure report"
    - "Meta-testing: a scenario that fails the run when an assertion stops failing"
    - "Waivers are named, anchored, owned by a phase, and PRINTED every run — never a blanket pattern"
    - "Give up rather than time out when polling for pixels, so a blank screen still fails at the assertion"

key-files:
  created:
    - harness/assert.ts
    - harness/run.ts
    - harness/scenarios/index.ts
    - harness/scenarios/selfCheck.ts
    - harness/scenarios/boot.ts
    - harness/scenarios/negativeProof.ts
  modified:
    - src/screens/ScreenController.ts
    - harness/selfCheck.ts
    - package.json
    - .gitignore
    - .planning/G2-PLATFORM-RESEARCH.md
    - .planning/phases/12-automation-test-harness/deferred-items.md

key-decisions:
  - "D1 closed with a plain-JS `node -e` preflight in the npm script; proven by running THE SHIPPED STRING from package.json against fabricated version numbers"
  - "The two boot WARNs are allow-listed, not failed — each named exactly, anchored, owned by Phase 13/14, and printed in every run's output"
  - "waitScreen polls for lit pixels and gives up rather than timing out: the plan's 'no settle needed' claim is empirically false"
  - "boot no longer returns to a known screen after the seven-input step; negativeProof finds its own measured-blank target instead"
  - "ctx.step gains keepLogs, because the boot step's evidence predates the step and D-04's reset would delete it"

patterns-established:
  - "Every new assertion was deliberately broken, observed to fail with its real message, and restored"
  - "Stability measured by repetition: the suite was run 3x consecutively green before being called done"

requirements-completed: [HARN-03, HARN-05, HARN-06]

duration: 140min
completed: 2026-09-17
---

# Phase 12 Plan 03: Assertion Vocabulary, Runner & Negative Proof Summary

**`npm run harness` now cold-starts the stack and runs the whole suite unattended in ~11 s, and it is trustworthy for a specific reason: a scenario in the suite fails the run if `expectFrameInk` ever passes on a region the same run just measured as blank, and another fails it if a container-validation line on the simulator's stdout ever stops reaching the failure path.**

## What shipped

| Piece | What it does |
|---|---|
| `harness/assert.ts` | The eight names the ROADMAP commits to for Phases 13-19, with `expectFrameDiff` exported as a throwing stub that explains D-10 instead of a `SyntaxError` that reads like a missing feature |
| `harness/run.ts` | argv, run dir, no-sim scenarios first, `Ctx`, implicit per-scenario `expectConsoleClean`, HARN-02 tee gate, pass/fail table, `result.json`, exit code |
| `scenarios/selfCheck.ts` | 36 pure checks as scenario zero — the harness proves its own primitives before it boots anything and blames the app |
| `scenarios/boot.ts` | cold boot → MAIN_MENU → battle → all seven input actions → webview |
| `scenarios/negativeProof.ts` | the meta-scenario: HARN-03 and HARN-02 must both still be able to fail |
| `src/screens/ScreenController.ts` | one `console.log`, after the switch (see below) |

## The one line in src/

```
[screen] BATTLE_HUD cursor=0
```

placed **after `render()`'s switch closes**, not at the top. The switch is where
every decision screen awaits `showOverlayHud` (3 image sends ≈104 ms + a ≈165 ms
rebuild); a line logged at the top announces a screen ~477 ms before its pixels
exist, so `waitScreen` would return while the OUTGOING screen is still on the
framebuffer. Placement is enforced by selfCheck check 32, which fails if the
emit moves above the switch, below `updatePhoneCompanion`, or is commented out.

`git diff --stat src/` → `src/screens/ScreenController.ts | 9 +++++++++` — one
file, additions only, inside `render()`.

## The allow-list decision (the question the plan asked to be answered explicitly)

**Decision: allow-listed, not failed.** Three lines are waived; each is a REAL
app defect, named exactly, anchored, owned by a phase, and **printed at the end
of every run** under "known app defects waived … (NOT failures, but not fixed
either)".

| id | line | owner | why waived |
|---|---|---|---|
| research-10 | `update_image_raw_data: container 8 not found` | Phase 13/14 (REND-06) | team bar BMP pushed before its container exists, every boot |
| research-11 | `TextContainerUpgrade failed: container 2 not found` | Phase 13/14 | the "blank out container 2" workaround fires at a container that isn't there, every boot |
| research-13 | `lv_draw_letter: glyph dsc. not found for U+2591 lv_draw_label.c:<n>` | Phase 13/14 | **found by this harness on its first green run** |

**Why not fail:** all three are rendering defects. This phase's boundary is
"observes and changes no gameplay or rendering behaviour", so it cannot fix any
of them; failing on them would mean `npm run harness` exits 1 on every run from
the day it ships, which is the fastest way to get a harness ignored.

**What keeps this honest, given D-05 says warnings are not tolerated:**
- each entry matches ONE line, anchored at the end (`...container 8 not found$`);
  selfCheck check 35 asserts the near-misses still fail — `container 3 not
  found`, `container 8 not found, dropping 1440 bytes`, `TextContainerUpgrade
  failed: container 4 not found`, `glyph … for U+2588`, and
  `inject_input: no active event container`;
- the waiver is at the assertion layer, not in `logs.ts` — `isFailureLine` and
  `LogStream.failures()` still classify these lines as failures, so HARN-02
  itself is untouched;
- every waived line is printed in the run output and written to `result.json`;
- deleting all three (break E below) makes the boot scenario fail immediately,
  which proves the harness really does see them.

**Phases 13/14 must fix each defect and then delete its entry.** research-13 is
now row 13 of `G2-PLATFORM-RESEARCH.md`: `battleHudRenderer.ts:26` pads HP bars
with `U+2591`, which the panel font has no glyph for, so the empty part of every
HP bar draws as nothing (`U+2588` does render).

## Falsifiability: every new assertion was broken on purpose

| # | Break | Observed failure | Restored |
|---|---|---|---|
| A | comment out the `[screen]` emit | `selfCheck 32: expected exactly one [screen] emit in src/, found 0` → `FATAL: harness self-checks failed; refusing to boot a simulator and blame the app` (no simulator started). With check 32 disabled, the real consequence: `boot / boot FAIL — timed out after 60000ms waiting for: screen MAIN_MENU (after seq 0)` | yes |
| A2 | move the emit to the top of `render()` | `selfCheck 32: the [screen] emit is inside or above the switch, not after it` | yes |
| B | `expectFrameInk` lower bound → 0.99 | `boot / boot FAIL — AssertionError: CONTENT: ink 0.011 outside [0.99, 1]` | yes |
| C | invert `!(threw instanceof AssertionError)` in negativeProof | `ASSERTION SELF-PROOF FAILED: expectFrameInk passed on a blank region -- every framebuffer assertion in this suite is meaningless (observed ink 0.000, threw: AssertionError: TEAM_BAR: ink 0.000 outside [0.2, 1])` | yes |
| D | `onStdout: () => {}` (dead tee) | both gates fired: `negativeProof / harn02-tee-is-alive FAIL — HARN-02 NOT MET: no line from the simulator stdout tee has been seen…` and `FATAL: HARN-02 NOT MET: zero simulator stdout lines were captured…` | yes |
| E | empty `KNOWN_DEFECTS` | `boot / inputs-accepted FAIL — AssertionError: 6 failure line(s): [stdout/warn] … TextContainerUpgrade failed: container 2 not found ×3, … update_image_raw_data: container 8 not found ×3` | yes |

Check 31 proves the Node preflight the same way, by running the shipped string
with a substituted version: 20.19.0 / 21.9.0 / 22.0.0 / 22.17.9 → exit 1;
22.18.0 / 22.20.0 / 23.1.0 / 24.0.0 → exit 0; unmodified → exit 0.

## Deviations from Plan

### 1. [Rule 3 - Blocking] D1: the Node guard moved into the npm script

Assigned as this plan's responsibility. `"harness": "node -e \"…\" && node
harness/run.ts"` — plain JS an old runtime can load, because the failure it
targets happens at module resolution of the entry file. The in-file guards stay
as documented no-ops (verification 3c expects one `22.18` per entry point;
`selfCheck.ts` greps 2, the second being check 31's boundary data).

### 2. [Rule 1 - Bug] `ctx.step` gained `{ keepLogs }`, and the boot step uses it

As written, the plan's step 1 could not work: `ctx.step` calls `logs.reset()`,
which `DELETE`s `/api/console`, and the boot step's subject — the
`[screen] MAIN_MENU` line it waits for and the `[fetch] 404 /data/learnsets.json`
line it exists to catch — was emitted BEFORE the harness ran its first step.
The step would delete its own evidence and then time out. `keepLogs: true` plus
an explicit `since = 0` fixes it; the option is documented as being for exactly
this case.

### 3. [Rule 1 - Bug] `waitScreen`'s default `since` is wrong after `press()`

The plan says the default watermark "is correct for the common
`press(); waitScreen()` shape". It is not: `press()` polls the console itself,
so the `[screen]` line can already be buffered when `waitScreen` takes its
watermark, and the filter then skips the very line it is waiting for. Every call
site takes the watermark BEFORE the input. The contract is unchanged.

### 4. [Rule 1 - Bug] The plan's "no fixed settle after waitScreen — and why that is safe" is empirically false

The `[screen]` line is emitted after `render()`'s awaits resolve, but the
simulator's compositor lags that: `boot / boot FAIL — CONTENT: ink 0.000` fired
on roughly one run in three. Fixed the way the plan itself prescribes for this
case ("add a polled condition (`waitFor(ink > 0)`), never a `setTimeout`") —
with one addition: after a 5 s budget `waitScreen` **gives up and returns the
blank frame anyway**, so a genuinely blank screen still fails at
`expectFrameInk` with its observed ink (HARN-03) instead of hiding behind a
wait-helper timeout.

### 5. [Rule 1 - Bug] boot no longer navigates back to MAIN_MENU; negativeProof finds its own blank target

The plan has boot step 3 return to MAIN_MENU so negativeProof has a known-blank
TEAM_BAR. That is not achievable: `glassAdapter.mapEventToGesture`
(glassAdapter.ts:629) maps **every unknown `eventType`, including `undefined`,
to `TAP`**, so `long_press` / `long_press_release` / `context_menu` can each
commit a move. The seven-input storm ends somewhere different every run —
observed live as `could not navigate back to MAIN_MENU with four double_clicks`
and, after an oracle-driven rewrite, `could not navigate back to MAIN_MENU in 12
inputs (last screen: ANIMATING)`. Rather than keep adding retries to a coin
flip, the dependency was removed: `negativeProof` prefers `REGIONS.TEAM_BAR`
when it measures blank (the plan's path, and what happens on a cold boot) and
otherwise falls back to the first 48×48 block of the LIVE frame that measures
blank, printing which target it used. The proof is unchanged in kind: a region
this run measured as blank, asserted to have ink, must throw. Recorded as
deferred item D6 for Phase 16.

### 6. [Rule 2 - Missing critical functionality] Log quiescence before `expectConsoleClean`

`press()` returns when the POST is answered, but the app keeps rendering, so a
warning caused by an input could land after the step's assertion and then be
erased by the next step's `reset()` — HARN-05 as a coin flip. `boot.ts` polls
for two consecutive quiet polls (a condition, not a sleep) before asserting.

### 7. [Rule 2] Waived lines are collected before every `reset()`

First implementation only scanned at scenario end, by which time `reset()` had
cleared the buffer — the waiver list printed empty, i.e. the warnings really
were being swallowed silently. `ctx.step` now scans immediately before the
console clear and again after the body.

### 8. [Rule 2] selfCheck checks 31-36 appended (30 → 36), and `runChecks()` exported

`selfCheck.ts` was refactored to return results instead of printing a total and
exiting; the CLI entry point is guarded so importing it from a scenario does not
exit the run. No existing check was modified or weakened. The new checks cover
the preflight boundary, oracle placement, the framebuffer vocabulary, the log
vocabulary, the allow-list's near-misses, and the D-10 stub.

## Verification (real output)

```
$ npm run harness                                  # 3 consecutive runs, all EXIT=0
pass  selfCheck / harness primitives (36 checks)        0ms
pass  boot / boot                                    1364ms
pass  boot / enter-battle                            4587ms  updateImageRawData=5
pass  boot / inputs-accepted                         1548ms  updateImageRawData=11
pass  boot / webview                                  118ms
pass  boot / <console clean>                            1ms
pass  negativeProof / blank-region-must-fail           17ms
pass  negativeProof / harn02-tee-is-alive                0ms
pass  negativeProof / harn02-stdout-reaches-the-failure-path   1ms
pass  negativeProof / <console clean>                   0ms
HARNESS OK
```

- `npm run harness -- --only nonexistent` → `unknown scenario "nonexistent"; available: selfCheck, boot, negativeProof`, exit 1, no run dir, no simulator started.
- Artifacts per run: `<scenario>-NNN-<label>.png` per capture, `webview.png`, `result.json`.
- `pgrep -fl "evenhub-simulator|start-even|vite"` → nothing; `lsof -iTCP:5173 -iTCP:9898` → free, after both passing and failing runs.
- `npm run typecheck && npm run typecheck:harness` → clean.
- `git diff package.json` → one script added, zero dependencies.
- `grep -rn setTimeout harness/` → only `driver.ts:152` (the poll interval inside `waitFor`) and `sim.ts:126` (the SIGKILL escalation timer), both pre-existing; zero in the files this plan added.
- Type-only imports: the plan's grep flags value exports whose names contain a type name (`saveFrame`, `expectFrameInk`, `bootScenario`); a precise `\b`-anchored grep finds none, and the suite runs under native type stripping, which is the only check that catches this class.

## Known Stubs

- `expectFrameDiff` — exported, always throws, naming D-10. Deliberate and specified.
- `expectHostCalls` records numbers with two documented undercounts inherited from `logs.ts` (Phase 19 / PERF-04 owns fixing the instrumentation).
- `expectGreyLevels` / `expectRegionPersists` ship with unit coverage only; the first live consumer is Phase 14/15.

## Notes for the next plan (12-04)

- Take the `logs.nextSeq()` watermark BEFORE every input; never rely on `waitScreen`'s default.
- `quiesce()` lives in `boot.ts`. If 12-04 needs it too, promote it to `Ctx`.
- MAIN_MENU CONTENT ink measures **0.011** against a 0.01 floor — a thin margin. It is a smoke detector (a blank screen measures exactly 0.000), but if a menu row is ever removed, expect this bound to need widening rather than the app to be at fault.
- The suite leaves the app mid-battle by design; 12-04's battle script should start from its own cold boot or drive from the oracle.

## Self-Check: PASSED

All six created harness files, the modified `ScreenController.ts`, and this
SUMMARY exist on disk; all five commits (b54a953, 9cc387d, bdbe53f, 7993fc2,
29fb2be) are in the log. `assert.ts` 196 lines (min 80), `run.ts` 403 (min 90),
`negativeProof.ts` 137 (min 30).
