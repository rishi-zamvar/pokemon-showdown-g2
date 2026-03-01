# Architecture Patterns: v1.1 UI Enhancement Integration

**Project:** Pokemon Showdown G2 — Milestone v1.1 UI Enhancement & Polish
**Researched:** 2026-03-01
**Confidence:** HIGH — based on direct code inspection of all existing source files

---

## Existing Architecture (As Built)

Before documenting integration patterns, this section maps what currently exists in code — not documentation, not aspirations.

### Current Component Map

```
src/
├── adapters/glassAdapter.ts     — GlassAdapterImpl: SDK bridge, event mapping, container rendering
├── animation/
│   ├── AnimationEngine.ts       — Async sequencer: typewriter, sprite flash, HP drain, switch slide
│   ├── AnimationFrames.ts       — Pokeball/square/checkbox BMP frame generators (lazily cached)
│   └── SpriteEffects.ts         — invertSprite(), blankSprite()
├── battle/
│   ├── SimBattleAdapter.ts      — Wraps @pkmn/sim Battle instance; startBattle/submitAction/submitSwitch
│   ├── SimAIOpponent.ts         — Random-legal AI using sim request/choice protocol
│   ├── LogParser.ts             — Converts @pkmn/sim protocol lines to TurnLogEntry[]
│   └── [legacy: BattleEngine, AIOpponent, DamageCalc, etc. — not imported, inert]
├── config/constants.ts          — GLASS_LAYOUT, CONTAINER_IDS, ANIM, DISPLAY_BUDGET constants
├── data/DataLoader.ts           — Singleton: pokedex, moves, match-scoped data, O(1) accessors
├── screens/
│   ├── ScreenController.ts      — State machine: owns ScreenState, routes gestures, calls renderers
│   ├── ScreenState.ts           — ScreenName union, ScreenState shape, renderer return types
│   └── renderers/
│       ├── battleHudRenderer.ts     — Returns BattleHudScreen (oppText, playerText, sprites)
│       ├── attackSelectRenderer.ts  — Returns ListScreen (move list with PP)
│       ├── switchSelectRenderer.ts  — Returns SwitchListScreen (team list + indexMap)
│       ├── actionMenuRenderer.ts    — Returns ListScreen (Attack / Switch / Tera)
│       ├── teraConfirmRenderer.ts   — Returns ListScreen (confirm tera)
│       ├── turnResultRenderer.ts    — Returns TextScreen + exports formatEntry()
│       ├── mainMenuRenderer.ts      — Returns ListScreen
│       ├── endScreenRenderer.ts     — Returns ListScreen
│       └── spriteRefreshRenderer.ts — Returns ListScreen
├── sprites/
│   ├── SpriteService.ts         — Fetch, encode, cache front/back BMP sprites keyed by dex number
│   └── SpriteBmpEncoder.ts      — encodeBmp(): pixel array to 1-bit BMP Uint8Array
├── services/wakeLockService.ts  — Screen wake lock (best-effort)
├── types/
│   ├── battleState.ts           — BattlePhase, ActivePokemon, BattleState, TurnLogEntry (35+ kinds)
│   ├── battle.ts                — BattlePokemon (team generation output)
│   ├── contracts.ts             — GlassAdapter interface, GestureEvent, StatusBar
│   └── pokemon.ts               — Base Pokemon types
└── main.ts                      — Bootstrap, connect, register gesture handler → ScreenController
```

### Current Screen State Machine

```
ScreenName union (ScreenState.ts):
  MAIN_MENU | BATTLE_HUD | ACTION_MENU | ATTACK_SELECT | SWITCH_SELECT
  TERA_CONFIRM | TURN_RESULT | END_SCREEN | SPRITE_REFRESH | ANIMATING
```

**Navigation graph (as implemented in ScreenController.onTap):**
```
MAIN_MENU
    ↓ tap "Enter Battle"
BATTLE_HUD  ←─────────────────────────────────────────────────────┐
    ↓ any tap                                                      │
ACTION_MENU  (full-screen list: < Back / Attack / Switch / Tera)   │
    ├── tap "Attack"   → ATTACK_SELECT (full-screen list)           │
    │       ↓ move selected → resolveTurn() → ANIMATING → ──────────┤
    ├── tap "Switch"   → SWITCH_SELECT (full-screen list)           │
    │       ↓ switch selected → resolveTurn() → ANIMATING → ────────┤
    └── tap "Tera"     → TERA_CONFIRM → ATTACK_SELECT               │
            ↓ attack selected → resolveTurn() → ANIMATING → ────────┘
                                                    ↓ BATTLE_OVER
                                               END_SCREEN
TURN_RESULT is defined in ScreenName but NOT currently used —
resolveTurn() transitions through ANIMATING directly to BATTLE_HUD.
```

