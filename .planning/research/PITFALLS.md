# Domain Pitfalls

**Domain:** Pokemon battle simulator UI enhancement for G2 smart glasses
**Researched:** 2026-03-01
**Milestone:** v1.1 UI Enhancement & Polish
**Confidence:** HIGH — pitfalls derived from direct codebase inspection, verified against Nick Ustinov's G2 notes, SDK source, and existing working system behavior

---

## How This File Is Organized

Pitfalls are grouped by the specific feature being added in v1.1:

1. Consolidating ACTION_MENU onto BATTLE_HUD
2. Preserving HUD visibility during ATTACK_SELECT and SWITCH_SELECT
3. Stats screen (abilities, modifiers, opponent speed range)
4. Speed controls (animation + text streaming)
5. Removing back buttons (double-tap only navigation)
6. Integration pitfalls (surgery on a working system)

Each pitfall maps to the phase where it is most likely to surface.

---

## Critical Pitfalls

Mistakes that cause rewrites or break battles entirely.

---

### Pitfall C1: HUD Context Lost When Adding Moves/Switch to Same Screen

**What goes wrong:**
The v1.1 goal is to show Attack/Switch/Tera as a list ON the battle screen while simultaneously showing sprites and HP bars. The current architecture separates these because the SDK supports max 4 containers per page and the battle HUD already uses all 4: oppSprite, playerSprite, oppInfo, playerInfo.

If you try to add a list container to the battle HUD screen you immediately exceed the 4-container limit. The SDK silently discards extra containers — `rebuildPageContainer` returns `false` but no error is thrown and no crash occurs. The display simply does not show the list.

**Why it happens:**
Developers count containers in their head ("I just add a list") without checking the actual container allocation in `glassAdapter.ts`. The current `showBattleHud()` creates: 1 text container (combined oppText + playerText), 1 status container, 1 oppSprite image container, 1 playerSprite image container = 4 containers exactly.

**Consequences:**
- The "consolidated" battle menu never appears on glasses
- The action list renders correctly in browser but silently fails on device
- No error — debugging this wastes hours

**Prevention:**
Before designing the merged screen, map out the exact container slots available. The SDK limit is 4 containers per `rebuildPageContainer` call. To fit sprites + HP + action list, one of these approaches is required:

Option A — Merge oppText and playerText into one text block alongside the list (use the left portion of the display for combined text, right portion for sprites, bottom list):
```
Container 1: text (names + HP bars, left side)
Container 2: image (oppSprite, right top)
Container 3: image (playerSprite, right bottom)
Container 4: list (Attack / Switch / Tera / Stats)
```
This eliminates the status bar container to make room for the list.

Option B — Use a text container with embedded action items (fake-list using newlines), and read taps from the `listIndex` or use `textEvent`. This loses swipe-scroll highlighting but stays within limits.

Option C — Keep the two-step navigation (tap HUD → action menu) but redesign the action menu to show HUD data inline in the status bar. This preserves the 4-container architecture and is the lowest-risk approach.

**Warning signs:**
- List items appear in browser companion but not on glasses
- `rebuildPageContainer` logs show `false` return on device
- Sprites disappear when action list appears (list displaced sprite containers)

**Phase to address:** First phase of v1.1 (consolidated battle menu)

---

### Pitfall C2: List Selection Indices Break When Screen Structure Changes

**What goes wrong:**
The current `handleActionMenu()` maps tap indices to actions: `idx=0` → Back, `idx=1` → Attack, `idx=2` → Switch, `idx=3` → Terastallize.

When the consolidated HUD merges the action menu into the battle screen, these indices must be recalculated. If you copy the action handler logic without updating the index map, adding "Stats" as a new option at index 1 shifts all others. Attack becomes idx 2, Switch becomes idx 3, Tera becomes idx 4. The existing `handleActionMenu()` code processes `idx=2` as Switch — now that index is actually Attack. Wrong action fires for every tap.

**Why it happens:**
Index maps are implicit (not defined in a typed structure). Developers update the renderer's item list but forget to update the corresponding `switch(idx)` block. The renderer and handler are two separate files with no enforced contract between them.

**Consequences:**
- Tapping "Attack" switches the Pokemon instead
- Tapping "Switch" tries to use Terastallize
- Silent wrong behavior — no crash, no error, just wrong actions

