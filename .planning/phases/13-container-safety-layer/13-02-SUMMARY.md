---
phase: 13-container-safety-layer
plan: 02
subsystem: adapter
tags: [validation, containers, firmware-limits, REND-03]
requires: ["13-01"]
provides:
  - "assertPageContainers() — pure geometry/count/capture/name guard, zero imports"
  - "LIMITS — the measured firmware limits, in one place"
  - "GlassAdapterImpl.assertPage() — both validators before every create/rebuild"
  - "GlassAdapterImpl.declaredContainers — cumulative registry consumed by 13-03"
affects: ["13-03", "any future plan that adds a container"]
tech-stack:
  added: []
  patterns:
    - "refuse, never clamp (D-02)"
    - "two complementary validators, neither sufficient alone (D-05)"
    - "pure guard + adapter-side catch/log/rethrow, so the guard stays side-effect free"
    - "cumulative container registry, because rebuildPageContainer never removes absent containers"
key-files:
  created: []
  modified:
    - "src/adapters/containerGuards.ts (56 -> 188 lines)"
    - "src/adapters/glassAdapter.ts (694 -> 785 lines)"
    - "harness/selfCheck.ts (1036 -> 1246 lines, 41 -> 46 checks)"
    - ".planning/phases/13-container-safety-layer/deferred-items.md (new)"
decisions:
  - "Check 46 added for the containerName rule; the plan specified the rule but assigned it no check"
  - "The <=12 total rule is a backstop, not independently reachable while MAX_IMAGE + MAX_OTHER == MAX_TOTAL; check 43 asserts that relationship so it cannot rot into a dead branch"
  - "The ROADMAP's live negative scenario is NOT implemented (see Deviations)"
metrics:
  duration: "~2h"
  tasks: 3
  completed: 2026-09-18
---

# Phase 13 Plan 02: Geometry Guard and Container Registry Summary

A page the firmware would reject is now refused at the adapter with a message
naming the container id, name, offending value and limit — before any bridge
call, never by clamping — and every create/rebuild that actually succeeds is
recorded in a cumulative registry for plan 13-03.

## What shipped

**`assertPageContainers(config)`** in `src/adapters/containerGuards.ts`, still
with zero import statements. Five rules, first failure wins:

1. image `width` in [20, 288] and `height` in [20, 144] inclusive; a missing
   width or height is also a refusal
2. `<= 4` image, `<= 8` non-image, `<= 12` total
3. exactly one container with `isEventCapture === 1`
4. `containerName` at most 16 characters
5. `containerTotalNum`, when present, equals the real container count

It throws and logs nothing. `GlassAdapterImpl.assertPage()` catches,
`console.error`s the `adapter: rejected container` line and rethrows, so the
guard stays a pure function that check 42-46 can call a hundred times without a
log storm, while the refusal is still visible in the harness console stream even
if a caller swallows the exception.

`xPosition` / `yPosition` are deliberately unchecked — no measured limit exists
for them.

**Both validators run** (D-05). I re-verified the SDK's blind spots live against
0.0.15 before relying on the claim:

```
$ node --input-type=module -e "import { validateEvenHubPageContainer, ... } ..."
9999x9999 image  -> {"valid":true}
576x24 teambar   -> {"valid":true}
totalNum 13      -> {"valid":true}
13 image objects -> {"valid":true}
zero eventcapture-> {"valid":true}
```

So the SDK validator cannot be trusted for geometry or counts, and ours does not
cover z-order, menus or text brightness. Its error text is surfaced, not
swallowed — proven below.

**`declaredContainers`**, cumulative, populated at exactly three points via one
`recordPage(config)`:

1. `bootstrapStartup`, on `StartUpPageCreateResult.success`
2. `renderContainers`, the `createStartUpPageContainer` success branch that
   **returns early** before the rebuild block
3. `renderContainers`, after the rebuild retry has settled `ok === true`

and deliberately **not** on the startup-failed fall-through, which sets
`startupDone` for control flow only.

## Verification

```
$ node harness/selfCheck.ts | tail -2
OK  46/46 checks passed

$ grep -c "^import" src/adapters/containerGuards.ts
0

$ npm run typecheck        -> tsc --noEmit, exit 0
$ npm run typecheck:harness-> tsc -p harness/tsconfig.json, exit 0
$ npm run build            -> ✓ built in 5.26s
```

New checks: 42 (geometry, including the exact 576x24 defect #2 bar and both
boundary values), 43 (counts), 44 (event capture), 45 (the real page configs),
46 (containerName length).

### Falsifiability — each guard rule