### Current GlassAdapter Interface

```typescript
interface GlassAdapter {
  connect(): Promise<void>;
  bootstrapStartup(): Promise<void>;
  onGesture(handler: (event: GestureEvent) => void): Unsubscribe;

  // Full-rebuild calls (trigger rebuildPageContainer — visible flash, ~300ms latency)
  showList(items: string[], statusText: string): Promise<void>;
  showText(text: string, status: StatusBar): Promise<void>;
  showMessage(text: string): Promise<void>;
  showBattleHud(oppText, playerText, status, oppSprite?, playerSprite?): Promise<void>;

  // In-place update calls (textContainerUpgrade / updateImageRawData — no flash)
  updateText(text: string, status: StatusBar): Promise<void>;
  updateImage(containerID: number, containerName: string, bmpData: Uint8Array): Promise<void>;
}
```

**Critical SDK constraint:** The G2 SDK has a hard limit of 4 containers per page. Current showBattleHud uses up to 4: oppSprite (image), playerSprite (image), content (text), status (text). There is NO room for additional containers without dropping one.

### Current AnimationEngine Behavior

During `playTurn()`, the engine uses `updateText()` (not `showText()`) to update the content container in-place, and `updateImage()` to update sprite containers in-place. This means:

- Text display during animation: plain `updateText()` call — content appears as flat text, no box border
- HP bar appears in the status bar LEFT field via `updateText(..., { left: hpStatus, right: '' })`
- Pokemon movement: currently limited to a 2-3px sprite slide on switch-in via `shiftSpriteBmp()`

### What the Current BATTLE_HUD Screen Looks Like

```
[oppText block — top half]
  "Foe: Charizard (Fire)
   [██████░░░░] 63%"

[playerText block — bottom half]
  "You: Blastoise
   [████████░░] 87%"

[status bar]
  "Turn 4"    "Tap for menu"
```

The two text blocks are rendered as one combined text in a single container (`oppText + '\n\n' + playerText`).

---

## New Features: Integration Analysis

### Feature 1: Consolidated Battle Menus (Attack/Switch/Tera on BATTLE_HUD)

**Current behavior:** Tap BATTLE_HUD → navigate to ACTION_MENU (full-screen replacement). Attack/Switch/Tera are a separate screen.

**Desired behavior:** BATTLE_HUD itself shows Attack/Switch/Tera as selectable items while HP bars and sprites stay visible.

**Architectural challenge:** BATTLE_HUD currently uses `showBattleHud()` which renders a TEXT container for content + IMAGE containers for sprites + a status bar. The G2 SDK only supports LIST containers for selectable items. You cannot have a list AND image containers simultaneously — they use the same container slots.

**Integration approach — Option A: Hybrid HUD List (Recommended)**

Replace `showBattleHud()` with a new `showBattleHudList()` GlassAdapter method that renders battle info as list items. List items can contain the HP text inline, and the actions appear at the bottom of the same list.

```
List items:
  "Foe: Charizard [██████░░] 63%"    ← non-selectable informational item
  "You: Blastoise [████████] 87%"    ← non-selectable informational item
  "--- ACTIONS ---"                  ← separator (non-selectable)
  "Attack"                           ← selectable
  "Switch"                           ← selectable
  "Terastallize"                     ← selectable
```

This works because the G2 SDK's list container can show multiple items without sprites but avoids the separate ACTION_MENU screen entirely. The player sees battle state + actions in one view.

**Trade-off:** Sprites disappear from BATTLE_HUD when in this consolidated list mode. If sprites are important to the BATTLE_HUD, keep the current two-screen approach and only merge ACTION_MENU content into the HUD prompt.

**Integration point:** `ScreenController` — remove `ACTION_MENU` screen state (or keep it as fallback), modify `BATTLE_HUD` tap handler to show list instead of transitioning. Modify `battleHudRenderer.ts` to return a `ListScreen` when in "menu mode." Or add a `renderBattleHudMenu()` renderer that returns a combined list.

