# Phase 9: Navigation & HUD Consolidation - Research

**Researched:** 2026-03-02
**Domain:** Gesture handling, screen state machine refactoring, battle HUD consolidation
**Confidence:** HIGH

## Summary

This phase consolidates the battle UI by eliminating two screens (ACTION_MENU, TERA_CONFIRM), replacing "< Back" list items with double-tap navigation, and transforming the battle HUD into a unified action list. The scope is entirely within the existing codebase -- no new libraries are needed. The primary technical challenges are: (1) mapping the SDK's DOUBLE_CLICK_EVENT to a new DOUBLE_TAP gesture kind, (2) refactoring ScreenController's navigation graph to remove two screen states and add centralized back-navigation, (3) detecting trapping from the sim's activeRequest to gray out the Switch option, and (4) implementing Tera as a toggle with visual indicators.

All changes are concentrated in 7 files: `contracts.ts` (GestureKind), `glassAdapter.ts` (event mapping), `ScreenState.ts` (ScreenName union), `ScreenController.ts` (state machine + handlers), and 3 renderers (battleHudRenderer, attackSelectRenderer, switchSelectRenderer). The actionMenuRenderer and teraConfirmRenderer files are deleted.

**Primary recommendation:** Implement in three waves: (1) DOUBLE_TAP gesture + back navigation, (2) battle HUD as action list + screen elimination, (3) Tera toggle + trapping detection.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @evenrealities/even_hub_sdk | current | Provides OsEventTypeList.DOUBLE_CLICK_EVENT | Only source of gesture events from G2 hardware |
| @pkmn/sim | current | Exposes `activeRequest.active[0].trapped` and `canTerastallize` | Authoritative source of game state for trapping/tera availability |

### Supporting
No new libraries needed. This phase refactors existing code only.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SDK DOUBLE_CLICK_EVENT | Custom timing logic (setTimeout) | CONTEXT.md explicitly locks: use SDK's built-in detection, do NOT implement custom timing |

**Installation:**
No new packages required.

## Architecture Patterns

### Current Navigation Graph (to be changed)
```
MAIN_MENU -> BATTLE_HUD -> ACTION_MENU -> ATTACK_SELECT
                                       -> SWITCH_SELECT
                                       -> TERA_CONFIRM -> ATTACK_SELECT
TURN_RESULT -> BATTLE_HUD | SWITCH_SELECT (forced) | END_SCREEN
```

### New Navigation Graph (after this phase)
```
MAIN_MENU -> BATTLE_HUD -> ATTACK_SELECT
                        -> SWITCH_SELECT
                        -> (Tera queues, opens ATTACK_SELECT)
TURN_RESULT -> BATTLE_HUD | SWITCH_SELECT (forced) | END_SCREEN

Double-tap back paths:
  ATTACK_SELECT  -> BATTLE_HUD
  SWITCH_SELECT  -> BATTLE_HUD (blocked during forced switch)
  BATTLE_HUD     -> forfeit confirmation
```

### Recommended File Changes
```
src/
  types/
    contracts.ts            # Add 'DOUBLE_TAP' to GestureKind union
  adapters/
    glassAdapter.ts         # Map DOUBLE_CLICK_EVENT -> DOUBLE_TAP (not TAP)
  screens/
    ScreenState.ts          # Remove ACTION_MENU, TERA_CONFIRM from ScreenName
    ScreenController.ts     # Major refactor: handleGesture, onDoubleTap, battle HUD as list
    renderers/
      actionMenuRenderer.ts # DELETE
      teraConfirmRenderer.ts # DELETE
      battleHudRenderer.ts  # New: render action list items (Attack/Switch/Tera/Stats)
      attackSelectRenderer.ts # Remove "< Back", add tera banner, adjust indexing
      switchSelectRenderer.ts # Remove "< Back", add trapping, adjust indexing
```