**Prevention:**
Define the menu items as a typed enum or named constant object, not a positional array:
```typescript
const CONSOLIDATED_ACTIONS = ['Attack', 'Switch', 'Terastallize', 'Stats'] as const;
type ConsolidatedAction = typeof CONSOLIDATED_ACTIONS[number];

// In renderer — derive items from the same constant
const items = Array.from(CONSOLIDATED_ACTIONS);

// In handler — derive index from the same constant
const action = CONSOLIDATED_ACTIONS[idx] as ConsolidatedAction;
switch (action) {
  case 'Attack': ...
  case 'Switch': ...
}
```
This makes renderer and handler derived from the same source. Reordering the list is a single change.

**Warning signs:**
- Wrong screen appears after tapping an action
- Occasional "correct" behavior only when testing specific tap sequences that happen to work by chance
- Tests pass in browser where you tap deliberately, fail on glasses where swipe positioning differs

**Phase to address:** Consolidated battle menu phase. Write the enum before writing any renderer or handler code.

---

### Pitfall C3: rebuildPageContainer Loses Scroll Position on Every Update

**What goes wrong:**
When the consolidated HUD shows both HP info and the action list simultaneously, any state update (HP changes, animation frame) triggers `rebuildPageContainer`. Every rebuild resets the list cursor to item 0. If the player is hovering over "Switch" (idx 2) and a turn animation fires in the background, the next tap selects "Attack" (idx 0) instead.

The existing architecture avoids this because list screens (ACTION_MENU, ATTACK_SELECT) are never updated while visible — animations only run on BATTLE_HUD which has no list. But a merged screen that has both a list AND gets animation updates would hit this constantly.

**Why it happens:**
`rebuildPageContainer` is the only way to change a list container's items. There is no `listContainerUpgrade` equivalent (unlike `textContainerUpgrade`). So any change to visible information on a screen containing a list requires a full rebuild and position reset.

**Consequences:**
- Player's cursor jumps to top during or after animations
- Player taps immediately after watching animation, selects wrong item
- Effectively prevents animation playback on any screen containing a list

**Prevention:**
Do not animate screens that contain list containers. This is a hard architectural rule. Choose one of:

1. Keep the animation on BATTLE_HUD (text-only), then transition to the action list AFTER animation completes. This is the current v0.1 pattern and it works.

2. For the "merged HUD" goal, accept that no HP-drain animation runs on the merged screen — animation plays on a dedicated ANIMATING state that uses text-only display, then snaps back to the consolidated HUD.

3. Use in-place text updates (`textContainerUpgrade`) for live animation while the action list is visible — but this only updates text containers, not list containers. The list stays frozen while HP drains in the text area.

**Warning signs:**
- Cursor resets to top during battle animations
- Player reports "I selected Switch but the game attacked"
- Animation-then-list pattern feels unreliable

**Phase to address:** Consolidated battle menu phase. Decide the animation strategy BEFORE writing any merged screen code.

---

### Pitfall C4: Stats Screen Exceeds Character Budget with Stat Modifiers + Abilities + Speed Range

**What goes wrong:**
The stats screen needs to show: ability name, current stat stage modifiers (+1 Atk, -1 Def, etc.), volatile conditions, opponent's speed range, and possible opponent abilities. That is approximately:

```
Ability: Intimidate                  25 chars
Status: Burn                         12 chars
Atk: +1  Def: 0  SpA: -1  SpD: 0    33 chars
Speed: 95  Opp speed: 76-152         30 chars
Opp ability: Blaze/Solar Power       32 chars
```

Total: ~132 chars for a compact layout. With proper labels and newlines: ~200 chars. That is within the 900-char safe budget for one Pokemon. But if the stats screen shows both Pokemon's data, or includes volatile details, or uses verbose labels, it grows to 400-600 chars before any safety margin.

The real danger is the opponent's possible abilities. The opponent might have 2-3 possible abilities from its pokedex entry (e.g., Charizard: Blaze / Solar Power). Listing them properly: "Opp abilities: Blaze, Solar Power" = 35 chars. For a Pokemon with 3 abilities, longer names can reach 70 chars for that line alone.

**Why it happens:**
Stats screen is built in isolation and looks fine in browser at any length. Character budget is only verified on device. The budget violation happens silently (content truncates, no error).

**Prevention:**
Define strict labels and max-length rules for the stats screen before writing any code:
```typescript
const STATS_SCREEN_BUDGET = 700; // leave 200-char safety margin

// Enforce abbreviations:
// "Atk+1 Def0 SpA-1 SpD0 Spe0" instead of full labels — saves 20+ chars
// "Opp spd: 76-152" instead of "Opponent speed range: 76-152"
// "Ability: Blaze/SolarPwr" (truncate to 12 chars each) if needed
```

