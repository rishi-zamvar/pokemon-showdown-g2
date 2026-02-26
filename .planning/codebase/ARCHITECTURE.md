# Architecture

**Analysis Date:** 2026-02-26

## Pattern Overview

**Overall:** Single-Page Application (SPA) with Hardware Abstraction Layer Pattern

**Key Characteristics:**
- Lightweight client-side application targeting Even Realities G2 smart glasses
- Event-driven gesture recognition and UI rendering pipeline
- Hardware-agnostic adapter pattern for glass display and interaction
- Minimal dependencies: only Even Hub SDK for glass integration
- Static Pokémon data loaded at startup from JSON files

## Layers

**UI Presentation Layer:**
- Purpose: Render content to smart glasses via Even Hub SDK
- Location: `src/adapters/glassAdapter.ts`
- Contains: Container rendering, text/list display, display lifecycle management
- Depends on: Even Hub SDK (`@evenrealities/even_hub_sdk`), configuration constants
- Used by: Application controller in `src/main.ts`

**Gesture & Event Handling Layer:**
- Purpose: Translate hardware events to application gestures
- Location: `src/adapters/glassAdapter.ts` (mapEventToGesture method)
- Contains: Event type mapping, scroll cooldown logic, quirk handling
- Depends on: Even Hub SDK event types
- Used by: Gesture handlers registered via `onGesture()` interface

**Service Layer:**
- Purpose: Provide cross-cutting application services
- Location: `src/services/wakeLockService.ts`
- Contains: Screen wake lock acquisition/release, visibility lifecycle management
- Depends on: W3C Screen Wake Lock API (navigator.wakeLock)
- Used by: Application controller (optional)

**Configuration & Constants Layer:**
- Purpose: Centralize glass layout, timing, and container settings
- Location: `src/config/constants.ts`
- Contains: Display dimensions, container IDs, timing parameters, status bar layout
- Depends on: None
- Used by: glassAdapter, main bootstrap

**Type/Contract Layer:**
- Purpose: Define interfaces and contracts between layers
- Location: `src/types/contracts.ts`
- Contains: GlassAdapter interface, GestureEvent types, StatusBar structure
- Depends on: None
- Used by: glassAdapter, main, any business logic

**Data Layer:**
- Purpose: Static Pokémon game data
- Location: `src/data/` (pokedex.json, moves.json, abilities.json, items.json, learnsets.json, typechart.json, sprites/)
- Contains: Pokémon stats, move definitions, type effectiveness, sprite assets
- Depends on: None
- Used by: Future game logic (not yet implemented)

**Bootstrap/Entry Point Layer:**
- Purpose: Initialize application, establish glass connection, register event handlers
- Location: `src/main.ts`
- Contains: HTML element bindings, glass adapter instantiation, error handling
- Depends on: glassAdapter, wakeLockService, configuration
- Used by: Browser (via index.html script tag)

## Data Flow

**Startup Sequence:**

1. Browser loads `index.html`
2. `src/main.ts` executes on page load
3. `bootstrap()` function initializes:
   - Calls `glass.connect()` → waits for Even Hub SDK bridge
   - SDK waits for connection from Even glasses device
   - Updates UI status indicators (connecting → connected)
4. Registers gesture listener via `glass.onGesture()`
5. Application ready to respond to hardware events

**Gesture Event Flow:**

1. User performs gesture on glasses (scroll, tap, etc.)
2. Even glasses firmware emits `EvenHubEvent` via SDK bridge
3. SDK fires `onEvenHubEvent` callback in glassAdapter
4. `mapEventToGesture()` translates raw SDK event to GestureEvent:
   - Handles simulator quirks (CLICK_EVENT=0 → undefined)
   - Applies scroll cooldown (300ms) to prevent duplicates
   - Extracts list selection index for TAP events
5. Event dispatched to all registered gesture handlers
6. Handler code (in main.ts) processes gesture and updates glass display

**Display Update Flow:**

1. Application calls `glass.showText()`, `glass.showList()`, `glass.updateText()`, or `glass.showMessage()`
2. Method creates container objects with Even Hub SDK types
3. Container rendering:
   - **First render (startup)**: calls `bridge.createStartUpPageContainer()`
   - **Subsequent renders**: calls `bridge.rebuildPageContainer()` with retry logic
   - **In-place updates**: calls `bridge.textContainerUpgrade()` (no display flash)
