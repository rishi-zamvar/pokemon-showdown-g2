---
phase: 13-container-safety-layer
plan: 03
subsystem: adapter
tags: [validation, containers, image-data, firmware-limits, REND-04, REND-06]
requires: ["13-01", "13-02"]
provides:
  - "imageDataDimensions() — BMP/PNG header reader, zero imports"
  - "assertImageUpdate() — payload dimensions must equal the container's declaration"
  - "assertContainerDeclared() — an update to an undeclared container is refused, not swallowed"
  - "GlassAdapterImpl.declaredContainers — now PER PAGE, not cumulative"
  - "sendBmpData as the single guarded image path; updateImage delegates to it"
  - "KNOWN_DEFECTS reduced to research-13; check 35 fails on both deleted lines"
affects: ["14", "15", "19"]
tech-stack:
  added: []
  patterns:
    - "read the payload's own header rather than trusting the caller"
    - "refuse, never clamp (D-02) — extended from page geometry to image data"
    - "ask the registry, do not catch the answer (D-08)"
    - "per-page container registry: a rebuild replaces the container table"
key-files:
  created: []
  modified:
    - "src/adapters/containerGuards.ts (188 -> 314 lines, still zero imports)"
    - "src/adapters/glassAdapter.ts (785 -> 791 lines, both blanking try/catch blocks deleted)"
    - "harness/selfCheck.ts (1246 -> 1497 lines, 46 -> 52 checks)"
    - "harness/assert.ts (3 -> 1 KNOWN_DEFECTS entries)"
    - "harness/logs.ts (host-call doc block rewritten)"
    - ".planning/REQUIREMENTS.md (REND-04, REND-06 ticked)"
decisions:
  - "Checks numbered 47-52, not 46-51: check 46 was taken by 13-02's containerName rule, which landed after this plan was written"
  - "declaredContainers is PER PAGE, reversing 13-02's cumulative design. rebuildPageContainer DOES remove absent containers; the boot log proves it, and the cumulative map was itself the cause of research-11"
  - "assertContainerDeclared exported separately so the text path gets the same refusal without a dimension check"
  - "imageDataDimensions refuses an unrecognised payload rather than guessing from file length"
  - "D-07 is satisfied by construction: ImageContainerProperty has no image-data field, so the state is unrepresentable"
metrics:
  duration: "~1h45m"
  tasks: 3
  completed: 2026-09-22
---

# Phase 13 Plan 03: Image Dimension Guard and Waiver Cleanup Summary

Image data whose header dimensions differ from its container's declaration is
now refused before the ~104 ms host call, every image send in the app —
including the animation path, which previously had no guard and no log line —
goes through that one choke point, and both container-not-found waivers are
deleted because both defects stopped occurring.

## What shipped

### REND-04 — the payload has to be the size the container says

`src/adapters/containerGuards.ts`, still with zero import statements:

- `imageDataDimensions(data)` reads BITMAPINFOHEADER (little-endian, offsets 18
  and 22, `Math.abs` on the height because a negative height is a legal
  top-down BMP) and PNG IHDR (big-endian, offsets 16 and 20). Anything else is
  refused by name, quoting the leading bytes and the length. It never guesses
  from file size.
- `assertImageUpdate(id, declared, data)` refuses when the container was never
  declared, when it is declared as the wrong kind, when the payload is
  unrecognised, or when its dimensions differ from the declaration in either
  direction.
- `assertContainerDeclared(id, declared)` is the existence half on its own, for
  text updates, and is a TypeScript `asserts` predicate so the caller narrows.

`GlassAdapterImpl.sendBmpData` calls `assertImageUpdate` before the log line, so
a refused send is never counted as a host call. `updateImage` — the animation
path — now delegates to `sendBmpData` instead of issuing its own
`updateImageRawData`, so every frame is guarded and counted.

The guard is 8 bytes of header arithmetic. It adds no host calls and does not
re-render "to be safe".

### REND-06 — no phantom updates, and the cause rather than the catch

Both blanking try/catch blocks are gone. `grep -n "catch" glassAdapter.ts`
leaves two, both pre-existing and unrelated (`assertPage`'s catch-log-rethrow
and `createStartUpPageContainer`'s fall-through).

- `showOverlayHud`'s container-2 blank is gated on
  `this.declaredContainers.has(CONTAINER_IDS.status)`.
- `updateText`'s `content` and `status` upgrades call `assertContainerDeclared`
  and refuse loudly — those two are always declared, so a refusal there is a
  real regression and must be visible.
- `updateText`'s `statusRight` proxy (`if (status.right)`, with a comment that
  already admitted it was standing in for an existence test) now also asks the
  registry.

