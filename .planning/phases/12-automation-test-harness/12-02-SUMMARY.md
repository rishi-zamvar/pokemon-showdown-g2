---
phase: 12-automation-test-harness
plan: 02
subsystem: testing
tags: [harness, simulator, automation-api, log-capture, process-lifecycle, env_logger, zero-dep]

requires:
  - phase: 12-01
    provides: "decodePng, Frame/Region types, REGIONS map, harness/tsconfig.json, selfCheck.ts runner"
provides:
  - "Driver — zero-dependency HTTP client covering all five automation routes plus all seven input actions"
  - "waitFor — the harness's only waiting primitive (D-15: polled conditions, never fixed sleeps)"
  - "LogStream — console API and simulator stdout/stderr merged into one seq-ordered buffer"
  - "isFailureLine — the D-05 failure policy, with the stdout-only container-validation line as its primary case"
  - "startStack/SimHandle — Vite + simulator lifecycle, process-group teardown, and the HARN-02 tee"
  - "probe.ts — one-command cold-start connectivity check over the live stack"
affects: [12-03, 12-04, 13-container-safety, 19-call-count-performance]

tech-stack:
  added: []
  patterns:
    - "Zero dependencies: Node 22 global fetch, node:child_process, node:events only"
    - "Attach is opt-in and loudly announced, never a silent default"
    - "Monotonic counters as liveness evidence for a capture path that can die silently"
    - "Process-GROUP kill (negative pid) for shell wrappers that spawn their real work as children"

key-files:
  created:
    - harness/driver.ts
    - harness/logs.ts
    - harness/sim.ts
    - harness/probe.ts
  modified:
    - harness/selfCheck.ts
    - .planning/phases/12-automation-test-harness/deferred-items.md

key-decisions:
  - "Spawn the simulator with RUST_LOG=info — without it env_logger suppresses INFO and a healthy quiet boot emits 0 bytes, which turns the tee-liveness check into a coin flip"
  - "Tee BOTH stdout and stderr: env_logger writes to stderr, so a stdout-only tee captures nothing that matters"
  - "startStack throws rather than attaching by default, naming HARN-02 in the error"
  - "hostCalls records two known undercounts rather than faking a number Phase 19 must fix properly"
  - "ALLOWED_STDOUT ships empty; adding an entry requires naming one specific benign line"

patterns-established:
  - "Falsifiability: every non-trivial check was deliberately broken and observed to fail before being restored"
  - "Measured, not assumed: launch/logging behaviour verified against the real binary, and the plan corrected where it was wrong"

requirements-completed: [HARN-01, HARN-02, HARN-05]

duration: 95min
completed: 2026-09-17
---

# Phase 12 Plan 02: Simulator Driver, Log Capture & Lifecycle Summary

**The harness now cold-starts Vite and the simulator itself and reads the simulator's own log stream — where container validation failures live and where `/api/console` is provably blind: 119 console entries during a live boot, zero of which mention the two container failures the teed stream caught.**

## Performance

- **Duration:** ~95 min
- **Tasks:** 3 of 3
- **Files created:** 4 (`driver.ts` 159 lines, `logs.ts` 200, `sim.ts` 273, `probe.ts` 140)
- **Files modified:** 2 (`selfCheck.ts` +9 checks, `deferred-items.md` +2 items)
- **Checks:** selfCheck 21 → 30, all passing; probe 14 assertions, all passing

## Accomplishments

### HARN-01 — every endpoint, every action

`Driver` is a zero-dependency client over Node 22's global `fetch`. The
simulator binary's route table was dumped with `strings` to confirm the surface
is exactly five routes — `/api/ping`, `/api/screenshot/glasses`,
`/api/screenshot/webview`, `/api/console`, `/api/input` — all five covered, plus
all seven `InputAction` values exported as a runtime-iterable `INPUT_ACTIONS` so
the probe cannot drift out of sync with the type.

