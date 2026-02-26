# Phase 5: Screen Layer - Research

**Researched:** 2026-02-26
**Domain:** Even Realities G2 SDK screen rendering, state-machine driven navigation, and phone companion HTML
**Confidence:** HIGH

---

## Summary

Phase 5 builds the complete UI layer: a screen state machine that reads from `BattleState` and renders to the G2 glasses via the existing `GlassAdapter`, plus a phone companion panel in `index.html`. The `GlassAdapter` is already fully implemented and provides four methods — `showList`, `showText`, `updateText`, `showMessage` — that exactly match what each screen type needs. No new dependencies are required.

The architecture is a pure screen renderer: a `ScreenController` that holds the current screen enum and a cursor index, maps `BattleState` to screen content, and routes `GestureEvent` to the correct action. All battle logic remains in `BattleEngine`/`AIOpponent`. The screen layer only reads state and calls engine methods — it never writes to state directly.

Display constraints are the dominant engineering concern: the G2 display is 64 chars/line at 8 lines maximum (576×288 px), with a 1000-char limit on `createStartUpPageContainer` and `rebuildPageContainer`, and a 900-char safe budget to leave room for the status bar. The existing `GlassAdapter.showList` handles scrollable lists using the SDK's `ListContainerProperty`; `showText` handles text blocks. Neither method needs modification.

**Primary recommendation:** Implement `ScreenController` as a class in `src/screens/ScreenController.ts`. It owns screen state (which screen is active, cursor position), maps `BattleState` to display content through pure render functions in `src/screens/renderers/`, and handles gestures by routing them to `BattleEngine`, `AIOpponent`, or screen transitions. Wire it into `main.ts` after `DataLoader.validate()`.

---

## Standard Stack

No new npm packages. All tools are already installed.

### Core (already in project)

| Module | Location | Purpose | Why Standard |
|--------|----------|---------|--------------|
| `GlassAdapter` | `src/adapters/glassAdapter.ts` | Renders to glasses — `showList`, `showText`, `updateText`, `showMessage` | Fully implemented; handles all SDK quirks (CLICK_EVENT=0, scroll cooldown, rebuild retry) |
| `BattleEngine` | `src/battle/BattleEngine.ts` | `startBattle()`, `submitAction()`, `submitSwitch()` | Pure engine, no glass calls — screen layer calls it |
| `AIOpponent` | `src/battle/AIOpponent.ts` | `pickAction(state)` — opponent's action each turn | Synchronous; always returns a valid `PlayerAction` |
| `BattleState` + types | `src/types/battleState.ts` | `BattleState`, `BattleSide`, `ActivePokemon`, `TurnResult`, `TurnLogEntry` | All state types needed by renderers |
| `GestureEvent` | `src/types/contracts.ts` | Input events from glasses | `SCROLL_FWD`, `SCROLL_BACK`, `TAP` with optional `listIndex` |
| `GLASS_LAYOUT`, `TIMING` | `src/config/constants.ts` | Display pixel dimensions, scroll cooldown | Hard constants for the G2 hardware |

### Supporting (already in project)

| Module | Location | Purpose | When to Use |
|--------|----------|---------|-------------|
| `DataLoader.getMove()` | `src/data/DataLoader.ts` | Move display names + types | Attack selection screen: show type labels |
| `TeamGenerator.buildRandom()` | `src/battle/TeamGenerator.ts` | Generate teams | Main menu "Enter Battle" tap handler |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ScreenController` class | Functional state machine in main.ts | Class is cleaner for cursor + screen state; easier to test |
| Direct SDK calls in controller | Extending GlassAdapter | Keep GlassAdapter as the single SDK boundary; controller calls adapter only |
| Inline render functions | Separate renderer file | Separate file keeps controller small and renderers testable in isolation |

**Installation:** No new packages. Do not run `npm install`.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── adapters/
│   └── glassAdapter.ts         # Existing — unchanged
├── battle/
│   ├── BattleEngine.ts         # Existing — unchanged
│   ├── AIOpponent.ts           # Existing — unchanged
│   └── TeamGenerator.ts        # Existing — unchanged
├── screens/
│   ├── ScreenController.ts     # NEW: screen state machine + gesture router
│   ├── ScreenState.ts          # NEW: ScreenName enum + ScreenState interface
│   └── renderers/
│       ├── mainMenuRenderer.ts     # NEW: UI-01
│       ├── battleHudRenderer.ts    # NEW: UI-02
│       ├── actionMenuRenderer.ts   # NEW: UI-03
│       ├── attackSelectRenderer.ts # NEW: UI-04
│       ├── switchSelectRenderer.ts # NEW: UI-05
│       ├── teraConfirmRenderer.ts  # NEW: UI-06
│       ├── turnResultRenderer.ts   # NEW: UI-07
│       └── endScreenRenderer.ts   # NEW: UI-08
├── config/
│   └── constants.ts            # Existing — add CHAR_LIMIT, SAFE_BUDGET constants if not present
├── types/
│   └── contracts.ts            # Existing — GlassAdapter, GestureEvent
└── main.ts                     # MODIFIED: wire ScreenController after DataLoader.validate()
```