Write a unit test for `renderStatsScreen()` that asserts `output.length < STATS_SCREEN_BUDGET` for a Pokemon with a 3-ability entry, +6/-6 stat stages, 3 volatile conditions, and a 200-speed opponent.

**Warning signs:**
- Stats screen looks complete in browser but cuts off midway on glasses
- "Opp abilities:" line missing from device view
- Stat modifiers show but speed range is cut off

**Phase to address:** Stats screen phase. Budget test before first device test.

---

## Moderate Pitfalls

Mistakes that cause user confusion or require rework but don't break battles.

---

### Pitfall M1: Double-Tap as "Back" Is Ambiguous — Fires on Accidental Second Tap

**What goes wrong:**
The v1.1 goal is to remove all `< Back` items from lists and use double-tap only for navigation. The existing SDK maps `DOUBLE_CLICK_EVENT` to a TAP gesture in `glassAdapter.ts`. If double-tap is the only way back, any accidental double-tap while trying to scroll or select an item exits the current screen unexpectedly.

The current gesture handler in `mapEventToGesture()` treats `DOUBLE_CLICK_EVENT` identically to `CLICK_EVENT` — both map to `{ kind: "TAP" }`. To implement "double-tap = back," the controller must distinguish single from double tap, which requires timing logic: fire single-tap only if a second tap doesn't arrive within ~300ms.

**Why it happens:**
The existing code doesn't need to distinguish single vs double tap because `< Back` is a list item. Removing `< Back` from lists and relying on double-tap means the gesture layer needs a new state machine: pending → confirm vs cancel.

**Consequences:**
- Players accidentally exit ATTACK_SELECT while scrolling moves quickly
- No visible affordance that double-tap exits (new players confused)
- Distinguishing single vs double adds 300ms latency to ALL single taps if implemented naively

**Prevention:**
If you remove `< Back` from list items, implement double-tap detection with a short window (250-300ms) and visual feedback. Do not just relabel DOUBLE_CLICK_EVENT as "back" — it will conflict with single-tap handlers and the 300ms cooldown will make the entire UI feel slow.

Alternatively, consider a hybrid: remove `< Back` only from top-level navigation (BATTLE_HUD → MAIN_MENU) where accidental back is low-risk, but keep `< Back` in sub-screens (ATTACK_SELECT, SWITCH_SELECT) where wrong navigation during battle has consequences.

**Warning signs:**
- Players report "I accidentally went back to main menu"
- All taps feel slow if 300ms double-tap window is added to every gesture
- Single-tap to select + double-tap to back causes occasional "phantom back" when a move is selected and a second tap arrives within the window

**Phase to address:** Navigation redesign phase. Decide: full double-tap, hybrid, or keep `< Back` before writing a single line of navigation code.

---

### Pitfall M2: Speed Controls Are a Global Singleton — Animation Engine Uses Hardcoded Constants

**What goes wrong:**
Animation timing is currently hardcoded in `src/config/constants.ts` under the `ANIM` object: `CHAR_DELAY_MS: 45`, `ENTRY_PAUSE_MS: 500`, `FLASH_FRAME_MS: 75`, etc. These constants are imported directly by `AnimationEngine.ts`.

Speed controls require that these values change at runtime based on user selection. If you just update the constants file, nothing changes at runtime (TypeScript constants are compiled to literal values). If you add a `speedMultiplier` variable and multiply every delay by it inside `AnimationEngine.ts`, you must ensure that every `delay()` call reads the multiplier at the moment of execution, not at construction time.

The current `AnimationEngine` class is instantiated once in `ScreenController` (line: `private readonly animationEngine = new AnimationEngine()`). If the speed multiplier is passed as a constructor argument, changing speed mid-battle requires re-instantiation and loss of in-flight animation state.

**Why it happens:**
Speed controls appear simple — "just multiply delays." But the implementation must handle: (a) reading speed at each delay call not at animation start, (b) applying to all 7+ delay sites in `AnimationEngine.ts` consistently, (c) persisting the setting across battles, (d) showing the current speed on the menu screen.

**Consequences:**
- Speed setting appears in menu but has no effect on animations (common mistake: constant was captured at build time)
- Speed only affects text streaming but not HP drain, or vice versa (partial implementation)
- Changing speed mid-animation causes abrupt frame-rate changes

