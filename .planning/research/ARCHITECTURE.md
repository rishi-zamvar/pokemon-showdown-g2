# Architecture Research

**Domain:** Turn-based Pokemon battle simulator on constrained text-only display (G2 smart glasses)
**Researched:** 2026-02-26
**Confidence:** HIGH (existing adapter code is authoritative; battle engine patterns from established game dev literature; G2 constraints verified from live codebase)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          INPUT LAYER                                         │
│  G2 Glasses Hardware → Even Hub SDK → GlassAdapterImpl.onGesture()          │
│  Events: SCROLL_FWD | SCROLL_BACK | TAP(listIndex) | FOREGROUND_ENTER/EXIT  │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │ GestureEvent
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CONTROLLER LAYER  (src/main.ts)                       │
│  Routes gesture → active screen handler                                      │
│  Owns: currentScreen ref, delegates to screen's handleGesture()              │
└──────────────┬──────────────────────────────────────────────┬───────────────┘
               │ action intent (e.g. "use move 2")            │ render call
               ▼                                              ▼
┌──────────────────────────┐           ┌────────────────────────────────────────┐
│     BATTLE ENGINE        │           │         UI / SCREEN LAYER              │
│  src/battle/             │           │  src/screens/                          │
│                          │           │                                        │
│  BattleEngine            │           │  MainMenuScreen                        │
│  - BattleState (FSM)     │◄──────────│  BattleHUDScreen                       │
│  - turn resolution       │ state     │  MoveSelectScreen                      │
│  - damage calc           │ read      │  SwitchScreen                          │
│  - AI decision           │           │  TeraScreen                            │
│  - win/loss detection    │           │  BattleEndScreen                       │
│                          │           │                                        │
│  Pure functions, no      │           │  Each screen: format text → call       │
│  display knowledge       │           │  glass.showList / showText /           │
└──────────────────────────┘           │  updateText                            │
               ▲                       └────────────────────────────────────────┘
               │ load once at startup                         ▲
┌──────────────────────────┐                                  │ formatted strings
│      DATA LAYER          │           ┌────────────────────────────────────────┐
│  src/data/               │           │       GLASS ADAPTER  (existing)        │
│                          │◄──────────│  GlassAdapterImpl                      │
│  DataLoader (singleton)  │ raw JSON  │  showList(items[], statusText)          │
│  pokedex.json            │           │  showText(text, {left, right})          │
│  moves.json              │           │  updateText(text, {left, right})        │
│  learnsets.json          │           │  showMessage(text)                      │
│  typechart.json          │           │  onGesture(handler)                    │
│  abilities.json          │           └────────────────────────────────────────┘
│  items.json              │
└──────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|------------------------|
| GlassAdapterImpl | Hardware bridge: translate G2 events to GestureEvents, render containers to display | Even Hub SDK only |
| Controller (main.ts) | Boot sequence, wires glass to app, routes gestures to active screen | GlassAdapter, all screens |
| BattleEngine | Battle FSM: resolve turns, calculate damage, run AI, track win/loss | DataLoader (read-only) |
| Screens (MainMenu, BattleHUD, MoveSelect, Switch, Tera, BattleEnd) | Format battle state as text/list strings, call GlassAdapter display methods | GlassAdapter (write), BattleEngine (read) |
| DataLoader | Load and index JSON data files once at startup, expose typed query methods | Nothing (source of truth) |
| TeamGenerator | Build random legal 6-Pokemon teams using Showdown data | DataLoader |

---

## Recommended Project Structure