Every rule was broken one at a time and the matching check observed to fail,
then restored:

| mutation                                        | result                             |
| ----------------------------------------------- | ---------------------------------- |
| upper bound `>` -> `>=`                          | 42 and 45 FAIL (288x144 refused)   |
| lower bound `<` -> `<=`                          | 42 FAILs (20x20 refused)           |
| geometry loop disabled                           | 42 FAILs (576x24 accepted)         |
| image limit widened 4 -> 5                       | 43 FAILs                           |
| non-image count rule disabled                    | 43 FAILs                           |
| capture rule `!== 1` -> `> 1`                    | 44 FAILs (zero captures accepted)  |
| `containerTotalNum` rule disabled                | 43 FAILs                           |
| name-length rule disabled                        | 46 FAILs                           |
| guard refuses EVERYTHING with a generic message  | 42, 43, 44, 45, 46 all FAIL        |

The last row is the important one: because every refusal check asserts on the
message content, the degenerate "refuse everything" guard fails the negative
checks too, not just check 45.

### Falsifiability — the adapter wiring

`esbuild`-bundled the real adapter and drove it in Node (no new dependency;
esbuild is already a Vite dependency).

Unmutated, both real configs pass the guard and only the bridge complains:

```
bootstrapStartup (legal config) -> THREW: Not connected. Call connect() first.
showOverlayHud  (TEAM_BAR_W as built) -> THREW: Not connected. Call connect() first.
```

With `OVERLAY_LAYOUT.TEAM_BAR_W` reverted to 576 — defect #2 verbatim:

```
[glass] adapter: rejected container page — image container id=8 name="teamBar" has width 576, outside the firmware limit 20-288
showOverlayHud -> THREW: adapter: rejected container page — image container id=8 name="teamBar" has width 576, outside the firmware limit 20-288
```

With a duplicate `zOrderIndex` on two overlay containers — the SDK's territory,
not ours, which proves its text is surfaced rather than swallowed:

```
[glass] adapter: rejected container page (SDK): [EvenHub:MISSING_Z_ORDER_INDEX] listObject[0] is missing zOrderIndex while another container on the same page uses it.
```

Both refusals fire before any bridge call; both constants were restored.

### Falsifiability — the registry

A stub bridge exercised all six behaviours, then each wiring point was removed
and the matching assertion observed to fail:

```
ok   point 1  bootstrapStartup success declares c1: [1]
ok   non-pt   bootstrapStartup FAILURE records nothing: []
ok   point 2  create-success early return declares c1,4,5,8: [1,4,5,8]
ok   point 3  fall-through rebuild success declares c1,4,5,8: [1,4,5,8]
ok   non-pt   rebuild FAILURE (x2) records nothing: []
ok   cumulative c8 survives showBattleHud (which omits it): [1,2,4,5,8]
```

| mutation                                   | result                                        |
| ------------------------------------------ | --------------------------------------------- |
| point 2 (the early return) removed          | point 2 and cumulative FAIL                   |
| point 3 (the rebuild) removed               | point 3 and cumulative FAIL                   |
| the non-point made to record                | "rebuild FAILURE records nothing" FAILs       |
| registry made per-page (`.clear()`)         | cumulative FAILs — c8 vanishes                |

The last row is the one the plan warned about: a per-page model loses container
8 the moment `showBattleHud` runs, which is exactly the wrong answer for 13-03.

## What did NOT work as written

