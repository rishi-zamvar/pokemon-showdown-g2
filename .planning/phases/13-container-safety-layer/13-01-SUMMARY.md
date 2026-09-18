---
phase: 13-container-safety-layer
plan: 01
subsystem: adapters
tags: [sdk, concurrency, send-queue, even-hub, harness]

requires:
  - phase: 12-automation-test-harness
    provides: "npm run harness, per-step host-call counts, the [screen] oracle — the evidence that diagnosed research-14 and the evidence that it is gone"
provides:
  - "SendQueue — a serialising choke point for every SDK send (src/adapters/containerGuards.ts)"
  - "all 13 bridge call sites in glassAdapter.ts routed through one private call() helper"
  - "selfCheck 39/40/41: deterministic, timer-free regression guard for the serialisation invariant"
  - "one log shape per updateImageRawData — showBattleHud's inline duplicates collapsed onto sendBmpData"
affects: [13-02, 13-03, 14-battle-text-hud, 19-call-count-performance]

tech-stack:
  added: []
  patterns:
    - "choke-point invariants: enforce platform rules in the adapter, never at the call site"
    - "enqueue at the leaf only — one bridge call per queued task, so nothing can self-deadlock"
    - "falsifiability check paired with every concurrency check (41 proves 39's detector is live)"

key-files:
  created:
    - src/adapters/containerGuards.ts
  modified:
    - src/adapters/glassAdapter.ts
    - harness/logs.ts
    - harness/selfCheck.ts

key-decisions:
  - "D-06 honoured literally: AnimationEngine.ts is untouched; Promise.all still runs its branches concurrently, their SDK sends just land one at a time"
  - "One queue for ALL SDK calls, not just images — a rebuildPageContainer racing an updateImageRawData is the same class of bug and one queue is less code than two"
  - "tail.then(fn, fn) rather than tail.then(fn): a rejected send must not wedge the sends behind it"
  - "sendBmpData's `if (!this.bridge) return` deleted — a null bridge there is a programming error, and returning silently produced a sprite that never appeared with nothing in any log"
  - "Task 3's three-consecutive-run corroboration deferred to after 13-03 by explicit instruction; one full green run taken as integration evidence"

patterns-established:
  - "containerGuards.ts imports NOTHING, so the harness can load it in Node (strip-only, explicit .ts) while the adapter loads it through Vite (extensionless)"
  - "Deleting a log pattern from HOST_CALL_PATTERNS requires a check asserting the dead shape now counts zero"

requirements-completed: [REND-05]

duration: 48min
completed: 2026-09-18
---

# Phase 13 Plan 01: Serialising Send Queue Summary

**The intermittent mid-battle hang is gone: every SDK send in the app now passes through a single `SendQueue` in the adapter, so two `updateImageRawData` calls are never in flight at once no matter which caller issued them — and the battle got 2x FASTER, not slower.**

## Performance

- **Duration:** ~48 min (incl. one ~5 min full harness run)
- **Started:** 2026-09-18T19:35:56Z
- **Completed:** 2026-09-18T20:24Z
- **Tasks:** 3 (task 3 partially deferred by instruction — see Deviations)
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- `SendQueue` (`src/adapters/containerGuards.ts`) serialises every SDK send and isolates rejections, in 12 lines of logic and zero dependencies.
- All **13** direct `this.bridge.*` invocations routed through one private `call()` helper. Grep count went 13 → 0; `queue.run` appears exactly once in the file.
- `showBattleHud`'s inline copies of `sendBmpData` deleted, so one host call has one log shape. The per-turn `updateImageRawData` count — the evidence that diagnosed the bug — is preserved exactly.
- A full 27-turn Normal-speed battle reached `END_SCREEN` with `HARNESS OK`. The two pre-change runs hung at turn 16 and turn 21.

## Task Commits

1. **Task 1: SendQueue, the serialising choke point** — `ca2fde2` (feat)
2. **Task 2: Route every bridge call through the queue** — `d31dc77` (feat)
3. **Task 3: Battle-run evidence** — this SUMMARY (three-run corroboration deferred, see Deviations)

## The grep obligation

```
$ grep -cE "this\.bridge\.(updateImageRawData|textContainerUpgrade|rebuildPageContainer|createStartUpPageContainer)" src/adapters/glassAdapter.ts
13      # before
0       # after
```

13 call sites became 11 `this.call(...)` sites, because the two in `showBattleHud`
were consolidated onto `sendBmpData` (which has one `call()` of its own). The
number of bridge invocations at runtime is unchanged; all of them are queued.
`onEvenHubEvent` at :584 is a subscription, not a send, and is correctly excluded.

## Proof

### Deterministic (the regression guard)

```
$ node harness/selfCheck.ts
...
PASS  25 hostCalls counts every updateImageRawData through sendBmpData
PASS  39 SendQueue.run does not start task N+1 until task N settles
PASS  40 a rejected send does not poison the queue
PASS  41 the concurrency detector used by check 39 can still detect concurrency

OK  41/41 checks passed
```

Every task settles manually — no timers anywhere in 39-41, because a sleep-based
test of an intermittent concurrency bug is a coin flip.

### Falsifiability

Three deliberately broken queues, each caught by a different check:

| Break | Result |
|---|---|
| A — `run()` returns `fn()` immediately (no serialisation) | **FAIL 39** "queue started more than one task at once"; 40, 41 pass |
| B — `tail = tail.then(fn)` (rejection poisons the chain) | **FAIL 40** "send failed"; 39, 41 pass |
| C — `run()` returns a promise that never settles | **FAIL 39**, then the run stalls on check 40 — a queue that runs nothing cannot pass |
| restored | `OK 41/41 checks passed` |

Check 41 is the guard on the guard: it runs the *same* deferred tasks under a
bare `Promise.all` and asserts all three report started with none settled. It
passed under every break, which is what makes 39/40's passes meaningful.

### Typecheck / build

```
$ npx tsc --noEmit            -> exit 0
$ npm run typecheck:harness   -> exit 0
$ npm run build               -> ✓ built in 5.08s
```

## Measured cost: the prediction was wrong, in our favour

Task 1 predicted **+2-5 seconds per turn** (queueing turns `max(branches)` into
`sum(sends)`). Measured against the last green pre-change run — same 27-turn
battle script, same aggregate send profile, different randbats seed:

| | pre-change (15:37, green) | post-change (19:40, green) |
|---|---|---|
| turns | 27 | 27 |
| total turn wall time | 670.8 s | **306.9 s** |
| median turn | 23.3 s | **9.8 s** |
| slowest turn | 52.2 s | **21.9 s** |
| `updateImageRawData` total | 322 | 310 |
| ms per send | 2083 | **990** |

Serialising made the battle **2.2x faster per send**, not slower. The likely
reason: overlapping sends were not free before — they contended on the bridge
and each one stalled. The queue removed the contention as well as the deadlock.
Nothing came near the 120 s `TURN_MS` budget; the slowest turn used 18% of it.

**Caveat:** randbats seeds differ between runs, so this is not a controlled A/B.
The direction and magnitude are consistent at every quantile, and the normalised
ms-per-send figure controls for battle length, so the finding is reported as
"clearly not a regression" rather than "exactly 2.2x".

### Host calls per turn — the truncation signature is gone

| | hung turn (pre-change) | healthy turns |
|---|---|---|
| 16:24 run | turn-16: **5**, timeout at 120 s | 10-17 |
| 16:37 run | turn-21: **5**, timeout at 120 s | 10-21 |
| 19:40 run (post-change) | none | 10-17, plus turn-27 = 7 |

Turn-27's 7 is the battle-ending turn (fewer animation entries, then
`END_SCREEN` passed 22 ms later), not a truncated send sequence.

## Deviations from Plan

**1. [Instruction] Task 3's three consecutive runs deferred**

- **Found during:** Task 3
- **Issue:** The plan requires three consecutive green `npm run harness` runs. The executing instruction explicitly deferred that verification to after plan 13-03.
- **Action:** Ran the suite **once**, cold, green, 27 turns to `END_SCREEN`. The deterministic proof (checks 39-41) is in place and is the actual regression guard; the runs were only ever corroboration.
- **Outstanding:** the 3x battle corroboration and its `(1-0.64)³ ≈ 0.05` argument still owe a run after 13-03.

**2. [Rule 2 - Correctness] Check 25 gained a negative assertion**

- **Found during:** Task 2
- **Issue:** The plan required updating check 25 because its second half described a deleted log path. Updating it to describe the surviving path alone would not catch a `HOST_CALL_PATTERNS` entry kept for a call site that no longer exists.
- **Fix:** Check 25 now also asserts the *old* log shape counts **zero**, so a stale pattern is a test failure instead of silent dead weight.
- **Files modified:** harness/selfCheck.ts (commit `d31dc77`)

**3. [Rule 3 - Blocking] `flush()` instead of a single `await Promise.resolve()`**

- **Found during:** Task 1
- **Issue:** The plan calls for `await Promise.resolve()` before each assertion block and warns not to "fix the queue" when it fails. One turn is enough for the *first* block, but not after resolving a task: a `.then` handler returning a thenable costs several more microtask turns for promise adoption, so blocks 2 and 3 would have failed against a correct queue.
- **Fix:** `flush()` drains 10 microtask turns. Still deterministic, still timer-free, cannot flake. The check was fixed, not the queue — exactly as the plan directed.
- **Files modified:** harness/selfCheck.ts (commit `ca2fde2`)

## Known Stubs

None. `SendQueue` is complete for its purpose; 13-02/13-03 add the geometry and
dimension guards to the same file, which is why the file is named for the layer
rather than the queue.

## Not done on purpose

- `AnimationEngine.ts` — untouched, per D-06.
- The 50 ms sleep at `glassAdapter.ts:449` — still there, still deferred. The
  queue stops sends *overlapping*; it does not make a caller's
  rebuild-then-send sequence atomic, because the delays and the intervening app
  code sit outside the queue.
- Both try/catch workarounds (teamBar blank, container-2 blank) — kept verbatim,
  owned by 13-03. The `if (this.bridge)` wrappers around them are gone, so a
  null bridge now throws into the same catch instead of skipping the block.
- Waived defects printed by the run are exactly the expected three:
  research-10, research-11, research-13. 13-02/13-03 remove the first two.

## Environment

No orphaned processes; ports 5173 and 9898 free after the run.

## Self-Check: PASSED

All created/modified files exist on disk; both task commits (`ca2fde2`,
`d31dc77`) are in the log; the post-change grep count is 0; `SendQueue` is
exported from a 56-line file with zero imports.