### The container 4/5 declaration fix (task 2 step 0)

`showBattleHud` declares containers 4 and 5 unconditionally, falling back to
`blankSprite()` when the sprite argument is undefined. Without it the REND-04
guard is a landmine: `battleHudRenderer.ts:164-165` regularly yields
`undefined`, the container was then omitted, and
`AnimationEngine.switchAnimation` sends three 96x96 frames unconditionally.

One visible consequence, and it is an improvement: a missing sprite now reads as
an empty slot instead of leaving whatever was last rendered there. Do not "fix"
that back.

## THE HOST-CALL BASELINE MOVED — the old 10-21 figure no longer applies

Routing `updateImage` through `sendBmpData` means the animation path is counted
for the first time. Observed `updateImageRawData` per battle turn across
five full runs, 80 completed turns:

| run | turns | per-turn range |
| --- | ----- | -------------- |
| 1   | 38    | 8 - 49         |
| 2   | 2     | 27, 52         |
| 3   | 19    | 22 - 76        |
| 6   | 5     | 8 - 64         |
| 7   | 16    | 16 - 50        |

**New baseline: 8-76 `updateImageRawData` per turn, typically 16-50.** The
familiar "10-21 per healthy turn, 5 on the hung turn" figure that diagnosed
research-14 counted only SCREEN RENDERS — every sprite flash, slide frame and
switch-in frame was invisible to it. A 60-call turn is now normal and is not a
regression. Phase 14 must not read it as one, and Phase 19 must set PERF-02 /
PERF-04's ceilings against this count, not the old one: animation is the
hottest consumer of ~104 ms calls and it has been a blind spot until now.

Non-turn steps for reference: `enter-battle` = 16, `menu` = 4,
`inputs-accepted` = 6.

## D-07 is satisfied by construction, not by a task

REND-06's text says "no image data during `createStartUpPageContainer`". The
SDK's `ImageContainerProperty` has no image-data field at all, so that state is
unrepresentable — there is nothing to guard and no task names D-07. The half of
REND-06 that actually needed building is the other one: refusing an update to a
container the current page does not declare. That is task 2, and it is why
REND-06 is ticked without a D-07 task.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The container registry had to become PER PAGE, reversing 13-02's cumulative design**

- **Found during:** Task 2, on the first `--only boot` run after the fix
- **Issue:** the plan's step 3 (`if (this.declaredContainers.has(status))`) did
  not stop research-11. The line still fired 3x per boot. The boot log shows
  why: the FIRST `showOverlayHud` blanks container 2 successfully, the rebuild
  that follows declares only containers 1, 4 and 5, and the very next
  `showOverlayHud`'s blank comes back `container 2 not found`. So
  `rebuildPageContainer` **does** remove containers absent from the new config,
  and 13-02's premise that it does not — the premise the cumulative registry
  was built on — is wrong. The cumulative map was itself the proximate cause of
  research-11: it claimed container 2 existed after the rebuild had destroyed it.
- **What actually persists across a rebuild is the PIXELS, not the container.**
  lvgl does not clear the canvas, so stale status text stays visible while the
  container behind it is gone. That is why the blank still has to happen on the
  first overlay (while the container is alive) and must be skipped on every one
  after it — and why the leftover pixels are Phase 14's problem, not something
  a `textContainerUpgrade` can reach.
- **Fix:** `recordPage` clears the map before recording. Plan 13-02's field
  comment was rewritten to say what the log actually shows.
- **Files modified:** `src/adapters/glassAdapter.ts`
- **Commit:** `144f182`
- **Proof:** live break 2 below — restoring the cumulative behaviour brings the
  defect straight back, 15 occurrences in one boot.

**2. [Rule 3 - Blocking] Checks numbered 47-52, not 46-51**

Check 46 already existed (13-02's containerName rule, added after this plan was
written). Numbering from 46 would have produced two check 46s.

**3. [Rule 3 - Blocking] `emptyTeamBarBmp` import deleted from glassAdapter.ts**