**Component changes:**
- MODIFY: `battleHudRenderer.ts` — add `renderBattleHudMenu()` export returning `ListScreen`
- MODIFY: `ScreenController.ts` — `BATTLE_HUD` tap handler renders the combined list, maps indices to actions
- MODIFY: `ScreenState.ts` — `ACTION_MENU` becomes optional/unused; may keep for forced-switch flows
- NO CHANGE: `GlassAdapter` — `showList()` is already sufficient

**Integration approach — Option B: Keep Two Screens, Improve Transition**

Keep the current `ACTION_MENU` screen but use `showList()` without wiping the glass state first. This is simpler but does not achieve "keep HP bars visible during menu" because switching from `showBattleHud` (image+text mode) to `showList` (list mode) requires a full rebuild regardless.

**Recommendation:** Option A is architecturally cleaner and achieves the UX goal. The loss of sprites during the combined menu view is acceptable — sprites are visible on `BATTLE_HUD` between turns.

---

### Feature 2: Attack/Switch Screens Keep HP Bars and Sprites Visible

**Current behavior:** `ATTACK_SELECT` calls `glass.showList()` — full rebuild, sprites gone.

**Desired behavior:** Attack list appears while opponent/player sprites and HP bars remain visible.

**Architectural challenge:** Same 4-container limit. `showBattleHud()` uses image containers for sprites. `showList()` uses a list container. You cannot have both simultaneously unless you give up one image slot.

**Integration approach — Overlay List (Recommended)**

Add a new GlassAdapter method `showBattleHudWithList()` that combines:
- 2 image containers (oppSprite, playerSprite) — reused from previous `showBattleHud()` call
- 1 list container for the move/switch items
- 1 text container for status bar

This is exactly 4 containers, which is the SDK maximum. The sprite containers persist across the transition from BATTLE_HUD to ATTACK_SELECT because they use the same container IDs.

```typescript
// New GlassAdapter method
async showBattleHudWithList(
  items: string[],
  statusText: string,
  oppSprite?: Uint8Array,
  playerSprite?: Uint8Array,
): Promise<void>
```

The layout would be:
```
[Top-right: opp sprite 96x96]    [Top-left: blank or opp HP text]
[Bottom-left: player sprite]     [Bottom-right: blank or player HP text]
[Scrollable list: move options]
```

Since the G2 display is 576x288, the sprite containers sit at fixed positions in the corners, and the list container occupies the central region. This requires careful `xPosition`/`yPosition` tuning in the SDK container layout.

**Integration point:**
- ADD: `showBattleHudWithList()` to `GlassAdapterImpl` and `GlassAdapter` interface
- ADD: `renderAttackSelectHud()` to `attackSelectRenderer.ts` returning a new `BattleHudListScreen` type
- ADD: `BattleHudListScreen` to `ScreenState.ts`
- MODIFY: `ScreenController.ts` render dispatch for `ATTACK_SELECT` and `SWITCH_SELECT` to call the new method
- NO CHANGE: `SimBattleAdapter`, `AnimationEngine`, battle state types

**Risk:** The 4-container limit is hard. If the SDK refuses a configuration with 2 images + 1 list + 1 text (total 4), this feature is blocked. This must be verified on hardware before committing to this approach.

**Fallback:** If `showBattleHudWithList()` is not feasible, use a text-only HUD display in the status bar during ATTACK_SELECT. The status bar (`left: "Foe 63% | You 87%"`) can show compressed HP info without sprites, which is less polished but achieves information parity without the container limit problem.

---

### Feature 3: Speed Control Persisted Across Battles

**Current behavior:** No speed control exists. Animation speed is hardcoded in `ANIM` constants in `constants.ts`.

**Desired behavior:** Player can select animation speed (e.g., Fast / Normal / Slow). Setting persists across battles within the same session, ideally across sessions.

**Architectural approach:**

Speed control is a simple scalar that multiplies ANIM timing constants. The cleanest integration:

1. **New module: `src/config/speedConfig.ts`** — mutable singleton holding current speed multiplier and localStorage persistence.