**Prevention:**
Implement speed as a module-level or service-level singleton getter, not a passed parameter:
```typescript
// speedSettings.ts
export type SpeedSetting = 'slow' | 'normal' | 'fast';
let _speed: SpeedSetting = 'normal';

export function setSpeed(s: SpeedSetting): void { _speed = s; }
export function getSpeed(): SpeedSetting { return _speed; }

export function getCharDelay(): number {
  const base = ANIM.CHAR_DELAY_MS;
  return _speed === 'fast' ? Math.floor(base / 3) : _speed === 'slow' ? base * 2 : base;
}
```

Then replace all `ANIM.CHAR_DELAY_MS` direct usages in `AnimationEngine.ts` with `getCharDelay()` etc. This way the speed is read at execution time, not compilation time, and changing it in the menu takes effect immediately on the next animation frame.

**Warning signs:**
- Speed menu shows "Fast" selected but animations run at the same speed as before
- Changing speed works on first battle but reverts on subsequent battles (if speed is stored in component state instead of singleton)
- HP drain is affected by speed but typewriter text is not, or vice versa

**Phase to address:** Speed controls phase. Write `speedSettings.ts` as a dedicated module before touching `AnimationEngine.ts`.

---

### Pitfall M3: Tera Without Confirmation Screen Breaks the "Tera Is Irreversible" Signal

**What goes wrong:**
Currently TERA_CONFIRM shows the Tera type and requires "Confirm" tap before executing. The v1.1 goal is to remove this confirmation screen and show only a notifier (brief message) before the Tera executes immediately.

The problem: Terastallization is irreversible for the entire battle. The confirmation screen is not just a UX formality — it is the only moment the player verifies they selected Tera and not Attack or Switch accidentally. Without confirmation, an accidental tap on "Terastallize" in the consolidated menu fires Tera immediately, wasting the one-time mechanic permanently.

This is especially risky on the G2 because list items can have their cursor index off by one due to scroll position — if the player's cursor was on "Terastallize" without knowing it and they tap, Tera is consumed.

**Why it happens:**
Developers conflate "simpler = fewer screens" with "simpler = better." Removing confirmation screens is correct for low-cost, reversible actions (back navigation, move selection). It is wrong for irreversible one-time-per-battle actions.

**Consequences:**
- Player uses Tera accidentally in an unimportant battle turn
- No way to undo — the mechanic is permanently spent
- Player frustration at what feels like a bug, not a feature

**Prevention:**
If the goal is to remove a dedicated TERA_CONFIRM screen, replace it with a notifier pattern: briefly show "Tera: Fire ready! Tap a move" before going to ATTACK_SELECT with an indicator active. This preserves the "you're about to do something irreversible" signal without a full confirmation screen.

Do not eliminate the two-step tera selection entirely — the two steps (select tera, then select move) serve as natural confirmation by requiring deliberate sequential input.

**Warning signs:**
- Playtesting reports "I accidentally Terastallized on Turn 1 with a bad type"
- Tera described as "too easy to do accidentally" in feedback
- Player skill felt diminished by unintended Tera usage

**Phase to address:** Consolidated battle menu phase. Mark Tera as "notifier, not single-tap" explicitly in the screen design.

---

### Pitfall M4: showBattleHud Sends Two Sequential BMP Writes — Each Triggers a rebuildPageContainer First

**What goes wrong:**
The current `showBattleHud()` flow:
1. Call `rebuildPageContainer` with text + image container definitions
2. Send oppSprite BMP via `updateImageRawData`
3. Send playerSprite BMP via `updateImageRawData`

Each call to `showBattleHud()` sends 3 sequential async SDK calls. In v1.1, the battle screen will be updated more frequently (animation text in box + HP bars during action selection). If `showBattleHud` is called with every animation frame, the device receives 3 calls per frame instead of 1.

At `CHAR_DELAY_MS: 45ms` (typewriter speed), that is 22 calls/second × 3 SDK calls = 66 SDK calls/second during a busy animation. The G2 bridge communicates over Bluetooth, and there is no documented call-rate limit but community reports indicate that firing >20 SDK calls/second causes queue buildup that manifests as visible animation lag 2-3 seconds after it starts.

**Why it happens:**
The original code accepted 3 calls per update because animations on BATTLE_HUD used `textContainerUpgrade` (1 call), not the full `showBattleHud`. The 3-call path is only used on full redraws. If the merged screen makes `showBattleHud` the update method for animations, each animation frame becomes 3 calls.

**Consequences:**
- Animation starts smoothly, then develops increasing lag 2-3 seconds in
- On fast speed setting, lag is immediately obvious
- Switching back to main menu after a laggy battle may leave queued SDK calls that affect the next screen's render

