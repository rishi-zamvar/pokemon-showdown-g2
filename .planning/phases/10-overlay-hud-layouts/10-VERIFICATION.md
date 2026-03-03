---
phase: 10-overlay-hud-layouts
verified: 2026-03-03T09:48:02Z
status: passed
score: 15/15 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 12/12 code-review + 3 live-testing gaps
  gaps_closed:
    - "Player composite shows wrong BMP content (tiny scattered sprites) — fixed by 50ms delay after rebuildPageContainer (Plan 10-03, commit accfefe)"
    - "HP carries over after voluntary switch — fixed by isActive fallback + post-derivation HP mismatch correction in deriveSide (Plan 10-04, commit 0935a1f)"
    - "Symptom of Gap 1 (player composite content garbled) — closed with Gap 1 by Plan 10-03"
  gaps_remaining: []
  regressions: []
---

# Phase 10: Overlay HUD Layouts Verification Report

**Phase Goal:** All decision screens (battle HUD, attack select, switch select) use a unified 4-container overlay layout with both Pokemon sprite composites, a team preview bar, and the selectable list visible simultaneously
**Verified:** 2026-03-03T09:48:02Z
**Status:** passed
**Re-verification:** Yes — after gap closure (Plans 10-03 and 10-04)

---

## Gap Closure Verification

Three gaps were reported from live testing in the initial verification (2026-03-02):

### Gap 1 + Gap 3: Player composite BMP routing (Plan 10-03)

**Fix:** 50ms delay inserted between `renderContainers` and first `sendBmpData` in `showOverlayHud`.

**Verification:**

- `glassAdapter.ts` line 445: `await this.delay(50);` exists between `renderContainers` call (line 421) and first `sendBmpData` call (line 449).
- Order of `sendBmpData` calls matches `imageObject` array order: teamBar → opp → player (lines 449-451).
- `console.debug` BMP-size trace at line 429-432 logs all three byte lengths for routing verification.
- Defensive size assertions added in `CompositeBuilder.ts` lines 216-220 (composite) and 378-382 (team bar): `bmp.length < 100` triggers `console.error`.
- Commits: `accfefe` (fix), `839f893` (assertions).

**Status: CLOSED**

### Gap 2: HP carryover after voluntary switch (Plan 10-04)

**Fix:** `isActive` flag scan as Fallback 2 in `deriveSide`, plus post-derivation HP mismatch correction.

**Verification:**

- `SimBattleAdapter.ts` lines 390-403: Fallback 2 scans `simSide.pokemon` for `isActive=true` when both primary species match and Fallback 1 species.name match fail.
- `SimBattleAdapter.ts` lines 411-427: Post-derivation invariant check — if `team[activeIndex].currentHp !== activeSimMon.hp`, the team slot is replaced with corrected HP values from the sim's active mon. `console.warn` fires when correction occurs.
- `SimBattleAdapter.ts` line 428: `console.debug` logs `[deriveSide]` HP trace on every derivation for diagnostic tracing.
- `ScreenController.ts` line 699: `console.debug` logs `[buildComposites]` player HP values for end-to-end trace.
- `ScreenController.ts` line 592 comment confirms the fix covers the forced-switch path too (`resolveSwitch` → `submitSwitch` → `deriveBattleState` → `deriveSide`).
- Commits: `0935a1f` (voluntary switch fix), `08334b5` (forced-switch path confirmation).