**1. `npm run harness -- --only selfCheck` (task 2's verify command) was not
usable as written.** The harness refuses to run while any simulator holds
:9898, and the runner's `--only` still boots the full stack. I ran
`node harness/selfCheck.ts` plus `npm run typecheck` and `npm run build`
instead, and the full `npm run harness` for task 3.

**2. The harness would not boot at all, for a reason that had nothing to do
with this plan.** Every run failed with:

```
[uncaught] SyntaxError: Importing binding name 'formatEvenHubPageContainerValidationError' is not found.
```

The export is present in the SDK's runtime ESM, in Vite's dep pre-bundle, and in
the HTTP response Vite serves for it (all three verified individually). The
stale copy was in the **simulator's own WebKit cache**. Vite's `browserHash` is
stable across restarts, so the chunk URL is byte-identical run to run — meaning
the first time a plan imports a new named export from a pre-bundled dependency,
the webview keeps linking the module record it cached before that export was
reachable. `vite --force` changed the hash (`7ea9f767` -> `6e6d70c8`) and the
app booted; reverting to a normal start brought the failure back.

Fixed by `rm -rf ~/Library/Caches/evenhub-simulator ~/Library/WebKit/evenhub-simulator`.
Logged as **D13-A** in `deferred-items.md`: the durable fix belongs in
`harness/sim.ts`, which is outside this plan's `files_modified`.

**3. Task 3's "two consecutive green runs" was NOT achieved, and I am not going
to dress it up.** Both runs boot clean and get most of the way through a battle,
then lose one turn to the 120 s `TURN_MS` budget:

| run | result                                                              |
| --- | ------------------------------------------------------------------- |
| A   | selfCheck 46/46, boot 5/5, negativeProof 4/4, battle turns 1-5 pass, **turn-6 FAIL** |
| B   | selfCheck 46/46, boot 5/5, negativeProof 4/4, battle turns 1-4 pass, **turn-5 FAIL** |

This is the simulator being starved, not an app hang, and the simulator's own
clock proves it: lvgl stamps its uptime on every warning line, and across run
B's 123 s wall-clock gap that clock moved `(91.006, +44)` -> `(91.202, +196)` —
**0.196 s of simulator time for 123 s of wall time.** Run A's gap was 13m43s by
the same signature. Both runs then resumed and continued normally, which the
`research-14` deadlock never does.

13-02 is not on that path: `assertPage` is wired into `renderContainers` and
`bootstrapStartup` only, both gaps fall inside an `updateImageRawData` /
HP-bar-draw burst that reaches the bridge via `updateImage` / `sendBmpData`, and
both guards are pure local calls with no host round-trip. Logged as **D13-B**.

## What the plan asked me to record

- **No `adapter: rejected container` line appeared in either run.**
  `grep -c "adapter: rejected container"` is `0` for both logs. Every page the
  app actually sends is inside the measured limits.
- **The SDK validator never returned `valid: false` for a real config.**
  `grep -c "rejected container page (SDK)"` is `0` for both logs, as expected —
  the app sets no `zOrderIndex`, no menus and no `textColor`.

## Deviations from Plan

### [Rule 3 - Blocking] Simulator WebKit cache prevented the app from booting

- **Found during:** Task 3
- **Issue:** described in full above; the harness could not boot, and the error
  named one of this plan's new imports while the real cause was a stale cached
  module in the simulator.
- **Fix:** cleared the simulator's two cache directories. No code change.
- **Files modified:** none (environment only)

### [Addition] Check 46, for a rule the plan specified but did not give a check

The plan's rule 4 caps `containerName` at 16 characters but assigns no numbered
check to it; the artifact spec stops at 45. Added check 46 rather than folding
it into an unrelated check. Additive — nothing was weakened.

### [Documented] The `<= 12` total rule is a backstop, not independently reachable

`MAX_IMAGE + MAX_OTHER === MAX_TOTAL` (4 + 8 = 12), so with the plan's specified
rule order a 13-container page always trips the image or non-image rule first
and reports that count, not 13/12. The plan's check-43 wording implies a
distinct "13 total" message. Rather than reorder the rules (which would make a
5-image page report the less actionable "13 > 12"), check 43 asserts the
`MAX_IMAGE + MAX_OTHER === MAX_TOTAL` relationship explicitly, so if the limits
ever diverge the check tells the next executor to give the total rule its own
case instead of silently becoming a dead branch.

### [Documented, as the plan instructed] The ROADMAP's live negative scenario is not implemented

The ROADMAP proposes `expectLoggedLine(/adapter: rejected container/)` in a live
harness scenario that deliberately declares the old 576x24 team bar. It is not
implemented, deliberately: the harness drives the app only through inputs and
cannot make it build a bad config, so a live version would mean shipping a
deliberately-broken code path in production for a test to reach.

Check 42 proves the same refusal deterministically and in milliseconds,
including the exact 576x24 case and both boundary values; and the adapter-level
proof above demonstrates the same refusal firing through the real
`showOverlayHud`, with the real constant, before any bridge call. If a future
phase adds a dev-only fault-injection hook, the live assertion becomes free and
should be added then.

## Known gaps

- **The registry wiring has no standing regression guard.** All three population
  points are proven above, but the proof needed an esbuild bundle (the adapter
  imports the SDK and uses extensionless / `.js` specifiers Node cannot resolve),
  which `node harness/selfCheck.ts` cannot do. Nothing reads `declaredContainers`
  yet, so nothing else would notice a point being dropped. Plan 13-03 reads it
  and should bring its own checks; until then the wiring is verified but not
  defended.
- No stubs, no placeholder values, no unwired components introduced.

## Self-Check: PASSED