It became dead when commit `3c2ea4d` removed the team bar and the container-8
blanking workaround with it. `blankSprite` from `../animation/SpriteEffects`
replaces it as the step-0 fallback.

### The app had changed since the plan was written

Commit `3c2ea4d` (user-driven) removed the team bar. `showOverlayHud` now
declares two image containers, not three, and the container-8 workaround the
plan's task 2 step 2 was written against no longer exists. Nothing was needed
there.

## Waivers deleted (D-10)

Both deleted in commit `144f182`, the same commit that stops them occurring.

- **research-10** (`update_image_raw_data: container 8 not found`) — **fixed by
  the team-bar removal in `3c2ea4d`, not by this plan's REND-06 work.** Once
  container 8 is never created and never blanked, the send is structurally
  impossible. Verified absent on every run since. The waiver is deleted because
  the defect is gone, and the record should say so accurately.
- **research-11** (`TextContainerUpgrade failed: container 2 not found`) — fixed
  here, by the per-page registry. Deviation 1 above.
- **research-13** (U+2591 HP-bar glyph) **kept**. It is Phase 14's, it still
  fires, and it is the only line the footer prints.

`harness/selfCheck.ts` check 35 was renamed and both lines moved from its
`waived` array into `notWaived`, so from here on either defect coming back fails
the run instead of being printed in a footer nobody has to act on.