### Pattern 1: DOUBLE_TAP Gesture Kind
**What:** Add `'DOUBLE_TAP'` to the `GestureKind` union and map `OsEventTypeList.DOUBLE_CLICK_EVENT` to it in glassAdapter.
**When to use:** Every double-tap from the G2 hardware fires DOUBLE_CLICK_EVENT; this should produce a `DOUBLE_TAP` gesture event (not `TAP`).

```typescript
// contracts.ts -- GestureKind union becomes:
export type GestureKind =
  | 'SCROLL_FWD'
  | 'SCROLL_BACK'
  | 'TAP'
  | 'DOUBLE_TAP'    // NEW
  | 'FOREGROUND_ENTER'
  | 'FOREGROUND_EXIT';

// glassAdapter.ts -- mapEventToGesture change:
if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
  return { kind: 'DOUBLE_TAP' };  // Was: { kind: 'TAP', listIndex: ... }
}
```

### Pattern 2: Centralized Back-Navigation Handler
**What:** A single `onDoubleTap()` method in ScreenController that handles back navigation for ALL screens via a switch on `this.state.screen`.
**When to use:** Every DOUBLE_TAP gesture routes here instead of per-screen "< Back" handlers.

```typescript
// ScreenController -- new handler in handleGesture:
case 'DOUBLE_TAP':
  await this.onDoubleTap();
  break;

private async onDoubleTap(): Promise<void> {
  switch (this.state.screen) {
    case 'ATTACK_SELECT':
      this.teraQueued = false;  // Clear tera queue on back
      this.state = { ...this.state, screen: 'BATTLE_HUD', cursorIndex: 0 };
      await this.render();
      break;
    case 'SWITCH_SELECT':
      if (this.forcedSwitch) return;  // Blocked during forced switch
      this.state = { ...this.state, screen: 'BATTLE_HUD', cursorIndex: 0 };
      await this.render();
      break;
    case 'BATTLE_HUD':
      // Forfeit confirmation -- show a confirm prompt or navigate to forfeit flow
      await this.handleForfeitConfirmation();
      break;
    // MAIN_MENU, END_SCREEN, TURN_RESULT, ANIMATING: no-op
    default:
      break;
  }
}
```

### Pattern 3: Battle HUD as Action List
**What:** The BATTLE_HUD screen renders as a `ListScreen` with selectable action items instead of a static `BattleHudScreen`. The sprites+HP are in the status bar or are sacrificed in favor of the list layout.
**When to use:** When the player is on the BATTLE_HUD and needs to pick Attack/Switch/Tera/Stats.

**Critical constraint from CONTEXT.md:** "No visible 'Back to Menu' list item -- back to menu is ONLY via double-tap (triggers forfeit confirmation)." The battle HUD action list is: Attack, Switch, Tera, Stats (4 items). No "Back to Menu" in the list.

```typescript
// New battle HUD renderer -- returns ListScreen instead of BattleHudScreen:
export function renderBattleHudActions(state: BattleState): ListScreen {
  const items: string[] = [];

  items.push('Attack');

  // Trapping detection
  const battle = SimBattleAdapter.getBattle();
  const request = battle?.sides[0]?.activeRequest;
  const isTrapped = request && 'active' in request && request.active?.[0]?.trapped;
  items.push(isTrapped ? 'Switch (trapped)' : 'Switch');

  // Tera state
  const mon = state.playerSide.team[state.playerSide.activeIndex]!;
  if (mon.teraActive) {
    items.push('Tera (active)');
  } else if (state.playerSide.teraUsed) {
    items.push('Tera (used)');
  } else {
    items.push('Tera');
  }

  items.push('Stats');

  return {
    items,
    status: `Turn ${state.turnCount}`,
  };
}
```

**Note on HUD layout change:** The current BATTLE_HUD shows sprites via `showBattleHud()`. The new BATTLE_HUD shows a list via `showList()`. This means sprites disappear on the action screen. Phase 10 (Overlay HUD Layouts) addresses keeping sprites visible -- this phase intentionally does NOT attempt that. The action list IS the battle HUD now.