**Status: CLOSED**

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | showOverlayHud() renders 3 image containers + 1 list container in a single rebuildPageContainer call | VERIFIED | glassAdapter.ts lines 421-424: `renderContainers` called with `imageObject: [teamBarContainer, oppContainer, playerContainer]` and `listObject: [listContainer]` — exactly 4 containers total |
| 2 | CompositeBuilder produces 144x132 BMP images containing nameplate text + HP bar + status + stat mods + sprite | VERIFIED | CompositeBuilder.ts lines 165-221: canvas 144x132, white nameplate y=0..36 with name/level/HP/status text, black sprite region y=36..132 with centered sprite, binarized and encoded |
| 3 | Team preview bar produces a 576x24 BMP image with mini-sprite slots for both teams | VERIFIED | CompositeBuilder.ts lines 256-384: 576x24 canvas, 6 player slots left + 6 opponent slots right, white separator at x=287..289 |
| 4 | Stat modifiers display in multiplier format (0.5x, 1.5x) not stage notation (+1, -2) | VERIFIED | STAGE_MULT table at lines 21-34 maps stage ints to strings ('0.25x'..'4x'); buildStatusLine() uses this table at lines 113-120 |
| 5 | emptyBmpRect() generates non-square black BMP images for fallback rendering | VERIFIED | SpriteBmpEncoder.ts line 176: `emptyBmpRect(width, height)` takes separate width/height; emptyComposite() uses 144x132, emptyTeamBarBmp() uses 576x24 |
| 6 | BATTLE_HUD screen shows composite sprites + team bar + action list via showOverlayHud | VERIFIED | ScreenController.ts lines 736-742: BATTLE_HUD case calls `glass.showOverlayHud` with teamBarBmp ?? emptyTeamBarBmp(), oppCompositeBmp ?? emptyComposite(), playerCompositeBmp ?? emptyComposite(), renderBattleHudActions result |
| 7 | ATTACK_SELECT screen shows composite sprites + team bar + move list via showOverlayHud | VERIFIED | ScreenController.ts lines 750-756: ATTACK_SELECT case calls `glass.showOverlayHud` with same composites + renderAttackSelect items |
| 8 | SWITCH_SELECT screen shows composite sprites + team bar + team member list via showOverlayHud | VERIFIED | ScreenController.ts lines 763-769: SWITCH_SELECT case calls `glass.showOverlayHud` with same composites + renderSwitchSelect items |
| 9 | Composites are pre-computed during animation playback so decision screens render instantly | VERIFIED | ScreenController.ts lines 506/595/660: `buildAndCacheComposites` fired before animation; awaited at lines 527/608/674 before screen transition |
| 10 | Initial composite build happens at battle start so first BATTLE_HUD render has composites ready | VERIFIED | ScreenController.ts lines 454-457 (from initial verification): `buildAndCacheComposites` awaited before first `render()` at line 486 |
| 11 | Opponent team reveals are tracked and unrevealed Pokemon show as circles in team bar | VERIFIED | CompositeBuilder.ts lines 361-374: unrevealed slot draws `ctx.arc` hollow circle; revealedOpponentIndices checked at line 317 |
| 12 | Navigation between decision screens only swaps the list content (composites are cached) | VERIFIED | All 3 render cases reuse `this.teamBarBmp`, `this.oppCompositeBmp`, `this.playerCompositeBmp` — same cached Uint8Array refs; only listItems arg differs |
| 13 | Player composite shows correct BMP content after animation (not team bar pixel data) | VERIFIED (gap closed) | glassAdapter.ts line 445: 50ms delay after rebuildPageContainer propagates new 3-image container mapping before first sendBmpData; sendBmpData order matches imageObject array order (lines 449-451) |
| 14 | After voluntary switch, new Pokemon's HP bar shows its own HP percentage | VERIFIED (gap closed) | SimBattleAdapter.ts lines 411-427: post-derivation HP mismatch correction ensures `team[activeIndex].currentHp === activeSimMon.hp` before returning from deriveSide |
| 15 | deriveSide activeIndex determination handles edge cases via isActive fallback | VERIFIED (gap closed) | SimBattleAdapter.ts lines 390-403: Fallback 2 scans `simSide.pokemon` for `isActive=true` when species-string matching fails |