### Pattern 1: Screen State Machine

**What:** `ScreenController` holds current screen name + cursor index. On each gesture, it routes to a handler. On each state change, it re-renders by calling the appropriate renderer and then calling `glass.showList` or `glass.showText`.

**When to use:** Always for navigation logic.

```typescript
// src/screens/ScreenState.ts
export type ScreenName =
  | 'MAIN_MENU'
  | 'BATTLE_HUD'
  | 'ACTION_MENU'
  | 'ATTACK_SELECT'
  | 'SWITCH_SELECT'
  | 'TERA_CONFIRM'
  | 'TURN_RESULT'
  | 'END_SCREEN';

export interface ScreenState {
  screen: ScreenName;
  cursorIndex: number;  // highlighted item in list screens
  battleState: BattleState | null;  // null before battle starts
}
```

```typescript
// src/screens/ScreenController.ts — pattern for gesture routing
class ScreenController {
  private state: ScreenState = {
    screen: 'MAIN_MENU',
    cursorIndex: 0,
    battleState: null,
  };

  async handleGesture(event: GestureEvent): Promise<void> {
    switch (event.kind) {
      case 'SCROLL_FWD': return this.onScrollDown();
      case 'SCROLL_BACK': return this.onScrollUp();
      case 'TAP': return this.onTap(event.listIndex);
    }
  }

  private async render(): Promise<void> {
    // Calls the appropriate renderer for this.state.screen
    // then calls glass.showList or glass.showText
  }
}
```

### Pattern 2: Pure Renderer Functions

**What:** Each renderer is a pure function that takes `BattleState` (and optionally cursor state) and returns `{ items: string[], status: string }` for list screens or `{ text: string, status: StatusBar }` for text screens.

**When to use:** For every screen. Pure functions are easy to unit-test for display constraint compliance.

```typescript
// src/screens/renderers/battleHudRenderer.ts
import type { BattleState } from '../../types/battleState.js';
import type { StatusBar } from '../../types/contracts.js';

export interface TextScreen {
  text: string;
  status: StatusBar;
}

// Source: codebase analysis — UI-02 requirements
export function renderBattleHud(state: BattleState): TextScreen {
  const player = state.playerSide;
  const opp = state.opponentSide;
  const playerMon = player.team[player.activeIndex]!;
  const oppMon = opp.team[opp.activeIndex]!;

  const playerHpPct = Math.round((playerMon.currentHp / playerMon.stats.hp) * 100);
  const oppHpPct = Math.round((oppMon.currentHp / oppMon.stats.hp) * 100);

  // Fit within 64 chars/line — names truncated to 12 chars if needed
  const text = [
    `Foe: ${oppMon.name.slice(0, 12).padEnd(12)} ${oppHpPct}%`,
    ``,
    `You: ${playerMon.name.slice(0, 12).padEnd(12)} ${playerHpPct}%`,
  ].join('\n');

  return {
    text,
    status: { left: `Turn ${state.turnCount}`, right: 'Tap for menu' },
  };
}
```

### Pattern 3: List Screen with Back Navigation

**What:** Every sub-menu includes `"< Back"` as the first item (index 0). Tap on index 0 returns to the parent screen without any engine call.