### Pattern 4: Index Shift After Removing "< Back"
**What:** When "< Back" is removed from renderers, all list indices shift down by 1. Every tap handler that checks `idx` must be updated.
**When to use:** All renderers and their corresponding handlers.

```
BEFORE: items = ["< Back", "Move1", "Move2", "Move3", "Move4"]
         idx:     0          1        2        3        4

AFTER:  items = ["Move1", "Move2", "Move3", "Move4"]
         idx:     0        1        2        3

// In handleAttackSelect: moveIndex = idx (was idx - 1)
// In handleSwitchSelect: use switchIndexMap[idx] (was switchIndexMap[idx - 1])
```

### Pattern 5: Tera Toggle with Status Banner
**What:** Tapping Tera on the battle HUD toggles `teraQueued` and immediately opens ATTACK_SELECT. The attack select renderer shows "[TERA QUEUED]" text when `teraQueued` is true.

```typescript
// ScreenController -- battle HUD tap handler for Tera item:
case 2: // "Tera" at index 2
  if (state.playerSide.teraUsed || activeMon.teraActive) return; // grayed out
  this.teraQueued = !this.teraQueued; // Toggle
  this.state = { ...this.state, screen: 'ATTACK_SELECT', cursorIndex: 0 };
  await this.render();
  break;

// attackSelectRenderer -- add tera banner:
export function renderAttackSelect(state: BattleState, teraQueued: boolean): ListScreen {
  const items: string[] = [];
  if (teraQueued) {
    items.push('[TERA QUEUED]'); // Non-selectable banner at top
  }
  // ... moves follow
}
```

### Pattern 6: Detecting Trapping from Sim Request
**What:** Read `battle.sides[0].activeRequest.active[0].trapped` to determine if the player's active Pokemon is trapped.
**When to use:** When rendering the battle HUD action list.

```typescript
// Source: @pkmn/sim side.d.ts -- PokemonMoveRequestData
// Fields: trapped?: boolean, maybeTrapped?: boolean

function isPlayerTrapped(): boolean {
  const battle = SimBattleAdapter.getBattle();
  if (!battle) return false;
  const request = battle.sides[0]?.activeRequest;
  if (!request || !('active' in request) || !request.active?.[0]) return false;
  return !!(request.active[0].trapped || request.active[0].maybeTrapped);
}
```

**Confidence:** HIGH -- verified from `@pkmn/sim/build/cjs/sim/side.d.ts` line 77: `trapped?: boolean`.

### Anti-Patterns to Avoid
- **Custom double-tap timing logic:** CONTEXT.md explicitly says "Use G2 SDK's built-in double-tap/DOUBLE_CLICK_EVENT detection -- do NOT implement custom timing logic." The SDK already discriminates single vs double tap at the firmware/SDK level.
- **Keeping ACTION_MENU as a hidden state:** Delete it completely. Don't leave dead code paths.
- **Attempting sprites on the battle HUD list:** Phase 10 handles overlay layouts. This phase uses `showList()` for the battle HUD, which means no sprites. Don't try to combine list + images here.
- **Clearing teraQueued on Switch:** CONTEXT.md says "Switching instead of attacking does NOT clear the Tera queue -- it persists for next turn."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Double-tap detection | Custom setTimeout timing | SDK's DOUBLE_CLICK_EVENT | SDK already handles the timing at firmware level; context explicitly forbids custom logic |
| Trapping detection | Custom volatile checking | `activeRequest.active[0].trapped` | Sim already computes this accurately for all trapping abilities |
| Tera availability | Custom teraUsed tracking | `activeRequest.active[0].canTerastallize` | Sim tracks whether tera is available this turn |

## Common Pitfalls

### Pitfall 1: Index Shift Off-by-One After Removing "< Back"
**What goes wrong:** Every renderer currently has "< Back" at index 0. All tap handlers use `idx - 1` to map to actual data. After removing "< Back", using `idx - 1` reads the wrong move/Pokemon.
**Why it happens:** Easy to forget that removing the first item shifts all subsequent indices.
**How to avoid:** When removing "< Back" from a renderer, simultaneously update the corresponding handler to use `idx` directly instead of `idx - 1`. Test both together.
**Warning signs:** Wrong move selected, wrong Pokemon switched to.