```typescript
// src/config/speedConfig.ts
export type SpeedSetting = 'fast' | 'normal' | 'slow';
const SPEED_MULTIPLIERS: Record<SpeedSetting, number> = {
  fast: 0.4,
  normal: 1.0,
  slow: 2.0,
};
const STORAGE_KEY = 'ps-g2-speed';

let currentSpeed: SpeedSetting = 'normal';

export const SpeedConfig = {
  get(): SpeedSetting { return currentSpeed; },
  set(speed: SpeedSetting): void {
    currentSpeed = speed;
    try { localStorage.setItem(STORAGE_KEY, speed); } catch {}
  },
  load(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as SpeedSetting | null;
      if (stored && stored in SPEED_MULTIPLIERS) currentSpeed = stored;
    } catch {}
  },
  multiplier(): number { return SPEED_MULTIPLIERS[currentSpeed]!; },
};
```

2. **AnimationEngine uses `SpeedConfig.multiplier()`** — replace hardcoded `ANIM.CHAR_DELAY_MS` references with `ANIM.CHAR_DELAY_MS * SpeedConfig.multiplier()`.

3. **Speed selection screen** — Either a new `SPEED_SELECT` screen in `ScreenName`, or a settings sub-screen accessible from `MAIN_MENU`. Renders as a `ListScreen` via a new `speedSelectRenderer.ts`.

4. **ScreenController wires the new screen** — `MAIN_MENU` gets a "Settings" item; tapping it transitions to `SPEED_SELECT`.

**Integration points:**
- ADD: `src/config/speedConfig.ts` (new module, no external dependencies)
- ADD: `src/screens/renderers/speedSelectRenderer.ts` (new renderer)
- MODIFY: `ScreenState.ts` — add `SPEED_SELECT` to `ScreenName`
- MODIFY: `ScreenController.ts` — add `SPEED_SELECT` handler, add "Settings" to main menu
- MODIFY: `AnimationEngine.ts` — import `SpeedConfig`, apply multiplier to all delay calls
- MODIFY: `main.ts` — call `SpeedConfig.load()` during bootstrap
- NO CHANGE: `GlassAdapter`, `SimBattleAdapter`, renderers

**Data persistence:** `localStorage` works in Even App WebView. The storage key `ps-g2-speed` survives page reloads and between sessions.

---

### Feature 4: Stats Screen

**Current behavior:** No stats screen. Player cannot view detailed Pokemon info during battle.

**Desired behavior:** New screen shows the active Pokemon's stats (HP, Atk, Def, SpAtk, SpDef, Spe), moves with types and PP, and status.

**Architectural approach:**

This is a new `ScreenName` + renderer + handler triple.

```typescript
// New ScreenName value
type ScreenName = ... | 'STATS_SCREEN';

// New renderer: src/screens/renderers/statsRenderer.ts
export function renderStats(state: BattleState, side: 'player' | 'opponent'): TextScreen {
  const sideData = side === 'player' ? state.playerSide : state.opponentSide;
  const mon = sideData.team[sideData.activeIndex]!;

  const lines = [
    `${mon.name} Lv.${mon.level}`,
    `HP:  ${mon.currentHp}/${mon.stats.hp}`,
    `Atk: ${mon.stats.atk}  Def: ${mon.stats.def}`,
    `SpA: ${mon.stats.spa}  SpD: ${mon.stats.spd}`,
    `Spe: ${mon.stats.spe}`,
    `Tera: ${mon.teraType}${mon.teraActive ? ' (ACTIVE)' : ''}`,
    `Status: ${mon.status || 'none'}`,
    mon.moves.map(m => {
      const mv = DataLoader.getMove(m);
      const pp = Math.max(0, (mv?.pp ?? 0) - (mon.ppUsed[m] ?? 0));
      return `${mv?.name ?? m} ${pp}/${mv?.pp ?? '?'}`;
    }).join(' | '),
  ];

  return {
    text: lines.join('\n').slice(0, DISPLAY_BUDGET.SAFE_CHARS),
    status: { left: 'Stats', right: 'Tap to close' },
  };
}
```

**Navigation:** Stats screen accessible from:
- `ACTION_MENU` or consolidated `BATTLE_HUD` list — add "Stats" as an option
- Tap to close returns to `BATTLE_HUD`

**Integration points:**
- ADD: `src/screens/renderers/statsRenderer.ts`
- MODIFY: `ScreenState.ts` — add `STATS_SCREEN` to `ScreenName`
- MODIFY: `ScreenController.ts` — add `STATS_SCREEN` to render dispatch and tap handler; add "Stats" to action menu or BATTLE_HUD list
- MODIFY: `actionMenuRenderer.ts` — add "Stats" item (or handle in consolidated BATTLE_HUD renderer)
- NO CHANGE: `GlassAdapter`, `AnimationEngine`, `SimBattleAdapter`, battle types