**When to use:** Action menu, attack select, switch select, tera confirm (UI-03 through UI-06).

```typescript
// Source: NAV-04 requirement — "< Back" at top of every sub-menu
export function renderActionMenu(): { items: string[]; status: string } {
  return {
    items: [
      '< Back',
      'Attack',
      'Switch',
      'Terastallize',
    ],
    status: 'Choose action',
  };
}
```

```typescript
// In ScreenController.onTap — Back routing
private async onTap(listIndex?: number): Promise<void> {
  const index = listIndex ?? this.state.cursorIndex;

  if (this.state.screen === 'ACTION_MENU' && index === 0) {
    // "< Back" — return to BATTLE_HUD
    this.state = { ...this.state, screen: 'BATTLE_HUD', cursorIndex: 0 };
    await this.render();
    return;
  }
  // ... other tap handlers
}
```

### Pattern 4: Turn Resolution Flow

**What:** The most complex interaction. After player picks an action, controller calls `AIOpponent.pickAction()` synchronously, then calls `BattleEngine.submitAction()`, shows the turn result log, then checks the next phase to know which screen to show.

**When to use:** When player confirms an attack, switch, or tera from their respective selection screen.

```typescript
// Pattern for resolving a turn
private async resolveTurn(playerAction: PlayerAction): Promise<void> {
  if (!this.state.battleState) return;

  const opponentAction = AIOpponent.pickAction(this.state.battleState);
  const result = BattleEngine.submitAction(
    this.state.battleState,
    playerAction,
    opponentAction,
  );

  // Show turn result log (UI-07)
  await this.showTurnResult(result);

  // Advance to the correct screen based on next phase
  const nextScreen = this.phaseToScreen(result.nextState.phase);
  this.state = {
    ...this.state,
    battleState: result.nextState,
    screen: nextScreen,
    cursorIndex: 0,
  };
  await this.render();
}

private phaseToScreen(phase: BattlePhase): ScreenName {
  switch (phase) {
    case 'WAITING_FOR_ACTION': return 'BATTLE_HUD';
    case 'WAITING_FOR_SWITCH': return 'SWITCH_SELECT';
    case 'BATTLE_OVER': return 'END_SCREEN';
    default: return 'BATTLE_HUD';
  }
}
```

### Pattern 5: Display Budget Enforcement

**What:** Every renderer must ensure its output never exceeds 900 chars (safe budget) for `showText` calls, and list item strings must fit within 64 chars.

**When to use:** In all renderer functions. Enforce at the renderer, not in the adapter.

```typescript
// Source: UI-09, GLASS_LAYOUT constraints
const SAFE_BUDGET = 900;  // Leave 100 chars for status bar

export function enforceDisplayBudget(text: string): string {
  return text.slice(0, SAFE_BUDGET);
}

export function enforceLineWidth(line: string, maxChars = 64): string {
  return line.slice(0, maxChars);
}
```

### Pattern 6: Phone Companion Screen (UI-10)

**What:** The phone companion in `index.html` shows battle state (sprites + HP) using standard HTML/CSS. No SDK involved. Sprites use the PokeAPI CDN (`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{id}.png`) or Showdown CDN.

**When to use:** Update companion UI from `ScreenController.render()` by mutating DOM elements directly.

```typescript
// Source: index.html already has battle-log div
private updatePhoneCompanion(state: BattleState): void {
  const battleLog = document.getElementById('battle-log');
  if (!battleLog) return;

  // Show sprites using PokeAPI sprite IDs
  // BattlePokemon.species maps to species slug; num from DataLoader.getPokemon()
  const playerMon = state.playerSide.team[state.playerSide.activeIndex]!;
  const oppMon = state.opponentSide.team[state.opponentSide.activeIndex]!;

  // Sprite URL: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{id}.png
  // OR Showdown: https://play.pokemonshowdown.com/sprites/gen5/{species-lowercase}.png
}
```

### Anti-Patterns to Avoid