```
src/
├── adapters/
│   └── glassAdapter.ts           # Existing — do not modify
├── battle/
│   ├── BattleEngine.ts           # Core FSM + turn resolution
│   ├── DamageCalc.ts             # Damage formula (pure functions)
│   ├── AI.ts                     # AI move selection
│   ├── TeamGenerator.ts          # Random team builder
│   └── types.ts                  # BattleState, Pokemon, Side, Move types
├── config/
│   └── constants.ts              # Existing — add BATTLE_TIMING if needed
├── data/
│   ├── DataLoader.ts             # Singleton loader + typed accessors
│   ├── pokedex.json              # Existing
│   ├── moves.json                # Existing
│   ├── learnsets.json            # Existing
│   ├── typechart.json            # Existing
│   ├── abilities.json            # Existing
│   ├── items.json                # Existing
│   └── sprites/                  # Existing PNG files
├── screens/
│   ├── BaseScreen.ts             # Interface: handleGesture(e), render(state)
│   ├── MainMenuScreen.ts         # Entry point, "Enter Battle" list
│   ├── BattleHUDScreen.ts        # Main battle view (both Pokemon, HP%, options list)
│   ├── MoveSelectScreen.ts       # 4-move list screen
│   ├── SwitchScreen.ts           # 6-Pokemon team list
│   ├── TeraScreen.ts             # Tera confirm (Yes/No list)
│   └── BattleEndScreen.ts        # Win/loss result text
├── services/
│   └── wakeLockService.ts        # Existing
├── types/
│   └── contracts.ts              # Existing — add GameScreen interface here
└── main.ts                       # Bootstrap, wire-up, gesture router
```

### Structure Rationale

- **battle/:** Completely isolated from display. Pure TypeScript functions. Can be unit tested without glasses connected.
- **screens/:** One file per distinct display state. Each screen owns its own rendering logic. Screens are dumb — they read BattleState, produce strings, call GlassAdapter.
- **data/:** DataLoader is the only file that imports JSON. Everything else goes through typed accessors. Prevents raw JSON spread throughout codebase.
- **adapters/:** Untouched. The existing GlassAdapterImpl already encapsulates all G2 quirks.

---

## Architectural Patterns

### Pattern 1: Finite State Machine for Battle Screens (Pushdown Automaton Variant)

**What:** The controller holds a stack of screens. TAP pushes a new screen (e.g., MoveSelect), double-tap pops back to the previous screen (e.g., BattleHUD). Each screen handles its own gesture routing.

**When to use:** Any time user navigates into a sub-menu and needs to return. Avoids duplicating "go back" logic in every screen.

**Trade-offs:**
- Pro: Back navigation is automatic — just `screenStack.pop()` + re-render.
- Pro: Each screen is isolated and independently testable.
- Con: Shared mutable state (BattleState) must be passed carefully — screens read it, only BattleEngine writes it.

**Example:**
```typescript
// Controller fragment (main.ts)
const screenStack: GameScreen[] = [new MainMenuScreen()];

glass.onGesture((gesture) => {
  const current = screenStack[screenStack.length - 1];

  if (gesture.kind === "TAP" && gesture.listIndex === undefined) {
    // double-tap detected as back intent
    if (screenStack.length > 1) {
      screenStack.pop();
      screenStack[screenStack.length - 1].render(battleState, glass);
    }
    return;
  }

  const next = current.handleGesture(gesture, battleState);
  if (next) {
    screenStack.push(next);
    next.render(battleState, glass);
  } else {
    current.render(battleState, glass);
  }
});
```

### Pattern 2: BattleState as Immutable-ish Value Object

**What:** BattleState is a single plain object describing the full game state: both sides, active Pokemon, HP values, whose turn it is, FSM phase. BattleEngine takes BattleState and an action, returns a new BattleState.

**When to use:** Every turn resolution. Screens read BattleState but never mutate it. Only BattleEngine produces new states.

**Trade-offs:**
- Pro: Screens are side-effect free — they can re-render safely at any time.
- Pro: Debugging is easy — log BattleState before/after each action.
- Con: Slight overhead cloning state; irrelevant at this scale.

**Example:**
```typescript
// src/battle/types.ts
export type BattlePhase =
  | "PLAYER_CHOOSING"    // Waiting for player action
  | "RESOLVING_TURN"     // Executing moves
  | "PLAYER_SWITCH"      // Forced switch after faint
  | "GAME_OVER";

export interface BattleState {
  phase: BattlePhase;
  playerSide: Side;
  aiSide: Side;
  turnNumber: number;
  log: string[];         // battle messages for HUD display
}

export interface Side {
  team: BattlePokemon[];
  activeIndex: number;   // index into team[]
}

export interface BattlePokemon {
  speciesId: string;     // key into pokedex.json
  name: string;
  currentHp: number;
  maxHp: number;
  moves: BattleMove[];
  teraUsed: boolean;
  fainted: boolean;
}
```