4. SDK marshals containers to glass firmware
5. Firmware renders to physical display

**State Management:**

- **Glass Connection State**: Tracked in `GlassAdapterImpl.bridge` (null = not connected, EvenAppBridge = connected)
- **Startup State**: `GlassAdapterImpl.startupDone` boolean prevents re-initialization
- **Scroll State**: `GlassAdapterImpl.lastScrollTime` implements 300ms cooldown
- **Gesture Handlers**: Maintained in `Set<GestureEvent => void>` for pub/sub pattern
- **Wake Lock State**: Tracked in `WakeLockServiceImpl.wantLock` and `sentinel` reference
- **No global state**: Each service owns its state; no shared state manager

## Key Abstractions

**GlassAdapter Interface:**
- Purpose: Abstract hardware-specific display and gesture APIs
- Examples: `src/adapters/glassAdapter.ts` (implementation), `src/types/contracts.ts` (interface)
- Pattern: Bridge pattern with adapter - SDK bridge is hidden behind intuitive methods like `showText()` and `showList()`
- Usage: Application depends only on interface, not implementation details

**StatusBar Contract:**
- Purpose: Represent split status area (left/right text)
- Type definition: `src/types/contracts.ts`
- Pattern: Simple value object with fixed fields (left, right)
- Usage: Passed to `showText()` and `updateText()` to render status area

**GestureEvent Types:**
- Purpose: Normalize hardware events to application domain
- Type definition: `src/types/contracts.ts` (GestureKind union)
- Pattern: Discriminated union (kind + optional fields)
- Events: SCROLL_FWD, SCROLL_BACK, TAP (with listIndex), FOREGROUND_ENTER, FOREGROUND_EXIT

**Container Constants:**
- Purpose: Centralize magic numbers for glass layout and timing
- Location: `src/config/constants.ts`
- Pattern: Immutable config objects with semantic grouping (GLASS_LAYOUT, TIMING, CONTAINER_IDS, CONTAINER_NAMES)
- Usage: Prevents hardcoding display dimensions and timing values throughout adapter

## Entry Points

**HTML Entry Point:**
- Location: `index.html`
- Triggers: Browser page load when opened from Even app dev mode
- Responsibilities: Define DOM structure, status elements, battle log container

**TypeScript Entry Point:**
- Location: `src/main.ts`
- Triggers: Script tag in `index.html` (type="module")
- Responsibilities:
  - Wait for Even App Bridge connection from glasses
  - Update status indicator elements
  - Instantiate GlassAdapter and WakeLockService
  - Register gesture event listeners
  - Execute game logic (placeholder examples shown)
  - Error handling and status reporting

**Glass Connection Entry:**
- Location: `GlassAdapterImpl.waitForBridge()` (called by `connect()`)
- Triggers: Called explicitly from `src/main.ts` bootstrap
- Responsibilities:
  - Wait for SDK to establish connection to glasses
  - Timeout after 15 seconds if glasses don't connect
  - Throw human-readable errors

## Error Handling

**Strategy:** Fail-fast with status feedback

**Patterns:**

- **Bridge Connection Errors:** Caught in `bootstrap()` with try-catch, displayed to user via status indicators (red dot, error text)
- **Container Rendering Errors:** Logged to console; retry logic for `rebuildPageContainer()` (one 300ms-delayed retry)
- **Wake Lock Errors:** Gracefully ignored (best-effort API); no-op if unavailable in browser
- **SDK Deserialization Quirks:** Handled explicitly in `mapEventToGesture()` (e.g., CLICK_EVENT=0 undefined conversion)
- **Visibility Loss:** Wake lock automatically re-acquired on visibility change via event listener

## Cross-Cutting Concerns

**Logging:**
- Uses `console.log()` and `console.warn()` with prefixes ([glass], [wakelock])
- Informational: connection state changes, wake lock acquisition
- Warnings: SDK failures, retry attempts

**Validation:**
- Input validation in adapter methods:
  - Text content sliced to 1000 chars (startup/rebuild) or 2000 chars (in-place updates)
  - No validation of gesture event contents (SDK handles)
- Type safety via TypeScript (strict mode enabled)

**Authentication:**
- Not applicable; app.json declares permission for evenhub.evenrealities.com only
- Glass connection initiated by user opening app in Even app dev mode (implicit authentication)

---

*Architecture analysis: 2026-02-26*