### Pitfall 2: SwitchListScreen indexMap Offset
**What goes wrong:** `SwitchListScreen.indexMap` currently uses `indexMap[displayIndex - 1]` because index 0 is "< Back". After removing "< Back", it should be `indexMap[displayIndex]`.
**Why it happens:** The comment in ScreenState.ts explicitly says "offset -1 because index 0 is '< Back'". This comment must be updated along with the code.
**How to avoid:** Update the interface comment and the mapping logic in lockstep.
**Warning signs:** Switching to wrong team member or crash on out-of-bounds access.

### Pitfall 3: Double-Tap Fires During Animation
**What goes wrong:** If DOUBLE_TAP is not blocked during ANIMATING state, a double-tap could trigger back navigation while an animation is playing.
**Why it happens:** The current animation blocking code in `handleGesture` only checks for TAP events. DOUBLE_TAP is a new event kind that must also be blocked.
**How to avoid:** The animation blocking check at the top of `handleGesture` should block ALL gesture kinds during animation (already does for non-TAP -- they return early), but DOUBLE_TAP should behave like TAP: skip animation on double-tap.
**Warning signs:** Animation interrupted, state corruption.

### Pitfall 4: Tera Toggle State Persists Across Turns Incorrectly
**What goes wrong:** `teraQueued` could persist after a turn resolves if not cleared properly.
**Why it happens:** Currently, `teraQueued` is cleared in `handleAttackSelect` after selecting a move (line 236). But if the player backs out and re-enters without selecting, the queue state is ambiguous.
**How to avoid:** Clear `teraQueued` after `resolveTurn` completes (when the action is submitted). The toggle should only persist while browsing -- once an action is submitted, it resets. Per CONTEXT.md, switching does NOT clear the tera queue.
**Warning signs:** "[TERA QUEUED]" shows on the next turn when tera was already used.

### Pitfall 5: Forced Switch Doesn't Block Double-Tap
**What goes wrong:** During forced switch (after a faint), double-tap must be blocked entirely. If the DOUBLE_TAP handler doesn't check `this.forcedSwitch`, the player can escape the forced switch screen.
**Why it happens:** The forced switch block is currently in `handleSwitchSelect` at `idx === 0`. Moving to `onDoubleTap` requires re-implementing the guard.
**How to avoid:** In `onDoubleTap()`, for SWITCH_SELECT screen: `if (this.forcedSwitch) return;`
**Warning signs:** Players escaping forced switch, sim state desync.

### Pitfall 6: Forfeit Confirmation on Battle HUD Double-Tap
**What goes wrong:** Double-tap on battle HUD needs to trigger forfeit confirmation, not immediate exit. If implemented as instant navigation to MAIN_MENU, players lose their battle accidentally.
**Why it happens:** All other double-tap backs are immediate. Battle HUD is special.
**How to avoid:** Show a confirmation message ("Forfeit? Tap again to confirm") or navigate to a confirm list. CONTEXT.md specifies "triggers forfeit confirmation."
**Warning signs:** Accidental battle exits.

## Code Examples

### Example 1: Complete handleGesture with DOUBLE_TAP
```typescript
// Source: Codebase analysis of ScreenController.ts
async handleGesture(event: GestureEvent): Promise<void> {
  // Animation blocking
  if (this.animationEngine.isRunning()) {
    if (event.kind === 'TAP' || event.kind === 'DOUBLE_TAP') {
      this.animationEngine.skip();
    }
    return;
  }

  switch (event.kind) {
    case 'TAP':
      await this.onTap(event.listIndex);
      break;
    case 'DOUBLE_TAP':
      await this.onDoubleTap();
      break;
    case 'FOREGROUND_ENTER':
      await this.render();
      break;
    case 'SCROLL_FWD':
    case 'SCROLL_BACK':
    case 'FOREGROUND_EXIT':
      break;
  }
}
```