`harness/logs.ts`'s host-call doc block was rewritten: KNOWN INACCURACY 2
(showBattleHud's first `updateImageRawData` having no log line) is closed, the
deleted "two image patterns" paragraph is gone, and the baseline change above is
recorded there too. KNOWN INACCURACY 1 (`rebuildPageContainer` is a known-zero
placeholder) is untouched — still Phase 19's.

## Proof

### selfCheck: 52/52, and every new guard is falsifiable

Each break below was applied alone and reverted immediately.

| break                                                   | result                                                 |
| ------------------------------------------------------- | ------------------------------------------------------ |
| dimension comparison replaced with `if (false)`          | FAIL 50 "expected a refusal, the guard accepted it"    |
| BMP height read without `Math.abs`                       | FAIL 47 deep-equal (top-down BMP reports -132)         |
| `DataView` constructed without `byteOffset`              | FAIL 47 deep-equal (reads the wrong bytes)             |
| unrecognised payload returns `{0,0}` instead of refusing | FAIL 48 "expected a refusal"                           |
| undeclared-container check replaced with `if (false)`    | FAIL 52 (`Cannot read properties of undefined`)        |
| research-11 waiver re-added                              | FAIL 35 "allow-list swallowed: ...container 2 not found" |
| research-10 waiver re-added                              | FAIL 35 "allow-list swallowed: ...container 8 not found" |
| research-13 waiver deleted (Phase 14's)                  | FAIL 35 "1 failure line(s)" — correctly refuses to let me take it |

### Live falsifiability, against the real simulator

**Break 1 (REND-04).** `showOverlayHud` declares container 4 as
`COMPOSITE_H - 1` = 144x131 while still sending the real 144x132 composite —
the exact tiling shape. `npm run harness --only boot` exits 1:

```
adapter: rejected container 4 — "oppSpr" is declared 144x131 but the payload is
144x132; the firmware TILES a mismatch instead of erroring, so this would render
something plausible and wrong with nothing in any log
  refuseUpdate@.../containerGuards.ts
  assertImageUpdate@.../containerGuards.ts:131
  sendBmpData@.../glassAdapter.ts:543
  showOverlayHud@.../glassAdapter.ts:395
```

**Break 2 (REND-06).** Remove the one `this.declaredContainers.clear()` line,
restoring 13-02's cumulative registry. `--only boot` exits 1 with 15
occurrences of `TextContainerUpgrade failed: container 2 not found` and
`FAILED boot / <console clean>` — which is also the proof that the deleted
waiver's regression guard works end to end.

Both restored; `git diff --quiet src/adapters/glassAdapter.ts` clean afterwards.

### Commands

```
$ node harness/selfCheck.ts
OK  52/52 checks passed

$ npx tsc --noEmit           # npm run typecheck
$ npm run typecheck:harness
$ npm run build
✓ built in 5.59s

$ grep -c "^import" src/adapters/containerGuards.ts
0

$ grep -n "catch" src/adapters/glassAdapter.ts
105:    } catch (e) {        # assertPage, pre-existing, rethrows
632:      } catch (e) {      # createStartUpPageContainer fall-through, pre-existing
```

### Full harness runs — five of them, two green

The plan asked for three consecutive green runs. I got 2 of 3, so I ran two
more rather than re-running until the answer was convenient. All five, honestly:

| run | result         | turns | how it ended                                    |
| --- | -------------- | ----- | ----------------------------------------------- |
| 1   | HARNESS OK     | 38    | waived footer: research-13 only                 |
| 2   | HARNESS FAILED | 2     | turn-3 lost to the 120 s budget                 |
| 3   | HARNESS OK     | 19    | waived footer: research-13 only                 |
| 6   | HARNESS FAILED | 5     | turn-6, `[unhandledrejection] Not all choices done` |
| 7   | HARNESS FAILED | 16    | turn-17 lost to the 120 s budget                |

80 turns observed. **Zero `adapter: rejected container` lines in any of the
five** — the guards refuse nothing the app really sends. Zero
`container 2 not found`, zero `container 8 not found`, in any run.

**The two budget losses are simulator starvation, not a hang — and run 7 proves
it directly.** Run 7's turn-17 stalled mid-typewriter and then RESUMED:

```
15:12:03  TextContainerUpgrade container_id=Some(1) content=Some("Dusknoir restored a little HP using its ")
15:13:59  TextContainerUpgrade container_id=Some(1) content=Some("Dusknoir restored a little HP using its L")
```

One character of typewriter text in 116 seconds of wall clock. The app was
making forward progress the whole time, roughly 1/2500th of normal speed. A
deadlocked bridge does not deliver the next character two minutes later; it
never delivers it. That is D13-B's signature exactly, and D13-B was recorded
against 13-02's code, before any of this plan's changes existed.

Run 2's loss has no lvgl output across its gap, so it gets a structural
argument instead: the turn's last activity was a `rebuildPageContainer` plus
both composite sends — a **fully rendered decision screen** — then silence, with
`updateImageRawData=2` and no partial animation frames. The app was idle
waiting for input, and an idle app cannot deadlock in the send queue.
research-14 died *partway through* a send burst with the screen half-drawn;
this is the opposite shape. `battle / <console clean>` PASSED in run 2, so
there was no exception either.

**Run 6's failure is a real defect, and it is not mine.**
`[unhandledrejection] Not all choices done` comes from the battle simulator
rejecting a choice submitted while a side still owes one — a
ScreenController/SimBattleAdapter turn-sequencing race with no adapter or
container involvement. Logged to `deferred-items.md` as D13-D. It is the first
time this harness has caught it.

Two `--only battle` runs were also attempted, to sample the intermittent more
cheaply. Both failed deterministically at 1297 ms with
`inject_input: no active event container`: the battle scenario assumes the
`boot` scenario ran first and warmed the app up. A harness-invocation problem,
not an app defect; logged as D13-C.

## Environment notes

- The stale Vite dev server (pid 17107, port 5173) and simulator (pid 17148,
  port 9898) left running since 2026-09-18 were stopped — the harness refuses to
  share the ports.
- D13-A's simulator WebKit cache was cleared once before the first run
  (`rm -rf ~/Library/Caches/evenhub-simulator ~/Library/WebKit/evenhub-simulator`).
  It did not recur; no new SDK exports were imported by this plan.
- No orphaned processes left behind.

## For the next phase

- **Phase 14:** the per-turn host-call count is 8-76 now, not 10-21. Do not read
  a 60-call turn as a regression. The stale overlay pixels that
  `showOverlayHud`'s container-2 blank was invented for are a canvas-clearing
  problem, not a container problem — a `textContainerUpgrade` cannot reach them
  after the rebuild has destroyed the container.
- **Phase 15:** `imageDataDimensions` already reads PNG IHDR, so the greyscale
  pipeline is not blocked. It must emit images sized exactly to the container;
  `assertImageUpdate` will refuse anything else rather than let the firmware
  tile it.
- **Phase 19:** `rebuildPageContainer` is still a known-zero in the host-call
  table and needs a success-path log before PERF-02 can be asserted.

## Self-Check: PASSED

All claimed files exist; both commits (`e3c610f`, `144f182`) are in the log;
`assertImageUpdate(` appears once in glassAdapter.ts (the single choke point),
`declaredContainers.` seven times, `research-13` once in assert.ts, and
`grep -c "^import" containerGuards.ts` is still 0.