`waitFor` is the only waiting primitive in the harness (D-15). It swallows
exceptions while polling but appends the last one to the timeout message, so a
timeout never hides its real cause.

### HARN-02 — the stdout tee, proven against a live defect

This was the point of the phase, and it proved itself on this app during
execution. A cold run with inputs driven produced, on the simulator stream only:

```
[2026-09-17T23:11:44Z WARN  evenhub_simulator_lib::vm] update_image_raw_data: container 8 not found
[2026-09-17T23:11:53Z WARN  evenhub_simulator_lib::flutter] TextContainerUpgrade failed: container 2 not found
```

`/api/console` at that same moment held **119 entries, zero** of which mention
either failure. The console API is blind to this defect class exactly as the
research doc claimed, and the harness now is not.

Two mechanisms stop HARN-02 from switching itself off:

- `LogStream.stdoutLineCount` is monotonic — `reset()` clears `lines` and
  `lastConsoleId` but deliberately leaves it alone, so a dead tee cannot hide
  behind the per-step console clear.
- `startStack` **throws** on an already-running simulator unless `allowAttach`,
  and an attached handle reports `stdoutAvailable: false` after printing
  `HARN-02 COVERAGE DISABLED` to stderr.

### HARN-05 — failure policy

`isFailureLine` keeps its rules in three named exported arrays
(`CONSOLE_FAILURE_PREFIXES`, `CONSOLE_FAILURE_PATTERNS`,
`STDOUT_FAILURE_PATTERNS`) so Phases 13-19 can cite them. `ALLOWED_STDOUT` ships
empty. Warnings fail on both streams (D-05) — the container-validation line is a
WARN, and so is `rebuildPageContainer failed after retry`.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 — missing critical functionality] Simulator spawned with `RUST_LOG`**

- **Found during:** Task 3, first cold probe run captured 0 tee lines
- **Issue:** The plan's launch spec is `<binary> <url> --automation-port 9898`
  with no environment. The simulator uses Rust `env_logger` (confirmed:
  `env_logger-0.11.8` paths in the binary). Under the default filter INFO is
  suppressed, and a healthy quiet boot emits **0 bytes on both pipes** —
  verified by hand. The plan then asserts "The simulator logs its own startup
  banner, so this is non-zero on any healthy boot". **That claim is false for
  the launch command the plan specifies.**
- **Fix:** spawn with `RUST_LOG` (default `info`, overridable via `opts.rustLog`
  or the ambient env), plus a guard that throws if the filter resolves to
  `off`/`error` since those *would* silence the WARN-level validation lines.
- **Honest scope of the finding:** my first read was stronger than the evidence.
  Break-test A (below) removed `RUST_LOG` and the run still captured 5 lines,
  because WARN/ERROR are **not** suppressed by default — only INFO is. So
  HARN-02's core capture survives without `RUST_LOG`; what does not survive is a
  *deterministic* liveness signal, since `stdoutLineCount > 0` would then depend
  on the app happening to misbehave. `RUST_LOG=info` makes the startup banner
  unconditional and also surfaces the `evenhub_simulator_lib::flutter` container
  lines Phase 19 needs. The comment in `sim.ts` was corrected to say this rather
  than the overstated version.
- **Files:** `harness/sim.ts`
- **Commit:** `776a91c`

**2. [Rule 1 — bug] `/api/screenshot/webview` read once instead of polled**

- **Found during:** Task 3, first probe run failed with `HTTP 404`
- **Issue:** the endpoint exists but 404s until WKWebView has produced its first
  snapshot. A single read right after boot fails.
- **Fix:** wrapped in `waitFor` (D-15 compliant). `/api/screenshot/glasses` has
  no such race and answered first-try in every run.
- **Files:** `harness/probe.ts`
- **Commit:** `776a91c`

**3. [Rule 3 — blocking] Constructor parameter property crashed at runtime**

- **Found during:** Task 2 GREEN step
- **Issue:** `constructor(private readonly driver: Driver)` typechecks cleanly
  but Node's strip-only TypeScript rejects it with
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Same failure class as the `import type`
  rule: **tsc will not catch it.**