### Pattern 3: Screen Interface (Uniform Contract)

**What:** Every screen implements `render(state: BattleState, glass: GlassAdapter): Promise<void>` and `handleGesture(gesture: GestureEvent, state: BattleState): GameScreen | null`. Controller calls these two methods — that's the entire contract.

**When to use:** Always. Every screen behind this interface.

**Trade-offs:**
- Pro: Controller never needs to know what screen is active. Just routes gestures and calls render.
- Pro: New screens (e.g., TeraScreen) are isolated additions.
- Con: Screens that need to trigger BattleEngine must receive it as a dependency.

**Example:**
```typescript
// src/types/contracts.ts addition
export interface GameScreen {
  render(state: BattleState, glass: GlassAdapter): Promise<void>;
  handleGesture(
    gesture: GestureEvent,
    state: BattleState
  ): GameScreen | null; // null = stay on current screen
}
```

### Pattern 4: DataLoader Singleton with Lazy Indexing

**What:** DataLoader loads all JSON files once at startup. It builds in-memory lookup maps (e.g., `movesById: Map<string, MoveData>`) so lookups during battle are O(1) instead of O(n) object key lookups on large JSON blobs.

**When to use:** At startup before battle begins. Data never changes during a session.

**Trade-offs:**
- Pro: learnsets.json is 3MB — a flat scan per-lookup is expensive. Index once, query fast.
- Con: Startup takes a moment to index. Acceptable for a single-player app.

**Example:**
```typescript
// src/data/DataLoader.ts
class DataLoader {
  private static instance: DataLoader;
  private movesById = new Map<string, MoveData>();

  static async load(): Promise<DataLoader> { ... }

  getMove(id: string): MoveData | undefined {
    return this.movesById.get(id.toLowerCase());
  }
}
```

---

## Data Flow

### Game Loop: Gesture to Render

```
User gesture on G2 glasses
    ↓
EvenHubEvent (Even Hub SDK)
    ↓
GlassAdapterImpl.mapEventToGesture()
    ↓
GestureEvent { kind, listIndex? }
    ↓
Controller gesture handler (main.ts)
    ↓
screenStack.top().handleGesture(gesture, battleState)
    ↓
[If action chosen] BattleEngine.submitAction(battleState, action)
    ↓
New BattleState (damage applied, HP updated, phase advanced)
    ↓
[If phase = PLAYER_CHOOSING] MoveSelectScreen / BattleHUDScreen
[If phase = PLAYER_SWITCH]   SwitchScreen
[If phase = GAME_OVER]       BattleEndScreen
    ↓
screen.render(battleState, glass)
    ↓
glass.showList(items, statusText) OR glass.showText(text, status) OR glass.updateText(...)
    ↓
G2 display updated
```

### Screen State Map

```
[MAIN MENU]
    TAP "Enter Battle"
         ↓
[BATTLE HUD]  ←─────────────────────────────────┐
    shows: playerPokemon vs aiPokemon, HP%       │
    options list: ["Fight", "Switch", "Tera"]    │
                                                 │
    TAP "Fight"         TAP "Switch"    TAP "Tera"
         ↓                   ↓               ↓
[MOVE SELECT]       [SWITCH SCREEN]   [TERA SCREEN]
 4-move list         6-pokemon list    Yes/No list
    ↓                   ↓               ↓
  action sent         action sent     action sent
         └───────────────┴───────────────┘
                         ↓
              BattleEngine.resolveTurn()
                         ↓
              if game_over → [BATTLE END]
              else        → [BATTLE HUD] (loop)

double-tap from any sub-screen → pop to parent
```

### Key Data Flows

1. **Team generation:** `DataLoader` → `TeamGenerator.buildRandom()` → `BattlePokemon[]` → `BattleState.playerSide / aiSide`
2. **Turn resolution:** `BattleEngine.submitAction(state, playerAction)` → AI picks action → damage calc → HP updates → faint checks → phase advance → new `BattleState`
3. **HUD render:** `BattleHUDScreen.render(state, glass)` → format HP bar string + move list → `glass.showList(moves, hpStatus)` OR `glass.updateText(hud, {left, right})`
4. **Battle log:** Each turn appends to `BattleState.log: string[]`. HUD screen shows last N log entries as text content, truncated to fit 1000-char limit.