**Display constraint:** Stats screen content must fit within `DISPLAY_BUDGET.SAFE_CHARS` (900 chars). A full stat block with moves fits well within this — test with longest Pokemon names.

---

### Feature 5: Animation Text in a Box (Not Plain Text)

**Current behavior:** During `AnimationEngine.playTurn()`, text is displayed via `glass.updateText()` — plain text update into the existing content container with no visual border.

**Desired behavior:** Animation text appears in a visually distinct "box" — bordered region, like a classic Game Boy dialog box.

**Architectural challenge:** The G2 SDK has no native box/border drawing primitive. All content is text. "Box" must be simulated with ASCII characters.

**Integration approach:**

Add a text formatting layer that wraps animation messages in ASCII box characters:

```typescript
// src/animation/textBox.ts
const BOX_WIDTH = 40; // characters that fit in content area at font size

function formatTextBox(text: string): string {
  const border = '─'.repeat(BOX_WIDTH - 2);
  const lines = wrapText(text, BOX_WIDTH - 4); // 4 = "│ " + " │"
  const boxLines = lines.map(l => `│ ${l.padEnd(BOX_WIDTH - 4)} │`);
  return [`┌${border}┐`, ...boxLines, `└${border}┘`].join('\n');
}

function wrapText(text: string, width: number): string[] { ... }
```

The box wraps the typewriter text. As characters are revealed during the typewriter effect, the box border remains fixed and only the inner content changes.

**Implementation detail:** The typewriter effect in `AnimationEngine.typewriterText()` calls `updateDisplay()` after each character. The box formatter must be applied in the `updateDisplay` callback, not at the full-text level:

```typescript
// Modified typewriterText signature in AnimationEngine
const updateDisplay = async (): Promise<void> => {
  const boxedText = formatTextBox(currentText);
  await glass.updateText(boxedText, { left: hpStatus, right: '' });
};
```

**Character budget concern:** Box borders add characters. A 40-wide box with 3 content lines = 3 × 44 chars + 2 border lines × 42 chars = ~216 chars per box. Well within the 2000-char `updateText` limit. However, if the text box is combined with HP status in the status bar (not in the content container), there is no budget conflict.

**Integration points:**
- ADD: `src/animation/textBox.ts` — `formatTextBox()` utility
- MODIFY: `AnimationEngine.ts` — apply `formatTextBox()` in the `updateDisplay` closure for typewriter and HP drain callbacks
- NO CHANGE: `GlassAdapter`, `ScreenController`, renderers, `SimBattleAdapter`

**Risk:** Box width must be carefully calibrated for G2 font. The G2 display is 576px wide with monospace-ish rendering. Test with actual hardware to confirm characters-per-line.

---

### Feature 6: Pokemon Movement During Attack

**Current behavior:** During `DAMAGE` entries, `spriteFlash()` is called — sprite inverts, blinks, restores. No movement.

**Desired behavior:** When a Pokemon attacks, its sprite moves toward the opponent (lunge) before the damage flash.

**Architectural approach:**

The existing `shiftSpriteBmp()` function in `AnimationEngine.ts` already implements BMP pixel shifting for the switch-in slide. Attack movement reuses this same function.

**New animation primitive:** `attackLunge()` in `AnimationEngine`:

```typescript
private async attackLunge(
  side: Side,         // the attacker
  state: BattleState,
  glass: GlassAdapter,
): Promise<void> {
  const sprite = getSpriteForSide(state, side);
  if (!sprite) return;

  const containerID = side === 'opponent' ? CONTAINER_IDS.oppSprite : CONTAINER_IDS.playerSprite;
  const containerName = side === 'opponent' ? CONTAINER_NAMES.oppSprite : CONTAINER_NAMES.playerSprite;

  // Opponent lunges left (toward player), player lunges right (toward opponent)
  const direction = side === 'opponent' ? -1 : 1;
  const LUNGE_PX = 8; // pixels to shift
  const LUNGE_FRAMES = 3;

  const updateImg = async (data: Uint8Array) =>
    glass.updateImage(containerID, containerName, data);

  // Lunge forward
  for (let i = 1; i <= LUNGE_FRAMES; i++) {
    if (this.cancelled) return;
    const shifted = shiftSpriteBmp(sprite, direction * i * (LUNGE_PX / LUNGE_FRAMES), SPRITE_CONFIG.SIZE);
    await updateImg(shifted);
    await this.delay(ANIM.SWITCH_FRAME_MS);
  }

  // Snap back
  await updateImg(sprite);
}
```

