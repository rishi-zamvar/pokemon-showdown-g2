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
