# Phase 13 — deferred items

Out-of-scope discoveries logged during execution. Not fixed here.

---

## D13-A: the simulator's WebKit cache serves a stale Vite dep chunk (found in 13-02)

**Symptom.** Every harness run failed at `boot` with:

```
[uncaught] SyntaxError: Importing binding name
'formatEvenHubPageContainerValidationError' is not found.
```

**It was not a code bug.** The export exists in all three of:

- `node_modules/@evenrealities/even_hub_sdk/dist/index.js` (SDK 0.0.15 runtime ESM)
- `even-dev/node_modules/.vite/deps/@evenrealities_even_hub_sdk.js` (pre-bundle)
- the HTTP response Vite served for that chunk (verified with `curl`)

The stale copy lived in the simulator's own WebKit cache at
`~/Library/Caches/evenhub-simulator/WebKit/`. Vite's `browserHash` is stable
across restarts, so the URL `/node_modules/.vite/deps/@evenrealities_even_hub_sdk.js?v=7ea9f767`
is byte-identical run to run — which means **the first time a plan imports a
new named export from a pre-bundled dependency, the webview keeps linking the
module record it cached before that export was reachable, forever.**

**Repro / proof.** `vite --force` changes the hash (`7ea9f767` -> `6e6d70c8`),
the cache misses, and the app boots. Reverting to a normal start puts the hash
back to `7ea9f767` and the failure returns. `rm -rf ~/Library/Caches/evenhub-simulator
~/Library/WebKit/evenhub-simulator` fixes it permanently for that export set.

**Workaround applied in 13-02:** cleared those two directories by hand.

**Why deferred.** The fix belongs in `harness/sim.ts` (clear the simulator's
cache dirs before spawning, the way it already kills stray process groups), and
`harness/sim.ts` is outside this plan's `files_modified`. It costs one `rm -rf`
per run and removes a failure mode that costs ~25 minutes to diagnose from
scratch, because the error names an application symbol and points nowhere near
the real cause.

**Cost of not doing it:** the next plan that adds an SDK import hits this again
and has no reason to suspect the cache.

---

## D13-B: the simulator process is starved for minutes at a time (observed in 13-02)

Both 13-02 harness runs failed one mid-battle turn against the 120 s `TURN_MS`
budget, and both failures are the same thing:

| run | step   | wall-clock gap in the sim stream |
| --- | ------ | -------------------------------- |
| A   | turn-6 | `20:12:50` -> `20:26:33` = 13m43s |
| B   | turn-5 | `20:29:14` -> `20:31:17` = 2m03s  |

**It is not an app deadlock.** lvgl prints the simulator's own uptime on every
warning line. Across run B's 123 s wall-clock gap, that clock went
`(91.006, +44)` -> `(91.202, +196)` — **0.196 s of simulator time for 123 s of
wall time.** The simulator process was descheduled, not blocked on the app; and
both runs resumed and carried on normally afterwards, which the `research-14`
deadlock never does.

13-02's changes are not on this path either way. `assertPage` is wired into
`renderContainers` and `bootstrapStartup` only, and both gaps fall inside an
`updateImageRawData` / HP-bar-draw burst, which reaches the bridge through
`updateImage` / `sendBmpData` and never calls it. Both guards are pure local
function calls with no host round-trip.

Not investigated further: the plan explicitly defers multi-battle stability
verification to after 13-03. Worth knowing before that verification is
attempted, since a starved simulator will produce exactly this failure
regardless of what 13-03 does.

---

## D13-C: `npm run harness -- --only battle` fails deterministically at the first step (found in 13-03)

**Symptom.** Two consecutive `--only battle` runs failed at `battle / menu`
after exactly 1297 ms with:

```
[stdout/warn] WARN evenhub_simulator_lib::vm] inject_input: no active event container
```

The same `battle` scenario passes inside a full `npm run harness`, where the
`boot` scenario runs first. So the battle scenario injects its first input
before the app has an event-capturing container, and only gets away with it
because `boot` has already warmed the app up.

**Why it matters.** `--only battle` is the obvious way to sample the mid-battle
intermittent (D13-B) cheaply — a battle-only run is minutes shorter than a full
one. Right now that shortcut is unusable, so every sample costs a full run.

**Why deferred.** The fix belongs in `harness/scenarios/battle.ts` (wait for
MAIN_MENU before the first inject, the way `boot` does), which is outside plan
13-03's `files_modified`.

---

## D13-B follow-up (observed in 13-03)

One mid-battle turn was lost to the 120 s budget in 1 of 3 full runs, same
shape as D13-B. This time lvgl printed nothing across the gap, so there is no
simulator uptime clock to read. The structural argument that it is not an app
deadlock is recorded in `13-03-SUMMARY.md`: the turn's last activity was a
FULLY RENDERED decision screen (rebuild + both composite sends, then silence),
so the app was idle waiting for input, not mid-send — which is the opposite of
research-14's "died partway through a send burst" signature.

Still worth a real instrument rather than an argument. The cheapest one is a
timestamped automation-side log of every inject the harness sends, so "the app
never saw the input" and "the app saw it and did nothing" stop looking
identical from the outside.

---

## D13-D: `[unhandledrejection] Not all choices done` (found in 13-03, run 6 of 5 full runs)

**Symptom.** `battle / turn-6` failed after 90 847 ms with a single console
error:

```
[console/error] [unhandledrejection] Not all choices done
```

That string is the battle simulator's, not the adapter's: it rejects a choice
submitted while a side still owes one. So the app asked the sim to resolve a
turn before both sides had chosen.

**Not a container concern.** No adapter call is involved, no
`adapter: rejected container` line, no container-not-found line, and the
message reaches the console as an *unhandled rejection* — nothing awaits the
promise that produced it. The suspects are ScreenController's turn sequencing
around `submitSwitch` / `transitionAfterTurn` (which recurses) and
SimAIOpponent's auto-switch path.

**Why deferred.** Plan 13-03 owns REND-04 and REND-06 in the adapter; this is
battle-loop sequencing in `src/screens/ScreenController.ts` and
`src/battle/SimBattleAdapter.ts`, neither in `files_modified`.

**Worth noting:** this is the first time the harness has caught it, and it was
caught only because the run count went to five. It is a genuine
lose-the-battle-state defect, not noise, and the unhandled rejection means the
app has no chance to recover from it.