**Integration in `playEntry()`:** For `MOVE_USE` entries, call `attackLunge()` as part of the `tasks` array (concurrent with typewriter):

```typescript
// In playEntry(), MOVE_USE case:
if (entry.kind === 'MOVE_USE') {
  tasks.push(this.attackLunge(entry.actor, prevState, glass));
}
```

**Integration points:**
- MODIFY: `AnimationEngine.ts` — add `attackLunge()` method; call in `playEntry()` for `MOVE_USE` entries
- NO CHANGE: `GlassAdapter`, `ScreenController`, `SpriteBmpEncoder`, `SpriteService`

**Important:** The lunge must use `prevState` (before the turn) so the sprite is the attacker's current form, not the post-turn state (which might be fainted).

---

## Component Boundary Summary

### New Components (ADD)

| Component | File | Role |
|-----------|------|------|
| SpeedConfig | `src/config/speedConfig.ts` | Singleton for animation speed setting + localStorage persistence |
| speedSelectRenderer | `src/screens/renderers/speedSelectRenderer.ts` | Renders speed selection as ListScreen |
| statsRenderer | `src/screens/renderers/statsRenderer.ts` | Renders active Pokemon stats as TextScreen |
| textBox | `src/animation/textBox.ts` | ASCII box formatter for animation dialog text |

### Modified Components (CHANGE)

| Component | File | What Changes |
|-----------|------|-------------|
| ScreenState | `src/screens/ScreenState.ts` | Add `STATS_SCREEN`, `SPEED_SELECT` to `ScreenName`; add `BattleHudListScreen` type |
| ScreenController | `src/screens/ScreenController.ts` | New screen handlers, modified tap routing for consolidated HUD, speed/stats navigation |
| AnimationEngine | `src/animation/AnimationEngine.ts` | Add `attackLunge()`, apply `SpeedConfig.multiplier()` to all delays, apply `formatTextBox()` to `updateDisplay` |
| battleHudRenderer | `src/screens/renderers/battleHudRenderer.ts` | Add `renderBattleHudMenu()` for consolidated HUD+action list |
| attackSelectRenderer | `src/screens/renderers/attackSelectRenderer.ts` | Add `renderAttackSelectHud()` returning `BattleHudListScreen` if overlay feature proceeds |
| switchSelectRenderer | `src/screens/renderers/switchSelectRenderer.ts` | Add `renderSwitchSelectHud()` if overlay feature proceeds |
| actionMenuRenderer | `src/screens/renderers/actionMenuRenderer.ts` | Add "Stats" option; possibly add "Speed" option |
| GlassAdapter interface | `src/types/contracts.ts` | Add `showBattleHudWithList()` if overlay feature proceeds |
| GlassAdapterImpl | `src/adapters/glassAdapter.ts` | Implement `showBattleHudWithList()` if overlay feature proceeds |
| constants.ts | `src/config/constants.ts` | Add animation constants for lunge (LUNGE_PX, LUNGE_FRAMES) |
| main.ts | `src/main.ts` | Call `SpeedConfig.load()` during bootstrap |

### Unchanged Components (NO CHANGE)

| Component | Reason |
|-----------|--------|
| SimBattleAdapter | All features are UI-layer changes; battle logic untouched |
| SimAIOpponent | No battle logic changes |
| LogParser | No new event types needed |
| SpriteService | Sprite fetching/caching unchanged |
| SpriteBmpEncoder | BMP encoding unchanged |
| AnimationFrames | Pokeball/box frames unchanged |
| SpriteEffects | invertSprite/blankSprite unchanged |
| DataLoader | Data access unchanged |
| battleState types | BattleState, ActivePokemon, TurnLogEntry unchanged |

---

## Data Flow Changes

### Current Flow (v1.0)

```
Gesture → ScreenController.onTap()
    ↓ BATTLE_HUD tap
    → transition to ACTION_MENU
    ↓ ACTION_MENU tap "Attack"
    → transition to ATTACK_SELECT
    ↓ move selected
    → resolveTurn() → AnimationEngine.playTurn() → render()
```