---

## G2 Display Constraint Mapping

### How Battle UI Maps to G2 APIs

| Battle Screen | G2 API | Layout |
|---------------|--------|--------|
| Main menu | `showList(["Enter Battle", "Settings"], "Pokemon Showdown")` | List container, firmware handles scroll |
| Battle HUD (combat info) | `showText(hudText, {left: "vs AI", right: "Turn 3"})` | Text content, status bar shows turn |
| Move select | `showList(["Tackle", "Flamethrower", ...], "PIKACHU 72%")` | List = moves, status = active Pokemon HP |
| Switch screen | `showList(["Bulbasaur 80%", "Charmander 45%", ...], "Choose Pokemon")` | List = team |
| Tera confirm | `showList(["Yes — Terastallize", "No — Skip"], "Tera Option")` | Minimal list |
| Battle end | `showMessage("You won!\nPikachu swept the team")` | Simple text message |
| Turn log | `updateText(lastTurnText, {left: "Last turn", right: "Turn N"})` | In-place update, no flash |

### Text Formatting Constraints

- **~64 chars per line, ~8 lines visible** at normal font size in 560px wide content area.
- `showText` / `showMessage`: 1000 char hard limit (SDK rebuild limit). Battle HUD text must be compact.
- `updateText`: 2000 char limit. Safe for battle log and dynamic HP updates without rebuilds.
- **Lists are the primary navigation primitive.** The firmware handles scroll and selection highlight automatically. Use lists for any choosable action.
- **Status bar** (28px, below content): Use `left` for context (active Pokemon name + HP) and `right` for progress (turn number, or "FAINTED").
- **No images in text containers.** Sprites are out of scope for G2 display text containers; all battle info is text-only.

### HP Bar Representation

G2 cannot draw graphics. Represent HP with ASCII:
```
PIKACHU  [████████░░]  72%
GENGAR   [███░░░░░░░]  30%
```
A 10-character "bar" with filled blocks (`█`) and empty blocks (`░`) fits well at 64 chars/line.

---

## Anti-Patterns

### Anti-Pattern 1: Mixing Battle Logic with Rendering

**What people do:** Put damage calculation or state mutation inside screen render methods or gesture handlers.

**Why it's wrong:** Makes battle engine untestable without glasses connected. Causes subtle bugs when re-renders re-execute side effects. Creates spaghetti where display code needs to know about type charts.

**Do this instead:** BattleEngine is a pure computation layer. Screens only read BattleState and call GlassAdapter. No data mutation in screens.

### Anti-Pattern 2: Using showText for Every Update

**What people do:** Call `glass.showText()` on every gesture or every HP change.

**Why it's wrong:** `showText` triggers a full `rebuildPageContainer`. This causes visible flash on the G2 display. The adapter already has `updateText` specifically for in-place updates — it calls `textContainerUpgrade` with no rebuild.

**Do this instead:** Use `showText` (or `showList`) only when changing the layout structure (switching between list mode and text mode). Use `updateText` for HP value updates, log line additions, or any content change within the same screen type.

### Anti-Pattern 3: Rebuilding the Screen on Every Scroll

**What people do:** Re-call `showList` in response to SCROLL_FWD / SCROLL_BACK events.

**Why it's wrong:** The G2 firmware handles list scrolling internally. The adapter's 300ms cooldown exists precisely to prevent double-fires, but `showList` should only be called when the list content changes, not when the user scrolls.

**Do this instead:** Only call `showList` on initial screen enter or when list items change. Let the firmware scroll the existing list. Only re-render on TAP (selection).

### Anti-Pattern 4: Loading JSON Inside Battle Functions

**What people do:** `import movesData from '../data/moves.json'` directly inside `DamageCalc.ts` or similar.

**Why it's wrong:** learnsets.json alone is 3MB. Ad-hoc object key lookups in hot paths during turn resolution are slow. Multiple files importing raw JSON creates multiple parse/parse cycles.

**Do this instead:** DataLoader is the single entry point for all game data. It loads once at startup and provides O(1) typed accessors. Battle functions receive DataLoader as a dependency.

### Anti-Pattern 5: Flat State Object with Boolean Flags