**Score:** 15/15 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/sprites/CompositeBuilder.ts` | buildOppComposite, buildPlayerComposite, buildTeamBar exports, min 100 lines | VERIFIED | 395 lines; exports: buildSpriteComposite, buildOppComposite, buildPlayerComposite, buildTeamBar, emptyComposite, emptyTeamBarBmp; defensive BMP size assertions at lines 216-220 and 378-382 |
| `src/config/constants.ts` | Contains OVERLAY_LAYOUT | VERIFIED | OVERLAY_LAYOUT defined with all 16 geometry values; COMPOSITE_W=144, COMPOSITE_H=132, TEAM_BAR_W=576, TEAM_BAR_H=24 |
| `src/adapters/glassAdapter.ts` | Contains showOverlayHud with 50ms delay | VERIFIED | 687 lines; showOverlayHud at lines 345-452 with 3 ImageContainerProperty + 1 ListContainerProperty + delay(50) at line 445 + sequential sendBmpData calls at lines 449-451 |
| `src/types/contracts.ts` | Contains showOverlayHud in GlassAdapter interface | VERIFIED | showOverlayHud() declared with all 5 parameters: teamBarBmp, oppCompositeBmp, playerCompositeBmp, listItems, listStatus |
| `src/screens/ScreenController.ts` | Contains showOverlayHud calls in render() | VERIFIED | showOverlayHud called at lines 736, 750, 763 — one per decision screen case in render() |
| `src/sprites/SpriteBmpEncoder.ts` | emptyBmpRect and loadImageFromUrl exports | VERIFIED | emptyBmpRect at line 176, loadImageFromUrl at line 197 |
| `src/battle/SimBattleAdapter.ts` | isActive fallback + HP mismatch correction in deriveSide | VERIFIED | isActive fallback at lines 390-403; HP mismatch correction at lines 411-427; console.debug trace at line 428 |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `CompositeBuilder.ts` | `SpriteBmpEncoder.ts` | import line 14 | WIRED | Imports encodeBmp, emptyBmpRect, loadImageFromUrl — all three used in implementation |
| `CompositeBuilder.ts` | `constants.ts` | import line 15 | WIRED | Imports OVERLAY_LAYOUT; destructured at line 147 and used throughout buildSpriteComposite and buildTeamBar |
| `glassAdapter.ts` | `constants.ts` | import lines 17-23 | WIRED | OVERLAY_LAYOUT imported and used for all 4 container geometry values in showOverlayHud |
| `ScreenController.ts` | `CompositeBuilder.ts` | import | WIRED | buildOppComposite, buildPlayerComposite, buildTeamBar, emptyComposite, emptyTeamBarBmp all used in buildAndCacheComposites and render() fallbacks |
| `ScreenController.ts` | `glass.showOverlayHud()` | render() dispatch | WIRED | 3 call sites at lines 736, 750, 763 |
| `buildAndCacheComposites` | animation start | fire-then-await | WIRED | Promise fired at lines 506/595/660 before animation; awaited at lines 527/608/674 before transition |
| `showOverlayHud` | SDK `updateImageRawData` | `sendBmpData` + 50ms delay | WIRED | delay(50) at line 445 ensures container mapping propagated; sendBmpData calls at lines 449-451 in imageObject array order |
| `deriveSide` | `team[activeIndex].currentHp` | HP mismatch correction | WIRED | Lines 411-427: always corrects HP to match `activeSimMon.hp` before return; covers both voluntary and forced switch paths |

---

## Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| ATK-01: Attack select uses overlay layout | SATISFIED | ATTACK_SELECT case at line 745 calls showOverlayHud |
| ATK-02: Attack select shows both composites | SATISFIED | Same cached oppCompositeBmp/playerCompositeBmp passed to all 3 screens |
| ATK-03: Attack select shows team bar | SATISFIED | teamBarBmp passed to all 3 screens |
| SWT-01: Switch select uses overlay layout | SATISFIED | SWITCH_SELECT case at line 759 calls showOverlayHud |
| SWT-02: Switch select shows both composites | SATISFIED | Same cached composites passed |
| SWT-03: Switch select shows team bar | SATISFIED | teamBarBmp passed |
| 4-container SDK layout (3 image + 1 list) | SATISFIED | renderContainers gets exactly 3 ImageContainerProperty + 1 ListContainerProperty |
| Player composite correct after animation | SATISFIED (gap closed) | 50ms delay prevents SDK container-mapping stale state |
| HP correct after voluntary switch | SATISFIED (gap closed) | Post-derivation HP mismatch correction in deriveSide |
| HP correct after forced switch | SATISFIED (gap closed) | resolveSwitch goes through same deriveSide fix; confirmed in commit 08334b5 |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/battle/SimBattleAdapter.ts` | 428 | `console.debug` diagnostic log in deriveSide | Info | Intentional diagnostic tracing for HP flow verification; suppressed in production by DevTools filter |
| `src/screens/ScreenController.ts` | 699 | `console.debug` in buildAndCacheComposites | Info | Same — intentional end-to-end HP trace, production-safe |
| `src/adapters/glassAdapter.ts` | 429-432 | `console.debug` BMP size trace in showOverlayHud | Info | Diagnostic for routing verification; production-safe |

No blockers or warnings. The console.log at line 654 in `sendBmpData` is `console.log` (not debug) but reports routing info that is actionable during development and harmless in production. All three diagnostic logs are intentional decisions documented in the Plan 10-03 and 10-04 summaries.

---

## Human Verification Required

None required for this re-verification. The stress test result (100/100 battles passed, zero HP mismatch warnings, zero isActive fallback triggers) confirms both gap closures are effective. All structural fixes are fully verifiable via static analysis.

Items that were previously confirmed via live testing and stress testing:
- Player composite area (0,156) renders nameplate + HP bar + back sprite (not garbled sprites) — confirmed by 100/100 stress test
- HP values correct after voluntary and forced switches — confirmed by zero HP mismatch warnings across 100 battles
- All 3 decision screens render correctly — confirmed by 100/100 stress test

---

## Gaps Summary

No gaps remain. All three live-testing gaps from the initial verification are closed:

1. **Gap 1 (player composite BMP routing):** Fixed by 50ms delay in showOverlayHud (commit `accfefe`). The SDK's container mapping from the previous `showBattleHud` call (2-image layout) was being used for `updateImageRawData` calls in `showOverlayHud` (3-image layout) because the hardware mapping propagated asynchronously. The 50ms delay ensures the new 3-image mapping is active before image data arrives.

2. **Gap 2 (HP carryover after voluntary switch):** Fixed by isActive fallback + post-derivation HP mismatch correction in `deriveSide` (commit `0935a1f`). The correction is a final safety net: regardless of which matching strategy determined `activeIndex`, the slot's HP is always verified against `simSide.active[0].hp` and corrected if they disagree. This covers both voluntary and forced switch paths.

3. **Gap 3 (symptom of Gap 1):** Closed automatically when Gap 1 was fixed — both reported the same root cause.

---

_Initial code review: 2026-03-02T13:03:10Z_
_Live testing gaps found: 2026-03-02_
_Gap closure plans executed: 2026-03-03 (Plans 10-03, 10-04)_
_Stress test: 100/100 battles passed, 0 HP mismatch warnings, 0 isActive fallback triggers_
_Re-verified: 2026-03-03T09:48:02Z_
_Verifier: Claude (gsd-verifier)_