**Prevention:**
Do not call `showBattleHud` for animation frame updates. Instead:
- Animation frames should use `textContainerUpgrade` for text changes (1 call, no rebuild)
- Sprite updates during animation should use `updateImage` directly (1 call)
- Only call `showBattleHud` (full rebuild) on screen transitions, not per-frame

This is already how the v0.1 `AnimationEngine` works (it calls `glass.updateText()` and `glass.updateImage()` separately). Preserve this separation in v1.1 even if the screen layout changes.

**Warning signs:**
- Animation feels smooth in first 1-2 seconds, then gets progressively choppier
- Fast speed setting makes lag worse, not better (paradox: more calls/sec → more queue buildup)
- Console logs show BMP send calls interleaved with text update calls during animation

**Phase to address:** Any phase that changes animation rendering. Enforce in code review: `showBattleHud()` must not be called inside any animation loop.

---

### Pitfall M5: Stats Screen Needs @pkmn/sim Battle Data That Is Not in BattleState

**What goes wrong:**
The stats screen goal includes: "stat modifiers, opponent speed range, possible abilities." These require data that is not currently stored in the `BattleState` type:

- **Stat modifiers** (+1 Atk, -2 Def): Stored internally by `@pkmn/sim` in `battle.sides[n].active[0].boosts` but not exposed in the current `ActivePokemon` type in `battleState.ts`. The `SimBattleAdapter` parses log entries to build `BattleState` but does not extract boost data.

- **Opponent speed range**: Requires knowing the opponent's base speed stat and current boost stage. Base speed is in `@pkmn/dex` (already loaded in DataLoader), but the opponent's boost stage is not tracked in `ActivePokemon`.

- **Possible abilities**: The opponent's actual ability is hidden (random battle). The displayed "possible abilities" are the 2-3 abilities listed in the pokedex entry for that species. These come from `DataLoader.getPokemon(slug).abilities` which already exists but the stats screen renderer needs to call it.

**Why it happens:**
The stats screen is planned at the feature level ("show abilities and modifiers") without mapping each data point back to where it lives in the current architecture. Some data requires parser changes to `SimBattleAdapter`, some requires type changes to `BattleState`, and some is already available via `DataLoader`.

**Consequences:**
- Stats screen renders but shows "Atk: 0" for all modifiers (zero-initialized because boost data was never extracted from sim)
- Speed range shows only base speed, not accounting for current boosts
- Abilities field is populated but shows wrong species abilities because slug normalization fails for forme variants

**Prevention:**
Before writing `renderStatsScreen()`, map every data point to its source:

| Data Field | Where It Lives | Work Needed |
|------------|----------------|-------------|
| Ability name | `ActivePokemon.ability` (not in current type) | Add to BattleState type + SimBattleAdapter parser |
| Stat boosts | `@pkmn/sim battle.sides[n].active[0].boosts` | Add boosts field to ActivePokemon, extract in SimBattleAdapter |
| Base speed | `DataLoader.getPokemon(slug).baseStats.spe` | Already available |
| Boosted speed | base + boost stage formula | Needs boost data from above |
| Opp speed range | Requires knowing possible EV/IV range in randbats | Use @pkmn/randbats range data or assume 0-252 EVs at level 100 |
| Possible opp abilities | `DataLoader.getPokemon(slug).abilities` | Already available — just needs slug normalization |
| Volatiles | `ActivePokemon.volatiles` | Already in type |
| Status | `ActivePokemon.status` | Already in type |

Do this mapping before writing any renderer code. Data fields that require `SimBattleAdapter` changes must be addressed in an earlier plan than the renderer.

**Warning signs:**
- Stats screen renders but all modifier values are 0
- Ability shows "undefined" or a wrong Pokemon's ability name
- Speed range shows a nonsensical number (did not apply boost multiplier)

**Phase to address:** Stats screen phase — begin with a data-availability audit, then add fields to `BattleState`, then write the renderer.

---

## Minor Pitfalls

Mistakes that cause visual glitches or minor annoyance but are easy to fix.

---

### Pitfall N1: Animation Text Box Overlaps Sprite Content Area

**What goes wrong:**
The v1.1 goal includes showing animation text "in a box" during battle resolution. The current `AnimationEngine` writes text to the full-height text container, which overlaps the region where sprites are displayed (both occupy the same `GLASS_LAYOUT` area at `x:8, y:4, width:560, height:248`).