### Example 2: Battle HUD Tap Handler (replaces ACTION_MENU)
```typescript
// Source: Codebase analysis -- new handler replacing handleActionMenu + BATTLE_HUD tap
private async handleBattleHud(idx: number): Promise<void> {
  const bs = this.state.battleState!;

  switch (idx) {
    case 0: // "Attack"
      this.state = { ...this.state, screen: 'ATTACK_SELECT', cursorIndex: 0 };
      await this.render();
      break;

    case 1: // "Switch" or "Switch (trapped)"
      if (this.isPlayerTrapped()) return; // Grayed out, do nothing
      this.forcedSwitch = false;
      this.state = { ...this.state, screen: 'SWITCH_SELECT', cursorIndex: 0 };
      await this.render();
      break;

    case 2: // "Tera" / "Tera (used)" / "Tera (active)"
      const mon = bs.playerSide.team[bs.playerSide.activeIndex]!;
      if (bs.playerSide.teraUsed || mon.teraActive) return; // Grayed out
      this.teraQueued = !this.teraQueued; // Toggle
      this.state = { ...this.state, screen: 'ATTACK_SELECT', cursorIndex: 0 };
      await this.render();
      break;

    case 3: // "Stats"
      // Phase 11 implements stats screen -- for now, no-op or placeholder
      break;
  }
}
```

### Example 3: Attack Select Without "< Back", With Tera Banner
```typescript
// Source: Codebase analysis of attackSelectRenderer.ts
export function renderAttackSelect(
  state: BattleState,
  teraQueued: boolean,
): ListScreen {
  const mon = state.playerSide.team[state.playerSide.activeIndex]!;
  const items: string[] = [];

  if (teraQueued) {
    items.push('[TERA QUEUED]');
  }

  for (const slug of mon.moves) {
    const moveData = DataLoader.getMove(slug);
    const moveName = moveData?.name ?? slug;
    const moveType = moveData?.type ?? '???';
    const maxPp = moveData?.pp ?? 0;
    const used = mon.ppUsed[slug] ?? 0;
    const remaining = Math.max(0, maxPp - used);

    let label = `${moveName} (${moveType}) ${remaining}/${maxPp}`;
    if (remaining === 0) label += ' [--]';

    if (label.length > DISPLAY_BUDGET.LINE_WIDTH) {
      const truncName = moveName.slice(0, moveName.length - (label.length - DISPLAY_BUDGET.LINE_WIDTH));
      label = `${truncName} (${moveType}) ${remaining}/${maxPp}`;
      if (remaining === 0) label += ' [--]';
    }

    items.push(label);
  }

  return {
    items,
    status: teraQueued ? 'Tera: choose move' : 'Choose move',
  };
}
```