- **Engine calls in renderers:** Renderers are pure functions — they read state, never call `BattleEngine` or `AIOpponent`.
- **Rebuilding on every scroll:** List containers use the SDK's internal scroll; SCROLL_FWD/SCROLL_BACK are boundary events. Do NOT rebuild the list on every scroll gesture. The cursor/highlight is managed by the firmware when `isItemSelectBorderEn: 1` is set.
- **Storing glass-specific state in BattleState:** Screen state (cursorIndex, current screen) lives in `ScreenController`, not in `BattleState`.
- **Overwriting text with list:** Cannot switch between `showList` and `showText` without a full `rebuildPageContainer`. Design each screen to consistently use one container type.
- **Assuming `listEvent.currentSelectItemIndex` is always present:** The CLICK_EVENT=0 quirk means `eventType` can be `undefined` on click; the existing `GlassAdapter.mapEventToGesture` already handles this. However, `listIndex` in `GestureEvent` may also be `undefined` if the user taps on a text container rather than a list. Always fall back to `cursorIndex` when `listIndex` is undefined.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scroll-to-advance cursor | Manual cursor tracking with SCROLL_FWD/BACK events | `showList` with `isItemSelectBorderEn: 1` | The SDK firmware tracks and highlights items internally; SCROLL_TOP/BOTTOM are boundary events only, not every-scroll events |
| Text truncation | Custom text fitting algorithm | `text.slice(0, SAFE_BUDGET)` at render boundary | Simple slice is sufficient; no reflow/word-wrap needed |
| Sprite URLs | Building CDN URL generator with forme resolution | Direct `DataLoader.getPokemon(name.toLowerCase())?.num` to get dex number, then `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${num}.png` | PokeAPI's numbering is standard |
| HP bar graphics | Canvas drawing or emoji blocks | HP percentage as a number, e.g. `"47%"` | G2 is text-only; no graphics in containers |
| Move type display | Full type chart lookup | `DataLoader.getMove(slug)?.type` — already available | Type is a string field on `MoveEntry`; just append it |
| Turn event narration | Natural language generation | Format each `TurnLogEntry.kind` with a fixed template | Requirements only need what happened, not flowing prose |

**Key insight:** The G2 display enforces constraints so tight that all meaningful formatting is just string slicing and line composition. Never invest in complex layout algorithms.

---

## Common Pitfalls

### Pitfall 1: SCROLL_FWD/BACK Are Boundary Events, Not Per-Item Events

**What goes wrong:** Developer assumes each swipe advances the cursor by one item and tries to manage `cursorIndex` manually, rebuilding the list on every scroll.

**Why it happens:** The gesture names (`SCROLL_FWD`, `SCROLL_BACK`) sound like "scroll one step." But they are boundary events — they fire when the user reaches the TOP or BOTTOM of the list, not on every swipe.

**How to avoid:** When using `showList`, let the firmware handle cursor movement with `isItemSelectBorderEn: 1`. Listen only for TAP with `listIndex` to know which item was selected. Do NOT rebuild the list on scroll events.

**Warning signs:** App performance feels slow with lag after every swipe; or cursor position is always wrong by one.

### Pitfall 2: Switching Between List and Text Containers Causes a Flash

**What goes wrong:** Switching from `showList` to `showText` (or vice versa) requires `rebuildPageContainer`, which flashes the display.

**Why it happens:** `rebuildPageContainer` replaces the entire page layout. `textContainerUpgrade` only updates text content in an existing text container — it does NOT work on a list container.

**How to avoid:** Design each screen as either a list screen OR a text screen. Do not mix within a single screen. Battle HUD and turn result are text screens. Action menu, attack select, switch select are list screens. Transitions between these types will flash once — that is acceptable; just minimize how often you transition.

**Warning signs:** Every screen change causes a visible flash even for minor updates.

### Pitfall 3: Text Budget Exceeded — Silent Truncation

**What goes wrong:** The SDK silently truncates content at 1000 chars during `createStartUpPageContainer` / `rebuildPageContainer`. The `GlassAdapter` already slices to 1000 in the text container, but content from multiple containers combined can hit the protobuf packet limit.

**Why it happens:** The existing `glassAdapter.ts` slices `.content` to 1000, but if you compose a very long battle turn result log, the text body alone may approach the limit.