In v0.1 this is acceptable because text and sprites are different container types and the SDK renders them in independent display layers. However, if the "animation text box" is intended to be visually distinct (bordered, positioned below the sprites), a new text container positioned in the lower half of the display must be created during battle HUD setup. This requires one of the 4 container slots — which means either oppSprite or playerSprite must be sacrificed, or the text box must be simulated using newlines in the existing text container.

**Why it happens:**
"Text in a box" sounds like a CSS/styling feature. On G2, boxes are only achievable via container borders (`borderWidth`, `borderColor` on TextContainerProperty) or by careful content positioning. There is no free-floating overlay.

**Prevention:**
Clarify what "in a box" means for this display before building:
- Bordered text container (uses a container slot, reduces sprites to 1)
- Text with a visible separator line drawn using block characters (`═══ BATTLE ═══`) — uses zero extra containers
- Status bar repurposed as the "battle text" line (always visible, no extra container)

Recommend: separator line approach costs nothing and works within the existing 4-container limit.

**Warning signs:**
- "Battle text box" feature requires adding a 5th container — SDK silently ignores it
- Battle text and HP text appear merged without visual separation

**Phase to address:** Animation polish phase. Decide the "box" implementation before any visual redesign work.

---

### Pitfall N2: Speed Setting Persists to Battery-Draining "Slow" After Device Sleep

**What goes wrong:**
If speed settings are stored in memory (module singleton), they reset to "normal" whenever the WebView is killed or the Even app goes to background. If stored in `localStorage`, they persist across sessions. "Slow" mode at `CHAR_DELAY_MS * 2` means the typewriter delay is 90ms/char and `ENTRY_PAUSE_MS` is 1 second — adding up to 3-4 seconds of delays per turn event. A full 10-turn battle in slow mode adds ~30-40 seconds of animation time and keeps the WebView, CPU, and Bluetooth radio active proportionally longer.

**Prevention:**
Default to "normal" speed on every app launch regardless of stored setting. Allow the user to change speed per-session. Do not persist "slow" to localStorage — or if you do, reset to "normal" on next launch with a note in the menu showing the previous session's setting.

**Warning signs:**
- Battery drains unusually fast in playtest sessions
- Users complain battle "feels broken" after switching from slow to normal (they forgot they set slow)

**Phase to address:** Speed controls phase. Define the persistence strategy explicitly before implementation.

---

### Pitfall N3: `< Back` Removal Breaks the Forced-Switch Screen (Which Must Not Allow Back)

**What goes wrong:**
Currently `handleSwitchSelect()` checks `this.forcedSwitch` before allowing the `< Back` item to work:
```typescript
if (idx === 0) {
  if (this.forcedSwitch) return; // Can't go back during forced switch
  ...
}
```

If `< Back` is removed from all screens, the forced switch screen loses its "can't escape" behavior but a double-tap would fire the "back" gesture. On a forced switch screen, double-tap must be blocked (the player MUST choose a Pokemon). If double-tap is wired to "go back," a player in a forced switch situation could double-tap their way back to the battle HUD where their fainted Pokemon is still active — causing the battle to reach an invalid state.

**Prevention:**
When implementing double-tap as back navigation, maintain a `backAllowed` flag per screen state. Forced-switch, end screen (before choosing "new battle" or "main menu"), and "animating" states must all block double-tap-back explicitly:
```typescript
private isBackAllowed(): boolean {
  if (this.forcedSwitch) return false;
  if (this.state.screen === 'ANIMATING') return false;
  if (this.state.screen === 'END_SCREEN') return false;
  return true;
}
```

**Warning signs:**
- During forced switch, double-tap returns to battle HUD showing a fainted Pokemon
- Battle freezes because the sim expects a switch choice but the ScreenController is back on BATTLE_HUD
- `@pkmn/sim` throws an error about an illegal action on the next turn

**Phase to address:** Navigation redesign phase. Define `backAllowed` logic before removing any `< Back` items from list screens.

---

## Integration Pitfalls

Risks specific to modifying a working system.

---

### Pitfall I1: ScreenController Is a 870-Line God Object — Adding Features Compounds Its Complexity

**What goes wrong:**
`ScreenController.ts` currently handles: gesture routing, battle state management, animation orchestration, sprite loading, phone companion rendering, and error display. It is 870 lines. The v1.1 changes require adding: consolidated menu handling, stats screen state, speed controls, and revised navigation logic.