- **Fix:** explicit field + assignment, with a comment naming the trap.
- **Files:** `harness/logs.ts`
- **Commit:** `20bb790`

**4. [minor] Vite pipes are drained, not ignored**

The plan specifies `stdio: [ignore, pipe, pipe]` for even-dev but never says to
read those pipes. An unread pipe fills its buffer and blocks the child, so Vite
output is drained and mirrored as `vite| `. It is deliberately **not** fed into
`onStdout` — HARN-02 is about the simulator's stream, and Vite's banner would
otherwise trip `/ERROR/` on unrelated text.

Also used `path.join(evenDevDir, "start-even.sh")` rather than the plan's
literal `"./start-even.sh"`, to remove any ambiguity about whether a relative
command resolves against `options.cwd`.

### Where the plan was wrong

| Plan says | Reality |
| --- | --- |
| launch is `<binary> <url> --automation-port 9898` | that alone suppresses INFO; the startup banner the plan relies on never appears |
| "the simulator logs its own startup banner, so this is non-zero on any healthy boot" | false without `RUST_LOG`; a quiet boot is 0 bytes on both pipes |
| tee "both `stdout` and `stderr`" (stated as belt-and-braces) | load-bearing, not optional — env_logger writes to **stderr**; a stdout-only tee gets one stray `bounds:` println and none of the logging |
| `hostCalls()` returns `{ updateImageRawData: 2, createStartUpPageContainer: 1 }` **and** records `rebuildPageContainer` as `0` | mutually exclusive. Implemented as: zero counts are omitted from the returned object (so the stated expectation holds exactly), and `rebuildPageContainer` stays in the pattern table with a comment explaining it is structurally always 0 until Phase 19 adds a success-path log |

### Carried forward from wave 1

**D1 — the Node version guard.** Implemented verbatim in `probe.ts` for
consistency as instructed, and it is **not** claimed to deliver the version-check
truth. `ERR_UNKNOWN_FILE_EXTENSION` is raised at module resolution of the entry
file, before any code in it runs, so the guard cannot fire for its stated
purpose. The comment in `probe.ts` says so explicitly. The real fix is 12-03's
plain-JS preflight in `npm run harness`.

## Verification — real output

**1. `node harness/selfCheck.ts`** → `OK  30/30 checks passed`, exit 0.
Checks 22-30 are new: the stdout-only container-validation line, console failure
policy including a bare WARN, healthy lines *not* failing, `hostCalls` counting
both `updateImageRawData` paths, `since_id` de-duplication, blank-line handling,
`reset()` semantics, monotonic `stdoutLineCount`, and the `nextSeq()` watermark.

**2. `npm run typecheck:harness`** → exit 0.

**3. Cold start, nothing running beforehand:**

```
PASS  /api/ping
PASS  /api/screenshot/glasses — 3969 bytes, PNG signature ok
PASS  glasses PNG decodes — 576x288, 663552 rgba bytes
PASS  /api/screenshot/webview — 39914 bytes
PASS  /api/console — 0 entries, total 0
PASS  POST /api/input up / down / click / double_click / long_press / long_press_release / context_menu
PASS  HARN-02 stdout tee — 7 simulator stdout lines captured
PASS  stdoutLineCount survives reset() — 7

lifecycle: startedVite=true startedSim=true stdoutAvailable=true
PROBE OK        (exit 0)
```

**4. Refuses to attach (simulator already running):**

```
PROBE FAILED — a simulator is already running on :9898; this harness cannot tee
its stdout, so HARN-02 (container-validation capture) would be silently
disabled. Stop it, or re-run with --attach to accept that.
```

**5. Attach path (D-14), `startStack({ allowAttach: true })`:**

```
HARN-02 COVERAGE DISABLED — attached to an existing simulator on :9898; simulator stdout is not being captured.
stdoutAvailable = false | startedSim = false | startedVite = false
stop() returned

after stop():  sim pid 75257   ping: pong   vite still up: 200
```