**How to avoid:** Keep a `SAFE_BUDGET = 900` constant in constants.ts. All renderer functions enforce this. For turn result display, show only the most recent 5-6 log entries, not the entire battle history.

**Warning signs:** Screen cuts off mid-sentence; last item in a list is invisible.

### Pitfall 4: HP Percentage as Zero When Pokemon Has 1 HP

**What goes wrong:** `Math.round((1 / 340) * 100)` rounds to `0%`, which looks like a fainted Pokemon.

**Why it happens:** Integer rounding at low HP values.

**How to avoid:** Use `Math.max(1, Math.round(...))` for HP percentage display. Show `1%` as the minimum for non-fainted Pokemon.

**Warning signs:** Pokemon with 1 HP shows `0%` but isn't fainted.

### Pitfall 5: listIndex Is Undefined When Tapping Text Containers

**What goes wrong:** Using `event.listIndex!` without guard causes NaN-based index lookups.

**Why it happens:** `GestureEvent.listIndex` is `number | undefined`. It is only set when the event comes from a `listEvent`, not from `textEvent` or `sysEvent`.

**How to avoid:** Always use `const idx = event.listIndex ?? this.state.cursorIndex` before using the index. On text-container screens (battle HUD, turn result), ignore `listIndex` entirely and use a hardcoded action.

**Warning signs:** Tapping the battle HUD silently does nothing or crashes.

### Pitfall 6: Forced Switch Screen Must Only Show Alive Pokemon

**What goes wrong:** Switch select screen shows fainted Pokemon as selectable items, leading to an error when `BattleEngine.submitSwitch()` is called with a fainted index.

**Why it happens:** Iterating `team[]` without filtering `fainted === false`.

**How to avoid:** In `renderSwitchSelect()`, filter out `pokemon.fainted === true` entries AND the currently active Pokemon (`i === side.activeIndex`). Each item must store the original team index (not the display index) for the TAP handler.

**Warning signs:** `submitSwitch()` throws "Cannot switch to fainted Pokemon."

---

## Code Examples

Verified patterns from the existing codebase:

### GlassAdapter.showList usage

```typescript
// Source: src/adapters/glassAdapter.ts — showList signature
// items: string[] — each item is one list row (max ~64 chars each)
// statusText: string — shown in status bar
await glass.showList(
  ['< Back', 'Thunderbolt (Electric)', 'Volt Switch (Electric)', 'Nasty Plot (Dark)', 'Dazzling Gleam (Fairy)'],
  'Attack'
);
```

### GlassAdapter.showText + updateText usage

```typescript
// Source: src/adapters/glassAdapter.ts
// Full rebuild — use for screen transitions
await glass.showText(
  'Foe: Garchomp       89%\n\nYou: Pikachu         47%',
  { left: 'Turn 3', right: 'Tap for menu' }
);

// Lightweight in-place update — use for HP changes without screen transition
await glass.updateText(
  'Foe: Garchomp       62%\n\nYou: Pikachu         47%',
  { left: 'Turn 3', right: 'Tap for menu' }
);
```

### BattleState reading pattern

```typescript
// Source: src/types/battleState.ts — ActivePokemon shape
const side = state.playerSide;
const active: ActivePokemon = side.team[side.activeIndex]!;
const hpPct = Math.max(1, Math.round((active.currentHp / active.stats.hp) * 100));
const teraIndicator = active.teraActive ? ` [${active.teraType}]` : '';
const label = `${active.name.slice(0, 12)} ${hpPct}%${teraIndicator}`;
```

### Move list rendering (attack select)

```typescript
// Source: src/types/battleState.ts + src/types/pokemon.ts
// DataLoader.getMove returns MoveEntry with .type, .name
import { DataLoader } from '../data/DataLoader.js';

export function renderAttackSelect(state: BattleState): { items: string[]; status: string } {
  const side = state.playerSide;
  const active = side.team[side.activeIndex]!;

  const moveItems = active.moves.map(slug => {
    const move = DataLoader.getMove(slug);
    const ppUsed = active.ppUsed[slug] ?? 0;
    const ppMax = move?.pp ?? 10;
    const remaining = ppMax - ppUsed;
    const name = move?.name ?? slug;
    const type = move?.type ?? '?';
    // 64 char max: "Thunderbolt (Electric) 12/16" = 28 chars — safe
    return `${name} (${type}) ${remaining}/${ppMax}`;
  });

  return {
    items: ['< Back', ...moveItems],
    status: 'Choose move',
  };
}
```