Each added feature increases the state combinations that `ScreenController` must handle. The current screen state enum already has 9 values. Adding `STATS_SCREEN` makes 10. Every new screen state multiplies the number of gesture + screen + battle-phase combinations that must be tested. A bug in one feature can manifest as a symptom in a completely unrelated screen transition because everything shares the same `this.state` object.

**Prevention:**
Before adding new screens in v1.1, extract PhoneCompanionRenderer into its own class (it already has a clear boundary — it only reads `this.state.battleState`). This alone reduces `ScreenController` by ~100 lines and makes the companion logic testable in isolation.

For new screens (STATS_SCREEN, SPEED_MENU), follow the existing renderer pattern exactly: create `statsScreenRenderer.ts` and `speedMenuRenderer.ts` before touching `ScreenController`. The controller should add only: one case in the screen type union, one case in `render()`, and one handler method. All logic stays in the renderer.

**Warning signs:**
- A PR that touches `ScreenController.ts` changes more than 80 lines
- Stats screen handler code is inside `ScreenController` rather than in a dedicated renderer file
- A speed-settings change causes a navigation bug on a completely unrelated screen

**Phase to address:** All v1.1 phases. Apply the renderer-first discipline from the start of v1.1, not after the fact.

---

### Pitfall I2: Removing a Screen That Existing State Machine Transitions Point To

**What goes wrong:**
The v1.1 plan removes `TERA_CONFIRM` as a separate screen (Tera without confirmation). The current state machine has:
- `ACTION_MENU` → tap Terastallize → `TERA_CONFIRM`
- `TERA_CONFIRM` → confirm → `ATTACK_SELECT`
- `TERA_CONFIRM` → back → `ACTION_MENU`

Removing `TERA_CONFIRM` from the union type causes TypeScript to flag it as an error everywhere it appears — which is the correct behavior. However, developers often take a shortcut: comment out the screen type instead of removing it. This leaves dead state transitions that can still be reached if a gesture arrives in an unexpected order.

Also: `teraQueued` boolean flag exists specifically for the TERA_CONFIRM → ATTACK_SELECT flow. If TERA_CONFIRM is removed, `teraQueued` must be set at the point where Tera is selected in the consolidated menu, and the path through ATTACK_SELECT that reads `teraQueued` must be verified to still fire correctly.

**Prevention:**
When removing a screen:
1. Delete the `ScreenState` union member — TypeScript will find all usages
2. Fix all TypeScript errors exhaustively before running anything
3. Verify `teraQueued` is still set at the right point (consolidated menu tap handler)
4. Test the tera → attack path specifically: select tera, select a move, verify `TERA_ATTACK` action fires

Do not comment out the screen type to suppress TypeScript errors. TypeScript's exhaustive checking is the only automated guard against dead branches in a switch statement.

**Warning signs:**
- TypeScript reports "Property 'TERA_CONFIRM' does not exist on type ScreenState" — good, handle it
- `teraQueued` is still set but Tera never executes (path broken silently)
- Tapping Terastallize in the consolidated menu takes the player to a screen they can't get out of

**Phase to address:** Screen consolidation phase. Use TypeScript's type checking as your regression test harness.

---

### Pitfall I3: Adding Features in Parallel Branches Causes Double-Tap Meaning to Conflict

**What goes wrong:**
If "remove back buttons" and "stats screen" are developed in separate branches and merged, the double-tap handler may be defined twice. One branch wires double-tap to "back navigation." The other branch may wire double-tap to "close stats screen and return." When merged, the event handler fires both, causes a race condition, and the screen transitions twice in one gesture.

In the current `GlassAdapterImpl`, `DOUBLE_CLICK_EVENT` maps to a TAP event with `listIndex` value. If two gesture handlers are registered via `onGesture()`, both fire for every event. The `ScreenController` only registers one handler — but if a stats overlay is implemented with its own gesture listener, the overlay and the main controller both process the same double-tap.

**Prevention:**
Maintain a single gesture routing point. The `ScreenController.handleGesture()` is the single entry point — keep it that way. Stats screen must not register its own gesture listener. Navigation changes must go through the centralized gesture handler. Adding a feature should mean adding a case in `ScreenController`, not adding a new `onGesture()` subscription.

**Warning signs:**
- A gesture fires actions on two different screens simultaneously
- The stats screen works correctly but double-tap on the stats screen also navigates away from the battle
- Console shows two gesture handler invocations for one physical tap

**Phase to address:** Navigation redesign phase and stats screen phase. Enforce: one `onGesture()` listener, always.

---

## Phase-Specific Warnings