### Example 4: Switch Select Without "< Back", With Forced Switch Header
```typescript
// Source: Codebase analysis of switchSelectRenderer.ts
export function renderSwitchSelect(
  state: BattleState,
  forced: boolean,
): SwitchListScreen {
  const side = state.playerSide;
  const items: string[] = [];
  const indexMap: number[] = [];

  for (let i = 0; i < side.team.length; i++) {
    if (i === side.activeIndex) continue;
    const mon = side.team[i]!;

    if (mon.fainted) {
      items.push(`${mon.name.slice(0, 12)} 0% (fainted)`);
      indexMap.push(-1);
      continue;
    }

    const hpPct = Math.max(1, Math.round((mon.currentHp / mon.stats.hp) * 100));
    items.push(`${mon.name.slice(0, 12)} ${hpPct}%`);
    indexMap.push(i);
  }

  return {
    items,
    indexMap,
    status: forced ? 'MUST SWITCH' : 'SWITCH',
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| BATTLE_HUD is a static display (tap anywhere opens ACTION_MENU) | BATTLE_HUD is a selectable list (Attack/Switch/Tera/Stats) | This phase | One less screen transition; faster gameplay |
| "< Back" as list item at index 0 | Double-tap for back navigation | This phase | Cleaner lists; requires gesture layer change |
| TERA_CONFIRM as separate screen | Tera is a toggle on battle HUD | This phase | Eliminates confirmation step; faster tera |
| DOUBLE_CLICK_EVENT maps to TAP | DOUBLE_CLICK_EVENT maps to DOUBLE_TAP | This phase | Enables gesture-based back navigation |

**Deprecated/outdated after this phase:**
- `ACTION_MENU` screen type: eliminated, battle HUD serves this purpose
- `TERA_CONFIRM` screen type: eliminated, tera is a toggle
- `renderActionMenu()`: deleted
- `renderTeraConfirm()`: deleted
- `handleActionMenu()`: deleted, logic merged into handleBattleHud
- `handleTeraConfirm()`: deleted, logic is a toggle in handleBattleHud

## Open Questions

1. **Stats screen placeholder on battle HUD**
   - What we know: Phase 11 implements the stats screen. The battle HUD list includes "Stats" as item index 3.
   - What's unclear: Should tapping "Stats" be a no-op until Phase 11, or should we add a placeholder "Coming soon" message?
   - Recommendation: Make it a no-op (return without action). Phase 11 will wire it up.

2. **Forfeit confirmation UX**
   - What we know: Double-tap on BATTLE_HUD triggers "forfeit confirmation." CONTEXT.md says so.
   - What's unclear: The exact UX -- is it a text message ("Tap again to forfeit"), a list with Yes/No, or something else?
   - Recommendation: Show a temporary message via `glass.showMessage("Double-tap again to forfeit")` and set a flag. If another double-tap arrives within ~3 seconds, navigate to MAIN_MENU. This avoids creating a new screen type. Alternatively, reuse the simple list pattern with ["Forfeit", "Continue Battle"].

3. **Tera un-queue from battle HUD**
   - What we know: CONTEXT.md says "Tera acts as a toggle -- tap Tera again on HUD to un-queue."
   - What's unclear: If teraQueued is true and the player is on BATTLE_HUD, tapping Tera should un-queue (set teraQueued = false) and stay on BATTLE_HUD. But the normal Tera tap opens ATTACK_SELECT. Need to differentiate.
   - Recommendation: If `teraQueued` is already true when Tera is tapped on HUD, toggle it off and re-render HUD (don't open ATTACK_SELECT). If false, toggle on and open ATTACK_SELECT.

4. **SwitchListScreen interface comment update**
   - What we know: The interface comment says "offset -1 because index 0 is '< Back'". After removing "< Back", this is wrong.
   - Recommendation: Update the comment to reflect that indexMap[displayIndex] = team index (no offset).

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `src/screens/ScreenController.ts` -- full navigation graph, all handlers
- Codebase inspection: `src/adapters/glassAdapter.ts` -- DOUBLE_CLICK_EVENT mapping at line 471
- Codebase inspection: `src/screens/ScreenState.ts` -- ScreenName union, BattleHudScreen/ListScreen types
- Codebase inspection: `src/screens/renderers/*.ts` -- all renderer implementations
- `@pkmn/sim` type definitions: `node_modules/@pkmn/sim/build/cjs/sim/side.d.ts` -- PokemonMoveRequestData.trapped, MoveRequest.active
- `@pkmn/sim` type definitions: `node_modules/@pkmn/sim/build/cjs/sim/side.d.ts` -- canTerastallize field

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` -- Prior v1.1 research on DOUBLE_TAP gesture pattern
- `.planning/research/PITFALLS.md` -- Prior v1.1 pitfall analysis on double-tap ambiguity

### Tertiary (LOW confidence)
- None -- all findings from direct codebase and type definition inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all changes in existing code
- Architecture: HIGH -- complete codebase audit of all affected files performed
- Pitfalls: HIGH -- based on direct code inspection of index handling, forced switch guards, and state management
- Trapping detection: HIGH -- verified from @pkmn/sim type definitions

**Research date:** 2026-03-02
**Valid until:** Indefinite (codebase-specific, not dependent on external library updates)