**What people do:** Track battle phase with multiple booleans (`isPlayerTurn`, `isChoosingSwitch`, `isGameOver`).

**Why it's wrong:** Boolean soup creates illegal state combinations. With 5 booleans you have 32 possible states but only ~6 valid ones. Logic becomes a jungle of `if (!isPlayerTurn && !isChoosingSwitch && !isGameOver)`.

**Do this instead:** Single `BattlePhase` discriminated union. TypeScript exhaustive checks at compile time catch missing cases. Exactly one phase active at a time.

---

## Build Order (Phase Dependencies)

This ordering reflects the dependency graph — nothing higher can be built until what it depends on exists.

```
Phase 1: DataLoader + Types
  └─ All other phases depend on this

Phase 2: TeamGenerator
  └─ Depends on: DataLoader (pokedex, learnsets)
  └─ Required for: BattleEngine (needs teams to initialize)

Phase 3: BattleEngine core (state machine + damage calc)
  └─ Depends on: DataLoader, TeamGenerator, BattleState types
  └─ Required for: any screen that shows live battle data

Phase 4: BattleHUD + MoveSelect screens
  └─ Depends on: BattleEngine, GlassAdapter (existing)
  └─ First playable milestone: player can pick moves, see HP

Phase 5: Switch screen + Tera screen
  └─ Depends on: BattleEngine (switch/tera actions), BattleHUD

Phase 6: AI + full turn loop
  └─ Depends on: full BattleEngine, all screens
  └─ Enables: unassisted complete battles

Phase 7: Main Menu + Battle End screens
  └─ Depends on: everything above
  └─ Completes: full app flow from launch to end
```

**Critical dependency:** BattleEngine must be purely functional (no glass calls) before screens are built. If screens and engine are developed simultaneously with coupling, testing becomes impossible without hardware.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Screens ↔ GlassAdapter | Method calls only: showList/showText/updateText | Screens must not access bridge or SDK directly |
| Screens ↔ BattleEngine | Read BattleState (passed in); submit actions via engine method | Screens never mutate BattleState directly |
| BattleEngine ↔ DataLoader | DataLoader injected at engine construction; engine calls typed accessors | DataLoader is read-only from engine's perspective |
| Controller ↔ Screens | Gesture event delegation; screen push/pop | Controller holds screenStack, delegates all behavior |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Even Hub SDK | Wrapped entirely by GlassAdapterImpl (existing) | No other code touches SDK types |
| W3C Wake Lock API | Wrapped by WakeLockServiceImpl (existing) | Acquire on battle start, release on end |
| Pokemon Showdown JSON data | Loaded by DataLoader from src/data/ at startup | Already downloaded; no network calls needed |

---

## Scaling Considerations

This is a single-player local app — scalability in the traditional sense is irrelevant. The relevant scaling concerns are:

| Concern | Constraint | Approach |
|---------|-----------|---------|
| JSON data size | learnsets.json is 3MB | Index into Map<> at startup; O(1) lookups during battle |
| Text content size | G2 SDK: 1000 char rebuild / 2000 char update | Format strings to stay under limits; truncate log |
| Screen transition latency | rebuildPageContainer has ~300ms observed latency | Minimize full rebuilds; use updateText for HP changes |
| Gesture debounce | Scroll fires rapidly; 300ms cooldown already in adapter | Never re-render on scroll events; only on TAP |

---

## Sources

- Existing `src/adapters/glassAdapter.ts` — authoritative source for G2 API capabilities and limits (HIGH confidence)
- Existing `src/config/constants.ts` — display dimensions, timing (HIGH confidence)
- Existing `.planning/codebase/ARCHITECTURE.md` — codebase analysis (HIGH confidence)
- Game Programming Patterns — State chapter: https://gameprogrammingpatterns.com/state.html (HIGH confidence, canonical game dev reference)
- smogon/pokemon-showdown GitHub — battle engine architecture reference: https://github.com/smogon/pokemon-showdown (MEDIUM confidence — reviewed architecture overview only)
- pkmn/engine GitHub — alternative battle engine: https://github.com/pkmn/engine (MEDIUM confidence — confirmed TypeScript driver pattern)

---
*Architecture research for: Pokemon Showdown on G2 glasses — battle simulator integration*
*Researched: 2026-02-26*