| Phase Topic | Pitfall to Watch | Mitigation |
|-------------|-----------------|------------|
| Consolidated battle menu | Container count exceeds 4 (C1) | Map container slots BEFORE writing code |
| Consolidated battle menu | Action index shifting breaks handlers (C2) | Use typed enum for action items |
| Consolidated battle menu | Animation resets list cursor (C3) | Keep animation in text-only ANIMATING state |
| Consolidated battle menu | Tera fired accidentally (M3) | Keep two-step tera; use notifier not single-tap |
| Stats screen | Budget overflow (C4) | Write budget assertion test before device test |
| Stats screen | Missing data fields (M5) | Audit data sources before writing renderer |
| Speed controls | Constants not read at runtime (M2) | Use module-level getter, not const values |
| Speed controls | Slow mode persists to next session (N2) | Do not persist "slow" to localStorage |
| Back button removal | Double-tap ambiguity (M1) | Define back-allowed list per screen state first |
| Back button removal | Forced switch allows back (N3) | backAllowed flag must block forced-switch screen |
| Animation text box | 5th container silently ignored (N1) | Use separator characters, not extra container |
| ScreenController additions | God object grows (I1) | Extract PhoneCompanion, enforce renderer-first |
| Removing TERA_CONFIRM | Dead transitions remain (I2) | Delete type union member, fix all TS errors |
| Parallel feature branches | Duplicate gesture listeners (I3) | Single onGesture entry point, always |
| Any animation change | SDK call rate causes lag (M4) | Never call showBattleHud inside animation loop |

---

## "Looks Done But Isn't" Checklist for v1.1

Things that appear complete in browser but have critical gaps on device:

- [ ] **Consolidated menu**: Container count logged and verified <= 4 on real device
- [ ] **Action indices**: Enum-driven renderer and handler tested with "wrong position" scenario (cursor at wrong item + tap)
- [ ] **Stats screen**: Character budget assertion passes for worst-case Pokemon (3 abilities, 6 volatiles, +6/-6 all stats)
- [ ] **Stats screen data**: Every displayed field traced to its source data path (no "undefined" values)
- [ ] **Speed controls**: Changing speed mid-battle on real device takes effect immediately (not on next battle)
- [ ] **Speed controls**: "Slow" speed does not persist to next launch
- [ ] **Double-tap back**: Forced switch screen blocks double-tap-back — confirmed with a Pikachu vs Golem battle where player's active faints immediately
- [ ] **Tera without confirmation**: Two-step tera (select tera → select move) verified: correct `TERA_ATTACK` action fires, teraUsed flag flips exactly once
- [ ] **Animation text box**: Text and sprites do not render on top of each other in an unreadable way on device
- [ ] **Full regression**: After all v1.1 changes, run 3 complete 6v6 battles including: voluntary switch, forced switch, tera use, double faint, speed change mid-battle, stats screen view during battle

---

## Sources

- Direct inspection of `src/screens/ScreenController.ts`, `src/adapters/glassAdapter.ts`, `src/config/constants.ts`, `src/animation/AnimationEngine.ts` in this project (HIGH confidence — primary source)
- [Nick Ustinov's G2 Community Notes](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) — Container limits (max 4), character budgets, rebuildPageContainer cursor reset behavior (HIGH confidence)
- [Even Realities G2 SDK Architecture Notes](https://www.evenrealities.com/blog/how-we-rebuilt-g2-from-the-inside-out) — Display pipeline behavior (MEDIUM confidence)
- [Navigating Pitfalls: The Do's and Don'ts of Gestural Interfaces](https://www.createwithswift.com/navigating-pitfalls-the-dos-and-donts-of-gestural-interfaces/) — Gesture discoverability, double-tap accidental activation, system gesture conflicts (MEDIUM confidence)
- [Bad UI in Games: Common Pitfalls](https://mainleaf.com/bad-ui-in-games/) — Menu consolidation cognitive load, information hierarchy on small screens (MEDIUM confidence)
- [Minimize Cognitive Load in Game UI](https://www.wayline.io/blog/minimize-cognitive-load-game-ui) — Information prioritization patterns for constrained game displays (MEDIUM confidence)
- G2 SDK observed behavior in the existing working v0.1 codebase: rebuildPageContainer cursor reset, 4-container limit, sequential BMP write pattern (HIGH confidence — validated by running code)

---

*Pitfalls research for: Pokemon Showdown G2 v1.1 UI Enhancement milestone*
*Researched: 2026-03-01*