### New Flow (v1.1 consolidated HUD)

```
Gesture → ScreenController.onTap()
    ↓ BATTLE_HUD — FIRST tap opens battle action list (inline)
    → renderBattleHudMenu() → glass.showList()
    ↓ BATTLE_HUD — SECOND tap selects action
    → if "Attack" → ATTACK_SELECT
    → if "Switch" → SWITCH_SELECT
    → if "Stats"  → STATS_SCREEN
    → if "Speed"  → SPEED_SELECT (from MAIN_MENU or settings)
    ↓ move selected
    → resolveTurn() → AnimationEngine.playTurn()
        → attackLunge() runs concurrent with typewriter
        → textBox.formatTextBox() wraps animation text
        → SpeedConfig.multiplier() scales all delays
    → render()
```

**State tracking in ScreenController:** The consolidated BATTLE_HUD needs to distinguish "showing HP view" vs "showing action list." Add a boolean flag to `ScreenState` or use a separate `ScreenName` value (`BATTLE_HUD_MENU`). Using a separate `ScreenName` is cleaner — it preserves the existing pattern and tap routing logic.

```typescript
// Option: separate ScreenName for HUD menu state
type ScreenName =
  | 'BATTLE_HUD'           // shows HP bars and sprites — tap to open menu
  | 'BATTLE_HUD_MENU'      // shows inline action list — still on HUD
  | ...
```

---

## Architecture Patterns to Follow

### Pattern 1: Renderer Purity

All renderers are pure functions. They receive state, return a display object, no side effects. New renderers (`statsRenderer`, `speedSelectRenderer`, `renderBattleHudMenu`) must follow this pattern.

```typescript
// Good
export function renderStats(state: BattleState): TextScreen { ... }

// Bad — never do this
export function renderStats(state: BattleState, glass: GlassAdapter) {
  glass.showText(...); // renderer calls glass directly — breaks pattern
}
```

### Pattern 2: ScreenController Owns Transitions

All screen transitions happen in `ScreenController`. Renderers never decide the next screen. Tap handlers in `ScreenController` read the current state and produce the next state.

New tap handlers for `STATS_SCREEN` and `SPEED_SELECT` must follow the existing pattern exactly:

```typescript
case 'STATS_SCREEN':
  await this.handleStatsScreen(idx);
  break;

private async handleStatsScreen(idx: number): Promise<void> {
  // idx 0 = "< Back" or any tap = back
  this.state = { ...this.state, screen: 'BATTLE_HUD', cursorIndex: 0 };
  await this.render();
}
```

### Pattern 3: Immutable State Spread

`ScreenController.state` is always updated via spread. The `battleState` field is never mutated — only replaced when `SimBattleAdapter.submitAction()` returns new state. No new feature should mutate battle state directly.

### Pattern 4: In-Place Updates During Animation

`AnimationEngine` uses `updateText()` and `updateImage()` — never `showText()` or `showBattleHud()` — during a running animation. New animation features (attack lunge, text box) must continue using `updateImage()` and the existing `updateText()` path. No rebuild during animation.

### Pattern 5: SDK Container ID Reuse

All renders use the same container IDs (`CONTAINER_IDS.oppSprite`, `CONTAINER_IDS.playerSprite`, etc.). This is what makes `updateImage()` work without a full rebuild — it targets existing containers by ID. Any new GlassAdapter method must reuse these same IDs consistently.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Adding a 5th Container

The SDK limit is 4 containers per page. Do not attempt to add a separate "text box" container alongside the existing 4. The text box must be implemented as formatted text content within the existing content container via `updateText()`.

### Anti-Pattern 2: Speed Config as Global Mutable Constant

Do not modify `ANIM` constants directly based on speed setting. The `ANIM` constants are `as const` — they are immutable. Speed control must be a multiplier applied at call sites, not a mutation of the constants object.

### Anti-Pattern 3: Stats Data Fetching in Renderer

The stats renderer must use `DataLoader.getMove()` for move display names — the same pattern used by `attackSelectRenderer`. It must NOT call `fetch()`, make network requests, or access `@pkmn/sim` internals. All needed data is already in `ActivePokemon` (stats, moves, ppUsed, teraType, status, volatiles) and `DataLoader`.

### Anti-Pattern 4: Animation in Renderer Functions