Teardown killed nothing it did not start.

**6/7. No orphans.** After every cold run: `pgrep -f evenhub-simulator` and
`pgrep -f vite` both empty, ports 5173 and 9898 free.

## Falsifiability proof

Each check was deliberately broken and observed to fail, then restored.

| Break | Result |
| --- | --- |
| Delete `/\b(WARN\|ERROR)\b/` and `/validation failed/` from `STDOUT_FAILURE_PATTERNS` | `FAIL  22 ... stdout line was NOT classified as a failure: [... WARN ...] RebuildPageContainer validation failed: image container size 576x24 exceeds maximum 288x144` |
| Pre-populate `ALLOWED_STDOUT` with `/evenhub_simulator_lib/` | `FAIL  22` — the escape hatch is load-bearing and its emptiness is checked |
| Make `reset()` zero `stdoutLineCount` (the B2 hole) | `FAIL  29 ... reset() zeroed stdoutLineCount` |
| Detach the tee handlers (`.resume()` instead of `.on("data")`) | `FAIL  HARN-02 stdout tee — cold start captured 0 simulator stdout lines — the tee is dead`, exit 1 |
| Remove the attach refusal (`if (false)`) so it attaches silently | prints `HARN-02 COVERAGE DISABLED`, then `FAIL  HARN-02 stdout tee — stdoutAvailable is false on a cold start`, exit 1 |
| Remove `RUST_LOG` from the spawn env | **PASSED (5 lines captured)** — this is the break that corrected my own diagnosis; see Deviation 1 |

After restoring: selfCheck 30/30, typecheck 0, probe exit 0.

## Known Stubs

None. `hostCalls()` has two documented undercounts — they are recorded
inaccuracies in observed data, not stubs, and the code refuses to fabricate the
missing numbers:

1. `rebuildPageContainer` is structurally always 0. The only console line in the
   app mentioning it is the failure warning at `glassAdapter.ts:577`, so any
   "count non-failure mentions" rule yields 0 forever. **Phase 19 must add a
   success-path log inside `renderContainers` before PERF-02's "at most 2 host
   calls" can be asserted at all.**
2. `showBattleHud`'s first `updateImageRawData` (`glassAdapter.ts` ~:295) has no
   log line, so that path undercounts by one per call.

Both are fixed by Phase 19's single instrumentation point. Neither blocks this
plan's goal — D-13 requires the number be *recorded*, not exact.

## Notes for 12-03

- `startStack` is cold-start by default. Wire `--attach` through to
  `allowAttach` in `run.ts`, and print the coverage warning there too.
- All seven inputs currently return `{"ok":true}` while being dropped —
  `inject_input: no active event container`, visible only on the teed stream.
  Scenario assertions must check the framebuffer changed (deferred D4).
- The Node-version preflight belongs in the `npm run harness` script as plain
  JS, not in a `.ts` entry point (deferred D1).

## Self-Check: PASSED

- All 4 created files present on disk; SUMMARY present.
- All 4 commits resolve: `362aa4c`, `9e1561a`, `20bb790`, `776a91c`.
- Every symbol in the plan's `<interfaces>` contract is exported:
  `Driver`, `waitFor`, `InputAction`, `ConsoleEntry` (driver.ts);
  `LogStream`, `LogLine`, `isFailureLine` (logs.ts);
  `startStack`, `SimHandle`, `StackOpts` (sim.ts).
- All three `key_links` patterns present: `sim-darwin-arm64` and `onStdout` in
  sim.ts, `consoleSince` in logs.ts.
- All artifacts exceed their `min_lines`: driver 159/70, logs 200/70,
  sim 273/80, probe 140/25.
- Every type-only import uses `import type` (`ConsoleEntry`/`Driver` in logs.ts,
  `ChildProcess` in sim.ts) — checked by grep, and exercised at runtime since
  both modules load under type-stripping.