### Switch select rendering (filtering fainted)

```typescript
// Source: UI-05 requirement + battleState.ts fainted field
export function renderSwitchSelect(
  state: BattleState,
  forced: boolean // true = forced faint switch, false = voluntary
): { items: string[]; status: string; indexMap: number[] } {
  const side = state.playerSide;

  // Build display items and a map from display-index to team-index
  const indexMap: number[] = [];
  const items: string[] = ['< Back'];

  for (let i = 0; i < side.team.length; i++) {
    if (i === side.activeIndex) continue;  // Skip current active
    const mon = side.team[i]!;
    if (mon.fainted) continue;  // Skip fainted

    const hpPct = Math.max(1, Math.round((mon.currentHp / mon.stats.hp) * 100));
    items.push(`${mon.name.slice(0, 12).padEnd(12)} ${hpPct}%`);
    indexMap.push(i);
  }

  return {
    items,
    status: forced ? 'Switch in!' : 'Switch to',
    indexMap,  // TAP handler uses: teamIndex = indexMap[displayIndex - 1]
  };
}
```

### Phone companion DOM update

```typescript
// Source: index.html — existing battle-log div + DataLoader.getPokemon()
private updatePhoneCompanion(state: BattleState): void {
  const log = document.getElementById('battle-log');
  if (!log) return;
  log.classList.add('visible');

  const playerMon = state.playerSide.team[state.playerSide.activeIndex]!;
  const oppMon = state.opponentSide.team[state.opponentSide.activeIndex]!;

  // Get dex number from DataLoader for sprite URL
  const playerEntry = DataLoader.getPokemon(playerMon.species.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const oppEntry = DataLoader.getPokemon(oppMon.species.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const spriteBase = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
  const playerSpriteUrl = playerEntry ? `${spriteBase}/${playerEntry.num}.png` : '';
  const oppSpriteUrl = oppEntry ? `${spriteBase}/${oppEntry.num}.png` : '';

  // OR use Showdown CDN (species slug format):
  // const showdownBase = 'https://play.pokemonshowdown.com/sprites/gen5';
  // const playerSpriteUrl = `${showdownBase}/${playerMon.species.toLowerCase().replace(/[^a-z0-9-]/g, '')}.png`;

  log.innerHTML = `
    <div class="log-entry info">Turn ${state.turnCount}</div>
    <div class="log-entry">Foe: ${oppMon.name} — ${Math.round((oppMon.currentHp / oppMon.stats.hp) * 100)}%</div>
    ${oppSpriteUrl ? `<img src="${oppSpriteUrl}" alt="${oppMon.name}" style="width:64px">` : ''}
    <div class="log-entry">You: ${playerMon.name} — ${Math.round((playerMon.currentHp / playerMon.stats.hp) * 100)}%</div>
    ${playerSpriteUrl ? `<img src="${playerSpriteUrl}" alt="${playerMon.name}" style="width:64px">` : ''}
  `;
}
```

### main.ts wiring pattern