Battle animations (lunge, flash) belong in `AnimationEngine`. Renderers are synchronous pure functions that return display objects. Do not add `await` or animation logic to renderer files.

### Anti-Pattern 5: Breaking the TURN_RESULT Removal

The `TURN_RESULT` screen name still exists in `ScreenName` but is no longer used in the main battle flow (resolveTurn goes ANIMATING → BATTLE_HUD directly). Do not resurrect TURN_RESULT for the new features. The animation engine handles all turn result display inline.

---

## Build Order for v1.1 Phases

Based on dependency analysis of the six features:

```
Phase 1: Foundation (no dependencies on each other — build in parallel or either order)
  ├── SpeedConfig module + persistence
  │     Depends on: nothing
  │     Enables: AnimationEngine multiplier, speed selection screen
  │
  └── statsRenderer + STATS_SCREEN screen state
        Depends on: existing ActivePokemon type (already has all needed fields)
        Enables: stats navigation in ScreenController

Phase 2: AnimationEngine enhancements (depends on Phase 1 for SpeedConfig)
  ├── textBox.ts + apply to AnimationEngine typewriter path
  │     Depends on: SpeedConfig (Phase 1, for testing at different speeds)
  │
  └── attackLunge() in AnimationEngine
        Depends on: nothing new (shiftSpriteBmp already exists)
        Can be done before or after textBox

Phase 3: ScreenController wiring (depends on Phase 1 renderers and Phase 2 engines)
  ├── Stats screen: add STATS_SCREEN to ScreenName, add handler, add to ACTION_MENU
  ├── Speed screen: add SPEED_SELECT to ScreenName, add handler, add to MAIN_MENU
  └── Consolidated HUD: add BATTLE_HUD_MENU state, modify tap routing

Phase 4: Overlay HUD (depends on Phase 3, requires hardware verification)
  ├── Verify 2-image + 1-list + 1-text container config on G2 hardware
  ├── If feasible: implement showBattleHudWithList() in GlassAdapterImpl
  └── Wire ATTACK_SELECT and SWITCH_SELECT to use new layout
```

**Why this order:**
- SpeedConfig and statsRenderer have zero dependencies — build them first, test them independently
- AnimationEngine changes are isolated to the animation module — can be built and smoke-tested before wiring
- ScreenController changes (Phase 3) require renderers to exist first — they import and call them
- Overlay HUD (Phase 4) is the highest-risk item (hardware SDK limitation) — defer until everything else works, so the milestone is not blocked if the overlay approach is infeasible

---

## Hardware Constraint Flags

These require on-device verification before the phase plan is locked:

| Constraint | Question | Impact if False |
|------------|----------|-----------------|
| 4-container limit | Does SDK allow 2 image + 1 list + 1 text simultaneously? | Feature 2 (overlay HUD) becomes infeasible; use status-bar HP fallback instead |
| List item non-selectable | Can a list item be rendered but non-selectable (for info rows in consolidated HUD)? | Consolidated HUD must use a different layout — info-only items must not respond to tap |
| ASCII box characters | Do Unicode box-drawing characters (┌┐└┘│─) render correctly on G2 display? | Must fall back to simpler ASCII borders (+, -, \|) |
| localStorage in WebView | Does the G2 Even App WebView expose localStorage? | SpeedConfig persistence degrades to session-only (in-memory only, resets on app open) |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Existing architecture mapping | HIGH | Based on direct code inspection of all source files |
| Speed control integration | HIGH | SpeedConfig + multiplier pattern is straightforward; no SDK interaction |
| Stats screen | HIGH | Pure renderer + new ScreenName — follows existing pattern exactly |
| Text box in animation | HIGH | `updateText()` supports the content; ASCII box chars are standard Unicode |
| Attack lunge animation | HIGH | Reuses `shiftSpriteBmp()` which already works for switch-in slide |
| Consolidated HUD | MEDIUM | Depends on G2 SDK behavior for list-based HUD; needs UX validation |
| Overlay HUD (sprites + list) | LOW | 4-container SDK limit makes this architecturally risky; requires hardware test |

---

*Architecture research for: Pokemon Showdown G2 — v1.1 UI Enhancement milestone*
*Researched: 2026-03-01*
*Based on: direct inspection of ScreenController.ts, AnimationEngine.ts, GlassAdapter.ts, ScreenState.ts, all renderers, constants.ts, and battleState.ts*