```typescript
// Source: src/main.ts — after DataLoader.validate()
import { ScreenController } from './screens/ScreenController.js';

// After glass.connect() and DataLoader.validate():
const screen = new ScreenController(glass);
await screen.init(); // Shows main menu

glass.onGesture((event) => {
  void screen.handleGesture(event);
});
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Manual cursor tracking on every scroll | `isItemSelectBorderEn: 1` — firmware tracks selection | Avoids unnecessary rebuilds; gestures are boundary-only |
| `createStartUpPageContainer` every time | First call: `createStartUpPageContainer`; subsequent: `rebuildPageContainer` | GlassAdapter already handles this automatically — no code change needed |
| Text flash on every update | `textContainerUpgrade` for in-place updates | Already in GlassAdapter as `updateText()` — use it for HP changes on Battle HUD |

**Not applicable:**
- There is no "Gen 9 sprite directory" on the Showdown CDN — use PokeAPI sprites (`raw.githubusercontent.com`) or gen5 Showdown sprites which cover up to gen 9 (Showdown adds newer sprites to gen5 directory by convention).

---

## Open Questions

1. **Showdown CDN species slug format for Gen 9 forms**
   - What we know: Showdown sprite URL format is `play.pokemonshowdown.com/sprites/gen5/{slug}.png`; slug is species name lowercased with hyphens. `BattlePokemon.species` already contains the Showdown forme name (e.g., `"gastrodon-east"`).
   - What's unclear: Not all Gen 9 Pokemon have sprites in the Showdown gen5 directory. The gen5 directory was last visibly updated for older gens.
   - Recommendation: Use PokeAPI raw CDN by dex number (`num` from `DataLoader.getPokemon()`) as the primary sprite source. It is more reliably complete. Fall back to a placeholder text "?" if `num` is not found. Sprites on the phone are a nice-to-have (UI-10), not a core requirement.

2. **Forced switch when BOTH sides fainted simultaneously**
   - What we know: `BattleEngine.submitSwitch()` checks `phase === 'WAITING_FOR_SWITCH'` and handles both sides needing a switch. When the player switches in after a double faint, the opponent side (AI) auto-switches via `AIOpponent.pickAction()` — but `pickAction()` expects `WAITING_FOR_ACTION` phase, not `WAITING_FOR_SWITCH`.
   - What's unclear: The current `AIOpponent.pickAction()` does not handle forced switch scenarios — it only returns `PlayerAction` for `WAITING_FOR_ACTION`. There is no `AIOpponent.pickSwitch()` or forced-switch logic.
   - Recommendation: In `ScreenController`, when `state.phase === 'WAITING_FOR_SWITCH'`, check if the opponent's active Pokemon is also fainted. If so, auto-pick the opponent's first alive Pokemon at a non-active index and call `BattleEngine.submitSwitch(state, 'opponent', index)` before showing the player the switch screen. This is the correct behavior and keeps `AIOpponent` pure.

3. **Turn result display duration**
   - What we know: UI-07 requires showing what happened after each turn. There is no timer API in the SDK.
   - What's unclear: Should the turn result screen wait for a TAP before advancing, or auto-advance after N seconds?
   - Recommendation: Require a TAP to advance from the turn result screen. This is simpler, gives players time to read, and avoids needing `setTimeout` logic. The status bar should say "Tap to continue."

---

## Sources

### Primary (HIGH confidence)
- Codebase: `src/adapters/glassAdapter.ts` — Full SDK API in use; all methods, event mapping, and known quirks documented in comments
- Codebase: `src/types/battleState.ts` — All state types that renderers read
- Codebase: `src/types/contracts.ts` — `GlassAdapter` interface, `GestureEvent` type
- Codebase: `src/config/constants.ts` — Hardware pixel dimensions (576×288), layout constants
- Codebase: `src/battle/BattleEngine.ts` — `submitAction()`, `submitSwitch()` signatures and phase transitions
- Codebase: `src/battle/AIOpponent.ts` — `pickAction(state)` signature and behavior
- SDK source: `node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts` — `ListContainerProperty`, `TextContainerProperty`, `OsEventTypeList` enum values

### Secondary (MEDIUM confidence)
- [Nick Ustinov G2 Notes](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) — Boundary scroll behavior, 1000/2000 char limits, monospaced vs proportional font note
- [PokeAPI Sprites GitHub](https://github.com/PokeAPI/sprites) — `raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{id}.png` CDN format
- [Showdown Sprites CDN](https://play.pokemonshowdown.com/sprites/) — `gen5` directory as standard sprite source; no gen9-specific directory

### Tertiary (LOW confidence)
- WebSearch: Showdown gen5 sprite directory covers all species including gen 9 additions — not independently verified; PokeAPI CDN is more reliable and recommended

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All tools already in codebase; no external dependencies needed
- Architecture: HIGH — Derived from existing codebase patterns (GlassAdapter methods, BattleEngine API), SDK type definitions, and requirements
- Pitfalls: HIGH (scroll boundary behavior) / MEDIUM (sprite CDN completeness)

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (SDK is at 0.0.7; stable for 30 days)
